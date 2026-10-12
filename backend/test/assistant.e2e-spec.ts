import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import { FakeServices, geminiReply, sentPrompt } from './fakes';
import { bearer, createTestApp, createUser, login, resetDatabase, TestContext } from './helpers';

const prediction = (articleId: string, confidence: number, extra: Record<string, unknown> = {}) => ({
  body: { articleId, confidence, alternatives: [{ articleId: 'movimientos', confidence: 0.05 }], usedContext: false, version: 3, latencyMs: 2, ...extra },
});

describe('Sprints 6 a 8 · Asistente de ayuda (HU-32 a HU-35)', () => {
  let ctx: TestContext;
  let db: DataSource;
  let fake: FakeServices;
  let admin: string;
  let bodega: string;
  let compras: string;

  beforeAll(async () => {
    fake = await new FakeServices().start();
    process.env.FORECAST_URL = fake.url;
    process.env.GEMINI_BASE_URL = fake.url;
    process.env.GEMINI_API_KEY = 'clave-de-prueba-gemini';
    ctx = await createTestApp();
    db = ctx.db;
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
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega, fullName: 'Bruno Bodega' });
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    [admin, bodega, compras] = await Promise.all(['ana@x.co', 'bruno@x.co', 'marta@x.co'].map((e) => login(ctx, e)));
  });

  const ask = (token: string, text: string, conversationId?: string) =>
    ctx.http().post('/api/assistant/messages').set(bearer(token)).send({ text, conversationId }).expect(200);

  it('HU-32: las fichas se sincronizan al arrancar y la API solo devuelve las del rol', async () => {
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM assistant_articles`);
    const all = await ctx.http().get('/api/assistant/articles').set(bearer(admin)).expect(200);
    expect(all.body).toHaveLength(n);
    const mine = await ctx.http().get('/api/assistant/articles').set(bearer(bodega)).expect(200);
    const ids = mine.body.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['registrar-salida', 'conteo-fisico', 'recibir-mercancia', 'asistente']));
    expect(ids).not.toContain('crear-orden');
    expect(ids).not.toContain('configuracion-ia');
    const [row] = await db.query(`SELECT jsonb_array_length(examples) AS n FROM assistant_articles WHERE id = 'registrar-salida'`);
    expect(row.n).toBeGreaterThanOrEqual(20);
  });

  it('HU-34: responde con los pasos y el botón a la pantalla correcta', async () => {
    fake.predict = () => prediction('registrar-salida', 0.97);
    const res = await ask(bodega, '¿cómo registro una salida?');
    expect(res.body.message).toMatchObject({
      source: 'MODEL',
      articleId: 'registrar-salida',
      confidence: 0.97,
      modelVersion: 3,
      route: '/inventario/registrar?tipo=salida',
      title: 'Registrar una salida de stock',
    });
    expect(res.body.message.steps.length).toBeGreaterThan(2);
    expect(fake.geminiCalls()).toHaveLength(0); // con confianza alta no se gasta Gemini
  });

  it('HU-34: sin permiso, dice a quién pedírselo y no muestra la ruta', async () => {
    fake.predict = () => prediction('crear-orden', 0.9);
    const res = await ask(bodega, '¿cómo creo una orden de compra?');
    expect(res.body.message.source).toBe('NO_PERMISSION');
    expect(res.body.message.content).toContain('Tu rol (Bodega) no tiene permiso');
    expect(res.body.message.content).toContain('o a alguien con rol Compras');
    expect(res.body.message.route).toBeUndefined();
    expect(res.body.message.steps).toBeUndefined();
  });

  it('HU-34: recuerda la conversación y le pasa las preguntas anteriores al modelo', async () => {
    fake.predict = (req) =>
      (req.body.previous as string[]).length
        ? prediction('registrar-entrada', 0.95, { usedContext: true })
        : prediction('registrar-salida', 0.97);
    const first = await ask(bodega, '¿cómo registro una salida?');
    const second = await ask(bodega, '¿y una entrada?', first.body.conversationId);
    expect(second.body.conversationId).toBe(first.body.conversationId);
    expect(second.body.message).toMatchObject({ source: 'CONTEXT', articleId: 'registrar-entrada', route: '/inventario/registrar' });
    const predictCalls = fake.calls.filter((c) => c.path === '/assistant/predict');
    expect(predictCalls[1].body.previous).toEqual(['¿cómo registro una salida?']);

    const history = await ctx.http().get('/api/assistant/conversation').set(bearer(bodega)).expect(200);
    expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
    expect(history.body.messages[3].steps).toBeDefined();

    // Otra persona no puede escribir en esa conversación.
    await ctx.http().post('/api/assistant/messages').set(bearer(compras)).send({ text: 'hola', conversationId: first.body.conversationId }).expect(403);
    // «Nueva conversación» empieza de cero.
    const fresh = await ctx.http().post('/api/assistant/conversation').set(bearer(bodega)).expect(201);
    expect(fresh.body.messages).toEqual([]);
  });

  it('HU-35: con poca confianza responde Gemini con contexto, fichas permitidas y sin datos sensibles', async () => {
    fake.predict = () => prediction('transferir', 0.2);
    fake.similar = () => ({
      body: { version: 3, items: [{ articleId: 'transferir', score: 0.6 }, { articleId: 'crear-orden', score: 0.5 }, { articleId: 'stock-actual', score: 0.3 }] },
    });
    fake.gemini = () =>
      geminiReply({
        answer: 'Abre /inventario/transferencias y crea una nueva. También puedes ir a /admin/secreto.',
        articleIds: ['transferir', 'crear-orden'],
        known: true,
      });
    const first = await ask(bodega, 'necesito mandar cajas al local del centro, mi correo es bruno@x.co y mi contraseña es Hola123');
    const msg = first.body.message;
    expect(msg.source).toBe('GEMINI');
    expect(msg.articleId).toBe('transferir');
    expect(msg.route).toBe('/inventario/transferencias');
    // La ruta inventada se quita antes de mostrarla.
    expect(msg.content).toContain('/inventario/transferencias');
    expect(msg.content).not.toContain('/admin/secreto');
    expect(msg.notice).toContain('ruta que no existe');

    const prompt = sentPrompt(fake.geminiCalls()[0]);
    expect(prompt).toContain('"id":"transferir"');
    expect(prompt).not.toContain('crear-orden'); // Bodega no puede crear órdenes: esa ficha no viaja
    expect(prompt).not.toContain('bruno@x.co');
    expect(prompt).not.toContain('Hola123');
    expect(prompt).toContain('[correo]');
    const [usage] = await db.query(`SELECT feature, status FROM ai_usage`);
    expect(usage).toEqual({ feature: 'ASSISTANT', status: 'OK' });
  });

  it('HU-35: si las fichas no tienen la respuesta, Gemini dice que no sabe y se sugieren fichas', async () => {
    fake.predict = () => prediction('asistente', 0.1);
    fake.similar = () => ({ body: { version: 3, items: [{ articleId: 'stock-actual', score: 0.2 }] } });
    fake.gemini = () => geminiReply({ answer: 'No encontré eso en la ayuda de StockSense.', articleIds: [], known: false });
    const res = await ask(compras, '¿cuál es la capital de Francia?');
    expect(res.body.message).toMatchObject({ source: 'GEMINI', articleId: null, route: null });
    expect(res.body.message.suggestions[0]).toMatchObject({ id: 'stock-actual' });
  });

  it('HU-35: si Gemini falla o no está, muestra un mensaje claro y las fichas cercanas', async () => {
    fake.predict = () => prediction('transferir', 0.2);
    fake.similar = () => ({ body: { version: 3, items: [{ articleId: 'transferir', score: 0.6 }] } });
    fake.gemini = () => ({ status: 500, body: { error: { message: 'boom' } } });
    const res = await ask(bodega, 'mandar cajas al otro local');
    expect(res.body.message.source).toBe('FALLBACK');
    expect(res.body.message.notice).toBe('No pudimos consultar a Gemini en este momento.');
    expect(res.body.message.suggestions).toEqual([{ id: 'transferir', title: 'Transferir stock entre bodegas', route: '/inventario/transferencias' }]);
  });

  it('si el servicio de Python no responde, el chat sigue funcionando con búsqueda por palabras', async () => {
    fake.predict = () => ({ status: 503, body: {} });
    fake.similar = () => ({ status: 503, body: {} });
    fake.gemini = () => ({ status: 500, body: {} });
    const res = await ask(bodega, 'transferencia entre bodegas');
    expect(res.body.message.source).toBe('FALLBACK');
    expect(res.body.message.suggestions.map((s: { id: string }) => s.id)).toContain('transferir');
  });

  it('HU-33: la persona administradora ve las versiones del modelo y pide un entrenamiento', async () => {
    await db.query(
      `INSERT INTO assistant_models (status, is_active, accuracy, train_size, test_size, articles, reason, metrics)
       VALUES ('READY', true, 0.874, 5000, 151, 44, 'Acierto 87,4 %', '{"latencyMsAvg": 1.5, "thresholds": []}')`,
    );
    await ctx.http().get('/api/assistant/models').set(bearer(compras)).expect(403);
    const res = await ctx.http().get('/api/assistant/models').set(bearer(admin)).expect(200);
    expect(res.body.versions[0]).toMatchObject({ version: 1, isActive: true, accuracy: 0.874, testSize: 151 });
    expect(res.body.knowledge.articles).toBeGreaterThan(30);
    const job = await ctx.http().post('/api/assistant/models/train').set(bearer(admin)).expect(202);
    expect(job.body).toMatchObject({ kind: 'ASSISTANT_TRAIN', status: 'QUEUED' });
  });

  it('el umbral de confianza se cambia por configuración y decide cuándo se usa Gemini', async () => {
    fake.predict = () => prediction('registrar-salida', 0.6);
    fake.gemini = () => geminiReply({ answer: 'Usa Inventario.', articleIds: ['registrar-salida'], known: true });
    fake.similar = () => ({ body: { version: 3, items: [{ articleId: 'registrar-salida', score: 0.6 }] } });
    expect((await ask(bodega, 'sacar cosas')).body.message.source).toBe('MODEL');
    await ctx.http().patch('/api/settings/ai').set(bearer(admin)).send({ assistantConfidenceThreshold: 0.7 }).expect(200);
    expect((await ask(bodega, 'sacar cosas')).body.message.source).toBe('GEMINI');
  });
});
