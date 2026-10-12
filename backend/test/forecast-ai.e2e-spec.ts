import { DataSource } from 'typeorm';
import { GeminiClient } from '../src/ai/gemini.client';
import { Role } from '../src/common/auth/roles';
import { FakeServices, geminiReply, sentPrompt } from './fakes';
import {
  bearer,
  createCategory,
  createProduct,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  seedForecast,
  TestContext,
} from './helpers';

describe('Sprints 6 a 8 · Pronóstico, precisión, reentrenamiento y explicación con Gemini', () => {
  let ctx: TestContext;
  let db: DataSource;
  let fake: FakeServices;
  let admin: string;
  let compras: string;
  let bodega: string;
  let analista: string;
  let tools: string;
  let hammer: string;
  let nails: string;

  beforeAll(async () => {
    fake = await new FakeServices().start();
    process.env.FORECAST_URL = fake.url;
    process.env.GEMINI_BASE_URL = fake.url;
    process.env.GEMINI_API_KEY = 'clave-de-prueba-gemini';
    ctx = await createTestApp();
    db = ctx.db;
    // Límite corto para que la prueba de «tarda demasiado» no espere 10 segundos.
    jest.spyOn(ctx.app.get(GeminiClient), 'timeoutMs', 'get').mockReturnValue(1500);
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.stop();
    for (const key of ['FORECAST_URL', 'GEMINI_BASE_URL', 'GEMINI_API_KEY']) delete process.env[key];
  });
  beforeEach(async () => {
    await resetDatabase(db);
    fake.reset();
    await createUser(db, { email: 'ana@x.co', role: Role.Admin });
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    await createUser(db, { email: 'lina@x.co', role: Role.Analista });
    [admin, compras, bodega, analista] = await Promise.all(
      ['ana@x.co', 'marta@x.co', 'bruno@x.co', 'lina@x.co'].map((e) => login(ctx, e)),
    );
    tools = await createCategory(db, 'Herramientas');
    hammer = await createProduct(db, { sku: 'MAR-001', name: 'Martillo', categoryId: tools, cost: 23456 });
    nails = await createProduct(db, { sku: 'CLA-2', name: 'Clavo 2"', categoryId: tools, cost: 50 });
  });

  describe('HU-20 · Pronóstico en un gráfico', () => {
    it('devuelve historia, pronóstico y rango para 4, 8 o 12 semanas', async () => {
      await seedForecast(db, hammer, { weeks: 30, weekly: 10, yhat: 12 });
      for (const horizon of [4, 8, 12]) {
        const started = Date.now();
        const res = await ctx.http().get(`/api/forecast/products/${hammer}?horizon=${horizon}`).set(bearer(compras)).expect(200);
        expect(Date.now() - started).toBeLessThan(2000); // criterio 2
        expect(res.body.status).toBe('READY');
        expect(res.body.history).toHaveLength(30);
        expect(res.body.forecast).toHaveLength(horizon);
        for (const w of res.body.forecast) expect(w.lo <= w.yhat && w.yhat <= w.hi).toBe(true);
        expect(res.body.model).toMatchObject({ method: 'SES', methodLabel: 'Suavizado exponencial simple', version: 1 });
      }
      await ctx.http().get(`/api/forecast/products/${hammer}?horizon=5`).set(bearer(compras)).expect(400);
    });

    it('explica qué hacer si los datos no alcanzan', async () => {
      await seedForecast(db, nails, { weeks: 5 });
      const few = await ctx.http().get(`/api/forecast/products/${nails}`).set(bearer(analista)).expect(200);
      expect(few.body.status).toBe('INSUFFICIENT_DATA');
      expect(few.body.message).toContain('5 semanas de ventas');
      expect(few.body.message).toContain('tendrá pronóstico en 7 semanas');
      const none = await ctx.http().get(`/api/forecast/products/${hammer}`).set(bearer(analista)).expect(200);
      expect(none.body.status).toBe('NO_SALES');
      expect(none.body.message).toContain('Historial de ventas');
    });

    it('Bodega no ve pronósticos', async () => {
      await ctx.http().get(`/api/forecast/products/${hammer}`).set(bearer(bodega)).expect(403);
    });

    it('resumen con la demanda de las próximas 4 semanas', async () => {
      await seedForecast(db, hammer, { weekly: 10, yhat: 15 });
      await seedForecast(db, nails, { weekly: 100, yhat: 90 });
      const res = await ctx.http().get('/api/forecast/summary').set(bearer(compras)).expect(200);
      expect(res.body.items.map((i: { sku: string }) => i.sku)).toEqual(['CLA-2', 'MAR-001']);
      expect(res.body.items[1]).toMatchObject({ next4: 60, last4: 40, changePct: 0.5 });
    });
  });

  describe('HU-21 · Precisión del modelo', () => {
    it('muestra la precisión general, la de los 20 más vendidos y marca los que superan el umbral', async () => {
      await seedForecast(db, hammer, { testWape: 0.8, volume: 50 });
      await seedForecast(db, nails, { testWape: 0.1, volume: 5000 });
      let res = await ctx.http().get('/api/forecast/accuracy').set(bearer(analista)).expect(200);
      expect(res.body.run).toMatchObject({ overallWape: 0.2, baselineWape: 0.25, top20Wape: 0.18, testWeeks: 13 });
      expect(res.body.top20.map((p: { sku: string }) => p.sku)).toEqual(['CLA-2', 'MAR-001']);
      expect(res.body.threshold).toBe(0.5);
      expect(res.body.flagged).toBe(1);
      expect(res.body.items[0]).toMatchObject({ sku: 'MAR-001', testWape: 0.8, flagged: true });

      // Umbral configurable sin tocar código ni reentrenar (criterio 3).
      await ctx.http().patch('/api/settings/ai').set(bearer(analista)).send({ forecastErrorThreshold: 0.9 }).expect(403);
      await ctx.http().patch('/api/settings/ai').set(bearer(admin)).send({ forecastErrorThreshold: 0.9 }).expect(200);
      res = await ctx.http().get('/api/forecast/accuracy?flagged=true').set(bearer(analista)).expect(200);
      expect(res.body.flagged).toBe(0);
      expect(res.body.items).toHaveLength(0);
      const [audit] = await db.query(`SELECT changes FROM audit_logs WHERE action = 'settings.updated'`);
      expect(audit.changes.forecastErrorThreshold).toEqual({ from: 0.5, to: 0.9 });
    });
  });

  describe('HU-22 · Reentrenamiento con la cola de trabajos', () => {
    it('encola un trabajo, no lo duplica y muestra el horario configurado', async () => {
      await ctx.http().post('/api/forecast/retrain').set(bearer(compras)).expect(403);
      const job = await ctx.http().post('/api/forecast/retrain').set(bearer(analista)).expect(202);
      expect(job.body).toMatchObject({ kind: 'FORECAST_RETRAIN', status: 'QUEUED', trigger: 'MANUAL' });
      const again = await ctx.http().post('/api/forecast/retrain').set(bearer(analista)).expect(409);
      expect(again.body.message).toContain('Ya hay un entrenamiento en la cola');

      await ctx.http().patch('/api/settings/ai').set(bearer(admin)).send({ retrain: { weekday: 5, time: '04:30' } }).expect(200);
      await ctx.http().patch('/api/settings/ai').set(bearer(admin)).send({ retrain: { time: '25:00' } }).expect(400);
      const models = await ctx.http().get('/api/forecast/models').set(bearer(compras)).expect(200);
      expect(models.body.schedule.description).toBe('Cada viernes a las 04:30 (hora de Bogotá)');
      expect(models.body.jobs[0]).toMatchObject({ status: 'QUEUED', requestedBy: 'lina@x.co' });
    });

    it('muestra versiones rechazadas con su motivo y permite activarlas a mano', async () => {
      const v1 = await seedForecast(db, hammer);
      const [v2] = await db.query(
        `INSERT INTO forecast_runs (trigger, status, decision, reason, is_active, finished_at, overall_wape, previous_wape)
         VALUES ('SCHEDULED', 'SUCCESS', 'REJECTED', 'El modelo nuevo es peor … Se conserva el vigente.', false, now(), 0.4, 0.2)
         RETURNING id, version`,
      );
      await seedForecast(db, nails, { runId: v2.id });
      const list = await ctx.http().get('/api/forecast/models').set(bearer(analista)).expect(200);
      expect(list.body.runs[0]).toMatchObject({ version: 2, decision: 'REJECTED', isActive: false, hasDetail: true });
      expect(list.body.runs[1]).toMatchObject({ version: 1, isActive: true });

      await ctx.http().post(`/api/forecast/models/${v2.id}/activate`).set(bearer(analista)).expect(200);
      const [active] = await db.query(`SELECT id, reason FROM forecast_runs WHERE is_active`);
      expect(active.id).toBe(v2.id);
      expect(active.reason).toContain('Activada a mano por lina@x.co');
      expect(v1).not.toBe(v2.id);
    });
  });

  describe('HU-24 y HU-23 · Explicación con Gemini', () => {
    const facts = (call: (typeof fake.calls)[number]) => JSON.parse(sentPrompt(call).replace(/^DATOS:\n/, '').split('\n\n')[0]);

    beforeEach(async () => {
      await seedForecast(db, hammer, { weeks: 30, weekly: 10, yhat: 12 });
    });

    it('genera la explicación solo con cifras de los datos, la guarda y registra el consumo', async () => {
      fake.gemini = (req) => {
        const data = facts(req);
        return geminiReply({
          tendencia: `Se esperan ${data.forecastTotal} ${data.product.unit} en ${data.horizonWeeks} semanas, ${data.changeVsLast12Pct} % más que el promedio de las últimas ${data.windowWeeks}.`,
          estacionalidad: 'Aún no hay un año de historia para saber si hay temporada.',
          advertencias: 'No hay advertencias.',
        });
      };
      const res = await ctx.http().post(`/api/forecast/products/${hammer}/explain?horizon=4`).set(bearer(compras)).expect(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.explanation.tendencia).toBe('Se esperan 48 UND en 4 semanas, 20 % más que el promedio de las últimas 12.');
      expect(res.body.cached).toBe(false);

      // Lo que viajó a Gemini: clave en encabezado, solo datos agregados, sin costo ni personas.
      const [call] = fake.geminiCalls();
      expect(call.headers['x-goog-api-key']).toBe('clave-de-prueba-gemini');
      expect(call.path).toBe('/v1beta/models/gemini-3.1-pro-preview:generateContent');
      const prompt = sentPrompt(call);
      expect(prompt).not.toContain('23456');
      expect(prompt).not.toMatch(/@/);
      expect(Object.keys(facts(call)).sort()).toEqual(
        expect.arrayContaining(['product', 'forecast', 'warnings', 'trendPct', 'forecastTotal']),
      );
      expect(JSON.stringify(res.body)).not.toContain('clave-de-prueba-gemini');

      const [usage] = await db.query(`SELECT * FROM ai_usage`);
      expect(usage).toMatchObject({ feature: 'EXPLAIN', status: 'OK', prompt_tokens: 900, output_tokens: 150 });
      expect(Number(usage.cost_usd)).toBeCloseTo((900 * 2 + 150 * 12) / 1_000_000, 6);

      // La segunda vez sale de lo guardado: no gasta otra llamada.
      const again = await ctx.http().post(`/api/forecast/products/${hammer}/explain?horizon=4`).set(bearer(compras)).expect(200);
      expect(again.body).toMatchObject({ status: 'OK', cached: true });
      expect(fake.geminiCalls()).toHaveLength(1);
    });

    it('rechaza cifras inventadas: reintenta una vez y si insiste muestra el resultado estadístico', async () => {
      fake.gemini = () =>
        geminiReply({ tendencia: 'Venderás 937 unidades.', estacionalidad: 'Sin datos.', advertencias: 'Ninguna.' });
      const res = await ctx.http().post(`/api/forecast/products/${hammer}/explain?horizon=8`).set(bearer(compras)).expect(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.facts.forecastTotal).toBe(96);
      const calls = fake.geminiCalls();
      expect(calls).toHaveLength(2);
      expect(sentPrompt(calls[1])).toContain('cifras que no están en los datos: 937');
      const statuses = await db.query(`SELECT status FROM ai_usage ORDER BY id`);
      expect(statuses.map((s: { status: string }) => s.status)).toEqual(['REJECTED', 'REJECTED']);
    });

    it('rechaza textos de más de 120 palabras', async () => {
      const long = Array.from({ length: 130 }, () => 'palabra').join(' ');
      fake.gemini = () => geminiReply({ tendencia: long, estacionalidad: 'x', advertencias: 'y' });
      const res = await ctx.http().post(`/api/forecast/products/${hammer}/explain`).set(bearer(compras)).expect(200);
      expect(res.body.status).toBe('REJECTED');
    });

    it('si Gemini tarda más del límite muestra el resultado estadístico, no un error', async () => {
      fake.gemini = () => ({ ...geminiReply({ tendencia: 'a', estacionalidad: 'b', advertencias: 'c' }), delayMs: 3000 });
      const started = Date.now();
      const res = await ctx.http().post(`/api/forecast/products/${hammer}/explain`).set(bearer(compras)).expect(200);
      expect(Date.now() - started).toBeLessThan(2900);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.message).toContain('tardó más de 2 segundos');
      expect(res.body.facts.product.sku).toBe('MAR-001');
      const [usage] = await db.query(`SELECT status FROM ai_usage`);
      expect(usage.status).toBe('TIMEOUT');
    });

    it('reintenta ante un 503 de Gemini', async () => {
      let n = 0;
      fake.gemini = () =>
        ++n === 1
          ? { status: 503, body: { error: { message: 'sobrecargado' } } }
          : geminiReply({ tendencia: 'Se mantiene.', estacionalidad: 'Sin un año de datos.', advertencias: 'No hay advertencias.' });
      const res = await ctx.http().post(`/api/forecast/products/${hammer}/explain`).set(bearer(compras)).expect(200);
      expect(res.body.status).toBe('OK');
      expect(fake.geminiCalls()).toHaveLength(2);
    });

    it('respeta el límite mensual por persona con un mensaje amable', async () => {
      await seedForecast(db, nails, { weeks: 30, weekly: 20 });
      await ctx.http().patch('/api/settings/ai').set(bearer(admin)).send({ monthlyLimitPerUser: 1 }).expect(200);
      fake.gemini = () => geminiReply({ tendencia: 'Se mantiene.', estacionalidad: 'Sin datos.', advertencias: 'No hay.' });
      await ctx.http().post(`/api/forecast/products/${hammer}/explain`).set(bearer(compras)).expect(200);
      const res = await ctx.http().post(`/api/forecast/products/${nails}/explain`).set(bearer(compras)).expect(200);
      expect(res.body.status).toBe('LIMIT');
      expect(res.body.message).toContain('Ya usaste tus 1 consultas con IA de este mes');
      expect(res.body.facts.product.sku).toBe('CLA-2');
      // Otra persona sí puede.
      const other = await ctx.http().post(`/api/forecast/products/${nails}/explain`).set(bearer(analista)).expect(200);
      expect(other.body.status).toBe('OK');
      const status = await ctx.http().get('/api/ai/status').set(bearer(compras)).expect(200);
      expect(status.body).toMatchObject({ configured: true, used: 1, limit: 1, remaining: 0 });
    });

    it('sin clave de Gemini la app sigue funcionando con el resultado estadístico', async () => {
      const spy = jest.spyOn(ctx.app.get(GeminiClient), 'configured', 'get').mockReturnValue(false);
      const res = await ctx.http().post(`/api/forecast/products/${hammer}/explain`).set(bearer(compras)).expect(200);
      spy.mockRestore();
      expect(res.body.status).toBe('UNAVAILABLE');
      expect(fake.geminiCalls()).toHaveLength(0);
    });

    it('cada explicación se puede reportar y la persona administradora ve consumo y reportes', async () => {
      await ctx.http().post('/api/ai/feedback').set(bearer(compras)).send({ feature: 'EXPLAIN', targetId: hammer, content: 'texto', comment: 'La cifra no cuadra' }).expect(201);
      await ctx.http().get('/api/ai/feedback').set(bearer(compras)).expect(403);
      const list = await ctx.http().get('/api/ai/feedback').set(bearer(admin)).expect(200);
      expect(list.body[0]).toMatchObject({ feature: 'EXPLAIN', comment: 'La cifra no cuadra' });
      const usage = await ctx.http().get('/api/ai/usage').set(bearer(admin)).expect(200);
      expect(usage.body).toMatchObject({ configured: true, model: 'gemini-3.1-pro-preview', timeoutSeconds: 2, monthlyLimitPerUser: 100 });
    });
  });
});
