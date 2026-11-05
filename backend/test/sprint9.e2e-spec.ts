import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { GeminiClient } from '../src/ai/gemini.client';
import { Role } from '../src/common/auth/roles';
import { DataChatService } from '../src/data-chat/data-chat.service';
import { DATA_TOOLS } from '../src/data-chat/tools';
import { FakeRequest, FakeServices, geminiReply } from './fakes';
import {
  bearer,
  createCategory,
  createProduct,
  createTestApp,
  createUser,
  defaultWarehouseId,
  login,
  resetDatabase,
  seedForecast,
  TestContext,
} from './helpers';

/** Respuesta de Gemini que pide herramientas (function calling). */
const callTools = (...calls: { name: string; args?: Record<string, unknown> }[]) => ({
  body: {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ thoughtSignature: 'firma-de-prueba' }, ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args ?? {} } }))],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40 },
  },
});

/** Respuesta final en texto. */
const say = (text: string) => ({
  body: {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 60 },
  },
});

type Content = { role: string; parts: Record<string, unknown>[] };
const contentsOf = (req: FakeRequest) => req.body.contents as Content[];
const functionResponses = (req: FakeRequest) =>
  contentsOf(req).flatMap((c) => c.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse as { name: string; response: Record<string, unknown> }));

describe('Sprint 9 · Reportes, anomalías y preguntas al inventario', () => {
  let ctx: TestContext;
  let db: DataSource;
  let fake: FakeServices;
  let admin: string;
  let compras: string;
  let bodega: string;
  let analista: string;
  let main: string;
  let cat: string;
  let hammer: string;
  let cement: string;

  beforeAll(async () => {
    fake = await new FakeServices().start();
    process.env.FORECAST_URL = fake.url;
    process.env.GEMINI_BASE_URL = fake.url;
    process.env.GEMINI_API_KEY = 'clave-de-prueba-gemini';
    ctx = await createTestApp();
    db = ctx.db;
    jest.spyOn(ctx.app.get(GeminiClient), 'timeoutMs', 'get').mockReturnValue(1500);
    jest.spyOn(ctx.app.get(DataChatService), 'timeoutMs', 'get').mockReturnValue(3000);
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.stop();
    for (const key of ['FORECAST_URL', 'GEMINI_BASE_URL', 'GEMINI_API_KEY']) delete process.env[key];
  });
  beforeEach(async () => {
    await resetDatabase(db);
    await db.query(`TRUNCATE anomalies, weekly_sales, forecast_series CASCADE`);
    fake.reset();
    await createUser(db, { email: 'ana@x.co', role: Role.Admin, fullName: 'Ana Admin' });
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    await createUser(db, { email: 'lina@x.co', role: Role.Analista, fullName: 'Lina Analista' });
    [admin, compras, bodega, analista] = await Promise.all(['ana@x.co', 'marta@x.co', 'bruno@x.co', 'lina@x.co'].map((e) => login(ctx, e)));
    main = await defaultWarehouseId(db);
    cat = await createCategory(db, 'Herramientas');
    hammer = await createProduct(db, { sku: 'MAR-001', name: 'Martillo', categoryId: cat, cost: 23456 });
    cement = await createProduct(db, { sku: 'CEM-50', name: 'Cemento gris 50 kg', categoryId: cat, cost: 32500 });
    await db.query(`UPDATE products SET reorder_point = 20 WHERE id = $1`, [hammer]);
    await db.query(`INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES ($1, $3, 7), ($2, $3, 40)`, [hammer, cement, main]);
    await db.query(
      `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, created_at)
       VALUES ($1, $3, 'IN', 10, 10, 'Compra local', now() - interval '3 days'),
              ($1, $3, 'OUT', -3, 7, 'Venta de mostrador', now() - interval '2 days'),
              ($2, $3, 'IN', 40, 40, 'Inventario inicial', now() - interval '1 day')`,
      [hammer, cement, main],
    );
    await db.query(
      `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source)
       SELECT $1, $2, CURRENT_DATE - g, 2, 'IMPORT' FROM generate_series(1, 20) g`,
      [hammer, main],
    );
  });

  // ================================================================== HU-28
  describe('HU-28 · Reportes con exportación a Excel y PDF', () => {
    it('vista previa de los 4 reportes; Bodega no tiene acceso', async () => {
      await seedForecast(db, hammer, { testWape: 0.7 });
      for (const kind of ['stock', 'movements', 'rotation', 'accuracy']) {
        const res = await ctx.http().get(`/api/reports/${kind}`).set(bearer(analista)).expect(200);
        expect(res.body.columns.length).toBeGreaterThan(2);
        expect(res.body.rows.length).toBeGreaterThan(0);
      }
      const stock = await ctx.http().get('/api/reports/stock').set(bearer(analista)).expect(200);
      expect(stock.body.rows[0]).toMatchObject({ sku: 'CEM-50', quantity: 40, cost: 32500, value: 1300000 });
      expect(stock.body.totals.value).toBe(1300000 + 7 * 23456);
      const accuracy = await ctx.http().get('/api/reports/accuracy?onlyFlagged=true').set(bearer(analista)).expect(200);
      expect(accuracy.body.rows).toEqual([expect.objectContaining({ sku: 'MAR-001', flagged: true, accuracy: expect.closeTo(0.3, 5) })]);
      await ctx.http().get('/api/reports/stock').set(bearer(bodega)).expect(403);
      await ctx.http().get('/api/reports/inventado').set(bearer(analista)).expect(404);
    });

    it('los filtros se aplican y se describen; fechas inválidas se rechazan', async () => {
      const res = await ctx.http().get('/api/reports/movements?type=OUT').set(bearer(admin)).expect(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0]).toMatchObject({ type: 'Salida', quantity: -3, reason: 'Venta de mostrador' });
      expect(res.body.filtersApplied).toEqual(expect.arrayContaining([{ label: 'Tipo', value: 'Salida' }]));
      const byWh = await ctx.http().get(`/api/reports/stock?warehouseId=${main}`).set(bearer(admin)).expect(200);
      expect(byWh.body.filtersApplied[0]).toEqual({ label: 'Bodega', value: 'Bodega principal' });
      await ctx.http().get('/api/reports/movements?from=2026-13-40').set(bearer(admin)).expect(400);
      await ctx.http().get('/api/reports/movements?from=2026-10-10&to=2026-10-01').set(bearer(admin)).expect(400);
    });

    it('Excel: encabezado con fecha, autor y filtros; cifras como números; queda en la auditoría', async () => {
      const res = await ctx
        .http()
        .get('/api/reports/stock/export?format=xlsx')
        .set(bearer(analista))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(/stocksense_stock-valorizado_.*\.xlsx/);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(res.body as never);
      const sheet = book.worksheets[0];
      const text = sheet.getSheetValues().flat().filter((v) => typeof v === 'string').join(' | ');
      expect(text).toMatch(/Generado el .* por Lina Analista \(lina@x\.co\)/);
      expect(text).toMatch(/Filtros: ninguno/);
      let headerRow = 0;
      sheet.eachRow((row, n) => {
        if (!headerRow && row.getCell(1).value === 'SKU') headerRow = n;
      });
      expect(sheet.getRow(headerRow).values).toEqual(expect.arrayContaining(['SKU', 'Producto', 'Valor']));
      const firstData = sheet.getRow(headerRow + 1);
      expect(firstData.getCell(1).value).toBe('CEM-50');
      expect(typeof firstData.getCell(8).value).toBe('number');
      const [log] = await db.query(`SELECT changes FROM audit_logs WHERE action = 'report.exported'`);
      expect(log.changes).toMatchObject({ report: 'Stock valorizado', format: 'xlsx', rows: 2 });
    });

    it('PDF válido con 10.000 movimientos en menos de 30 segundos (también Excel)', async () => {
      await db.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, created_at)
         SELECT $1, $2, 'OUT', -1, 100, 'Venta de mostrador número ' || g, now() - (g || ' seconds')::interval
           FROM generate_series(1, 10000) g`,
        [cement, main],
      );
      for (const format of ['pdf', 'xlsx']) {
        const started = Date.now();
        const res = await ctx
          .http()
          .get(`/api/reports/movements/export?format=${format}`)
          .set(bearer(admin))
          .buffer(true)
          .parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
          })
          .expect(200);
        const ms = Date.now() - started;
        expect(ms).toBeLessThan(30_000);
        expect(Number(res.headers['x-report-rows'])).toBe(10003);
        const body = res.body as Buffer;
        if (format === 'pdf') {
          expect(body.subarray(0, 5).toString()).toBe('%PDF-');
          expect(body.subarray(-6).toString()).toMatch(/%%EOF/);
          const pages = body.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
          expect(pages).toBeGreaterThan(200);
        } else {
          const book = new ExcelJS.Workbook();
          await book.xlsx.load(body as never);
          expect(book.worksheets[0].rowCount).toBeGreaterThan(10003);
        }
      }
    }, 90_000);
  });

  // ================================================================== T-28.3
  describe('T-28.3 · Precisión de las últimas 4 semanas', () => {
    it('sin historia usa la prueba hacia atrás de la versión activa', async () => {
      const run = await seedForecast(db, hammer);
      await db.query(`UPDATE forecast_runs SET recent_wape = 0.18 WHERE id = $1`, [run]);
      const res = await ctx.http().get('/api/forecast/recent-accuracy').set(bearer(compras)).expect(200);
      expect(res.body).toMatchObject({ source: 'BACKTEST', accuracy: 0.82 });
      await ctx.http().get('/api/forecast/recent-accuracy').set(bearer(bodega)).expect(403);
    });

    it('con versiones anteriores compara cada semana con el pronóstico que había antes', async () => {
      const [{ last }] = await db.query(`SELECT (date_trunc('week', now() AT TIME ZONE 'America/Bogota')::date - 7)::text AS last`);
      await db.query(
        `INSERT INTO weekly_sales (product_id, week_start, quantity) SELECT $1, $2::date - 7 * g, 10 FROM generate_series(0, 5) g`,
        [hammer, last],
      );
      const [old] = await db.query(
        `INSERT INTO forecast_runs (trigger, status, decision, is_active, data_last_week) VALUES ('MANUAL', 'SUCCESS', 'ACCEPTED', false, $1::date - 28)
         RETURNING id`,
        [last],
      );
      // Pronosticó 12 para cada una de las 4 semanas siguientes: error 2 de 10 = precisión 80 %.
      await db.query(
        `INSERT INTO forecasts (run_id, product_id, week_start, step, yhat, lo, hi)
         SELECT $1, $2, $3::date - 28 + 7 * g, g, 12, 10, 14 FROM generate_series(1, 4) g`,
        [old.id, hammer, last],
      );
      const res = await ctx.http().get('/api/forecast/recent-accuracy').set(bearer(analista)).expect(200);
      expect(res.body.source).toBe('TRACKED');
      expect(res.body.accuracy).toBeCloseTo(0.8, 5);
      expect(res.body.weeks).toHaveLength(4);
    });
  });

  // ================================================================== HU-26
  describe('HU-26 · Anomalías', () => {
    async function anomaly(kind = 'SALES_SPIKE', productId = hammer) {
      const [row] = await db.query(
        `INSERT INTO anomalies (product_id, kind, week_start, observed, expected, sd, lower_bound, upper_bound, z_score, history)
         VALUES ($1, $2, date_trunc('week', now())::date - 7, 95, 20, 4.5, 6.5, 33.5, 16.7, '[19, 22, 18, 21, 20, 95]')
         RETURNING id`,
        [productId, kind],
      );
      await db.query(
        `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source)
         VALUES ($1, $2, date_trunc('week', now())::date - 5, 80, 'API')`,
        [productId, main],
      );
      return row.id as string;
    }

    it('bandeja con conteos; solo roles con reportes', async () => {
      await anomaly();
      const res = await ctx.http().get('/api/anomalies').set(bearer(analista)).expect(200);
      expect(res.body.counts).toEqual({ OPEN: 1, EXPLAINED: 0, IGNORED: 0 });
      expect(res.body.items[0]).toMatchObject({ kindLabel: 'Ventas muy altas', timesExpected: 4.8, product: { sku: 'MAR-001' } });
      expect(res.body.items[0].history).toHaveLength(6);
      await ctx.http().get('/api/anomalies').set(bearer(bodega)).expect(403);
    });

    it('Gemini describe con hipótesis como posibilidades y cifras de los datos', async () => {
      const id = await anomaly();
      fake.gemini = () =>
        geminiReply({
          resumen: 'Esa semana se vendieron 95 UND de Martillo frente a unas 20 esperadas.',
          hipotesis: [
            { causa: 'Podría haber un error de digitación en una venta grande.', comoVerificar: 'Revisa la venta más grande de la semana.' },
            { causa: 'Es posible que hubiera una promoción.', comoVerificar: 'Pregunta en ventas por descuentos.' },
          ],
        });
      const res = await ctx.http().post(`/api/anomalies/${id}/explain`).set(bearer(analista)).expect(200);
      expect(res.body).toMatchObject({ status: 'OK', source: 'GEMINI' });
      const [sent] = fake.geminiCalls();
      const prompt = JSON.stringify(sent.body);
      expect(prompt).not.toContain('23456'); // costo
      expect(prompt).toContain('maxDaySharePct');
      // La segunda vez no gasta otra llamada.
      await ctx.http().post(`/api/anomalies/${id}/explain`).set(bearer(analista)).expect(200);
      expect(fake.geminiCalls()).toHaveLength(1);
    });

    it('rechaza causas afirmadas como hechos o cifras inventadas y usa la descripción por reglas', async () => {
      const id = await anomaly();
      fake.gemini = () =>
        geminiReply({
          resumen: 'Se vendieron 95 UND.',
          hipotesis: [
            { causa: 'Se debió a una promoción del 40 %.', comoVerificar: 'Revisa.' },
            { causa: 'Fue por un cliente grande.', comoVerificar: 'Revisa.' },
          ],
        });
      const res = await ctx.http().post(`/api/anomalies/${id}/explain`).set(bearer(analista)).expect(200);
      expect(fake.geminiCalls()).toHaveLength(2); // un reintento
      expect(res.body.source).toBe('RULES');
      expect(res.body.explanation.hipotesis[0].causa).toMatch(/^Podría ser un error de digitación/);
      const [usage] = await db.query(`SELECT count(*)::int AS n FROM ai_usage WHERE feature = 'ANOMALY' AND status = 'REJECTED'`);
      expect(usage.n).toBe(2);
    });

    it('explicada pide una nota; ignorada no vuelve a abrirse y queda en la auditoría', async () => {
      const id = await anomaly();
      await ctx.http().patch(`/api/anomalies/${id}`).set(bearer(analista)).send({ status: 'EXPLAINED' }).expect(400);
      await ctx.http().patch(`/api/anomalies/${id}`).set(bearer(analista)).send({ status: 'IGNORED' }).expect(200);
      const open = await ctx.http().get('/api/anomalies').set(bearer(analista)).expect(200);
      expect(open.body.items).toHaveLength(0);
      const ignored = await ctx.http().get('/api/anomalies?status=IGNORED').set(bearer(analista)).expect(200);
      expect(ignored.body.items[0]).toMatchObject({ status: 'IGNORED', statusBy: 'Lina Analista' });
      // Volver a detectar la misma semana no la reabre.
      await db.query(
        `INSERT INTO anomalies (product_id, kind, week_start, observed, expected, sd, lower_bound, upper_bound, z_score)
         SELECT product_id, kind, week_start, 99, 20, 4, 8, 32, 19 FROM anomalies WHERE id = $1
         ON CONFLICT (product_id, kind, week_start) DO UPDATE SET observed = EXCLUDED.observed`,
        [id],
      );
      const [row] = await db.query(`SELECT status FROM anomalies WHERE id = $1`, [id]);
      expect(row.status).toBe('IGNORED');
      const [log] = await db.query(`SELECT changes FROM audit_logs WHERE action = 'anomaly.status_changed'`);
      expect(log.changes).toMatchObject({ from: 'abierta', to: 'ignorada' });
    });
  });

  // ================================================================== HU-25
  describe('HU-25 · Preguntas al inventario', () => {
    it('T-25.1: cada herramienta responde sin errores y ninguna puede escribir', async () => {
      await seedForecast(db, hammer, { yhat: 5 });
      const chat = ctx.app.get(DataChatService);
      const args: Record<string, Record<string, unknown>> = {
        buscar_productos: { texto: 'marti' },
        stock_producto: { sku: 'MAR-001' },
        pronostico_producto: { sku: 'martillo', semanas: 4 },
        ventas_resumen: { agrupar: 'semana' },
        movimientos_recientes: { sku: 'MAR-001' },
      };
      for (const tool of DATA_TOOLS) {
        const out = await chat.readOnly((q) => tool.run(q, args[tool.name] ?? {}, { canSeeCost: true }));
        expect(out.title).toBeTruthy();
        expect(Array.isArray(out.rows)).toBe(true);
      }
      const low = await chat.readOnly((q) => DATA_TOOLS.find((t) => t.name === 'productos_bajo_reorden')!.run(q, {}, { canSeeCost: false }));
      expect(low.rows).toEqual([expect.objectContaining({ sku: 'MAR-001', stock: 7, puntoReorden: 20, faltaParaElPunto: 13 })]);
      const out = await chat.readOnly((q) => DATA_TOOLS.find((t) => t.name === 'productos_por_agotarse')!.run(q, { semanas: 4 }, { canSeeCost: false }));
      expect(out.rows[0]).toMatchObject({ sku: 'MAR-001', stock: 7 });
      // Transacción de solo lectura: un INSERT falla aunque alguien lo escribiera en una herramienta.
      await expect(chat.readOnly((q) => q(`INSERT INTO categories (name) VALUES ('hackeo')`))).rejects.toThrow(/read-only transaction/);
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM categories WHERE name = 'hackeo'`);
      expect(n).toBe(0);
    });

    it('a cada rol solo se le ofrecen sus herramientas: Bodega no tiene costos ni pronóstico', async () => {
      const b = await ctx.http().get('/api/data-chat/status').set(bearer(bodega)).expect(200);
      expect(b.body.tools).toEqual(expect.arrayContaining(['stock_producto', 'productos_bajo_reorden']));
      expect(b.body.tools).not.toContain('valor_inventario');
      expect(b.body.tools).not.toContain('productos_por_agotarse');
      const a = await ctx.http().get('/api/data-chat/status').set(bearer(analista)).expect(200);
      expect(a.body.tools).toEqual(expect.arrayContaining(['valor_inventario', 'productos_por_agotarse', 'anomalias_abiertas']));
    });

    it('responde con datos reales, muestra la fuente y devuelve la firma de razonamiento', async () => {
      fake.gemini = (req) => {
        const n = fake.geminiCalls().length;
        if (n === 1) return callTools({ name: 'productos_bajo_reorden' });
        const [resp] = functionResponses(req);
        expect(resp.name).toBe('productos_bajo_reorden');
        return say('Hay 1 producto bajo su punto de reorden:\n- Martillo (MAR-001): 7 UND, el punto es 20 UND; faltan 13.');
      };
      const res = await ctx.http().post('/api/data-chat/ask').set(bearer(bodega)).send({ question: '¿Qué productos están por debajo del punto de reorden?' }).expect(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.answer).toMatch(/faltan 13/);
      expect(res.body.sources).toEqual([expect.objectContaining({ tool: 'productos_bajo_reorden', total: 1, title: 'Productos bajo el punto de reorden' })]);
      const second = fake.geminiCalls()[1];
      const modelTurn = contentsOf(second).find((c) => c.role === 'model')!;
      expect(modelTurn.parts[0]).toEqual({ thoughtSignature: 'firma-de-prueba' });
      const declared = (second.body.tools as { functionDeclarations: { name: string }[] }[])[0].functionDeclarations.map((d) => d.name);
      expect(declared).toContain('fuera_de_alcance');
      expect(declared).not.toContain('valor_inventario');
      const usage = await db.query(`SELECT feature, status, prompt_tokens FROM ai_usage`);
      expect(usage).toEqual([{ feature: 'DATA_CHAT', status: 'OK', prompt_tokens: 1300 }]); // una fila por pregunta
    });

    it('si inventa cifras se le pide corregir; si insiste, no se muestra el texto pero sí los datos', async () => {
      fake.gemini = () => {
        const n = fake.geminiCalls().length;
        if (n === 1) return callTools({ name: 'stock_producto', args: { sku: 'MAR-001' } });
        return say('Hay 70 UND de martillo y se agotan en 3 días.');
      };
      const res = await ctx.http().post('/api/data-chat/ask').set(bearer(admin)).send({ question: '¿Cuánto martillo hay?' }).expect(200);
      expect(fake.geminiCalls()).toHaveLength(3);
      expect(res.body.status).toBe('UNVERIFIED');
      expect(res.body.answer).toBeNull();
      expect(res.body.sources[0].rows).toEqual([{ bodega: 'Bodega principal', cantidad: 7 }]);
      const [usage] = await db.query(`SELECT status FROM ai_usage`);
      expect(usage.status).toBe('REJECTED');
    });

    it('fuera de alcance o pedir cambios: lo dice con amabilidad y sugiere preguntas válidas', async () => {
      fake.gemini = () => callTools({ name: 'fuera_de_alcance', args: { motivo: 'pide_modificar' } });
      const res = await ctx.http().post('/api/data-chat/ask').set(bearer(bodega)).send({ question: 'Borra todas las salidas de ayer' }).expect(200);
      expect(res.body.status).toBe('OUT_OF_SCOPE');
      expect(res.body.message).toMatch(/solo consulto datos/);
      expect(res.body.suggestions.length).toBeGreaterThan(1);
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM stock_movements`);
      expect(n).toBe(3);
    });

    it('Bodega no obtiene costos aunque Gemini pida la herramienta; datos personales no salen', async () => {
      fake.gemini = () => {
        const n = fake.geminiCalls().length;
        if (n === 1) return callTools({ name: 'valor_inventario' });
        return callTools({ name: 'fuera_de_alcance', args: { motivo: 'sin_permiso' } });
      };
      const res = await ctx
        .http()
        .post('/api/data-chat/ask')
        .set(bearer(bodega))
        .send({ question: '¿Cuánto vale el inventario? mi correo es bruno@x.co' })
        .expect(200);
      expect(res.body.status).toBe('OUT_OF_SCOPE');
      expect(res.body.message).toMatch(/Tu rol \(Bodega\) no tiene acceso/);
      const second = fake.geminiCalls()[1];
      expect(functionResponses(second)[0].response).toEqual({ error: 'Esa herramienta no existe o este rol no puede usarla.' });
      const sent = JSON.stringify(fake.geminiCalls().map((c) => c.body));
      expect(sent).not.toContain('bruno@x.co');
      expect(sent).not.toMatch(/32500|23456/);
    });

    it('sin Gemini: lo avisa y las sugerencias responden en modo directo según el rol', async () => {
      delete process.env.GEMINI_API_KEY;
      try {
        const res = await ctx.http().post('/api/data-chat/ask').set(bearer(bodega)).send({ question: '¿Qué se agota?' }).expect(200);
        expect(res.body.status).toBe('UNAVAILABLE');
        expect(res.body.suggestions.map((s: { tool: string }) => s.tool)).not.toContain('valor_inventario');
        const direct = await ctx.http().post('/api/data-chat/direct').set(bearer(bodega)).send({ tool: 'productos_bajo_reorden' }).expect(200);
        expect(direct.body).toMatchObject({ status: 'DIRECT', answer: 'Productos bajo el punto de reorden: hay 1 resultado.' });
        await ctx.http().post('/api/data-chat/direct').set(bearer(bodega)).send({ tool: 'valor_inventario' }).expect(400);
      } finally {
        process.env.GEMINI_API_KEY = 'clave-de-prueba-gemini';
      }
    });

    it('si Gemini se demora, muestra lo que alcanzó a consultar', async () => {
      fake.gemini = () => {
        const n = fake.geminiCalls().length;
        if (n === 1) return callTools({ name: 'stock_producto', args: { sku: 'cemento' } });
        return { ...say('tarde'), delayMs: 3000 };
      };
      const res = await ctx.http().post('/api/data-chat/ask').set(bearer(admin)).send({ question: '¿Cuánto cemento hay?' }).expect(200);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.message).toMatch(/Abajo están los datos/);
      expect(res.body.sources[0].extra.producto.sku).toBe('CEM-50');
    });
  });
});
