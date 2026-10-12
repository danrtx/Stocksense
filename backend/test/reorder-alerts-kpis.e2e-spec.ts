import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import {
  bearer,
  createCategory,
  createProduct,
  createTestApp,
  createUser,
  defaultWarehouseId,
  login,
  resetDatabase,
  TestContext,
} from './helpers';

describe('Sprints 4 y 5 · Punto de reorden, alertas y KPIs', () => {
  let ctx: TestContext;
  let db: DataSource;
  let admin: string;
  let compras: string;
  let bodega: string;
  let main: string;
  let tools: string;
  let paint: string;
  let hammer: string;
  let brush: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    ctx.mail.outbox.length = 0;
    await createUser(db, { email: 'ana@x.co', role: Role.Admin });
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    await createUser(db, { email: 'lina@x.co', role: Role.Analista });
    admin = await login(ctx, 'ana@x.co');
    compras = await login(ctx, 'marta@x.co');
    bodega = await login(ctx, 'bruno@x.co');
    main = await defaultWarehouseId(db);
    tools = await createCategory(db, 'Herramientas');
    paint = await createCategory(db, 'Pinturas');
    hammer = await createProduct(db, { sku: 'MAR-001', name: 'Martillo', categoryId: tools, cost: 20000 });
    brush = await createProduct(db, { sku: 'BRO-2', name: 'Brocha 2"', categoryId: paint, cost: 5000 });
  });

  const move = (productId: string, type: 'IN' | 'OUT', quantity: number) =>
    ctx.http().post('/api/movements').set(bearer(bodega)).send({ productId, warehouseId: main, type, quantity, reason: 'Prueba' }).expect(201);
  const setReorder = (id: string, body: object) => ctx.http().patch(`/api/products/${id}/reorder`).set(bearer(compras)).send(body);

  describe('HU-15 Punto de reorden', () => {
    it('CA1: se guardan y aparecen en la ficha del producto', async () => {
      const res = await setReorder(hammer, { reorderPoint: 12, safetyStock: 4 }).expect(200);
      expect(res.body).toMatchObject({ reorderPoint: 12, safetyStock: 4 });
      const product = await ctx.http().get(`/api/products/${hammer}`).set(bearer(compras)).expect(200);
      expect(product.body).toMatchObject({ reorderPoint: 12, safetyStock: 4 });
    });

    it('CA2: no acepta valores negativos ni vacíos', async () => {
      const negative = await setReorder(hammer, { reorderPoint: -1, safetyStock: 0 }).expect(400);
      expect(negative.body.message.join()).toMatch(/no puede ser negativo/);
      const empty = await setReorder(hammer, { reorderPoint: '', safetyStock: 2 }).expect(400);
      expect(empty.body.message.join()).toMatch(/obligatorio/);
      const missing = await setReorder(hammer, { reorderPoint: 5 }).expect(400);
      expect(missing.body.message.join()).toMatch(/stock de seguridad es obligatorio/);
      const bigger = await setReorder(hammer, { reorderPoint: 5, safetyStock: 8 }).expect(400);
      expect(bigger.body.message).toMatch(/no puede ser mayor que el punto de reorden/);
    });

    it('CA3: edita varios productos a la vez por categoría', async () => {
      const other = await createProduct(db, { sku: 'MAR-002', categoryId: tools });
      const res = await ctx.http().patch('/api/products/reorder').set(bearer(compras)).send({ categoryId: tools, reorderPoint: 20, safetyStock: 5 }).expect(200);
      expect(res.body.updated).toBe(2);
      const rows = await db.query(`SELECT sku, reorder_point::float AS rp FROM products ORDER BY sku`);
      expect(rows).toEqual([
        { sku: 'BRO-2', rp: null },
        { sku: 'MAR-001', rp: 20 },
        { sku: 'MAR-002', rp: 20 },
      ]);
      await ctx.http().patch(`/api/products/${other}/reorder`).set(bearer(compras)).send({ reorderPoint: 3, safetyStock: 1 }).expect(200);
      const onlyEmpty = await ctx.http().patch('/api/products/reorder').set(bearer(compras)).send({ categoryId: paint, reorderPoint: 7, safetyStock: 2, onlyEmpty: true }).expect(200);
      expect(onlyEmpty.body.updated).toBe(1);
      await ctx.http().patch('/api/products/reorder').set(bearer(bodega)).send({ categoryId: tools, reorderPoint: 1, safetyStock: 0 }).expect(403);
    });

    it('T-15.3: sugiere el punto de reorden con la fórmula', async () => {
      const s = await ctx.http().post('/api/suppliers').set(bearer(compras)).send({ name: 'Andina', leadTimeDays: 10 }).expect(201);
      await ctx.http().post(`/api/suppliers/${s.body.id}/products`).set(bearer(compras)).send({ productId: hammer }).expect(201);
      await db.query(
        `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source) SELECT $1, $2, CURRENT_DATE - g, 2, 'IMPORT' FROM generate_series(1, 45) g`,
        [hammer, main],
      );
      await setReorder(hammer, { reorderPoint: 10, safetyStock: 5 }).expect(200);
      const res = await ctx.http().get(`/api/products/${hammer}/reorder-suggestion`).set(bearer(compras)).expect(200);
      // 90 unidades en 90 días = 1/día × 10 días + 5 de seguridad = 15
      expect(res.body).toMatchObject({ avgDailyDemand: 1, leadTimeDays: 10, safetyStock: 5, suggestedReorderPoint: 15 });
    });
  });

  describe('HU-16 Alertas de stock bajo', () => {
    beforeEach(async () => {
      await move(hammer, 'IN', 30);
      await setReorder(hammer, { reorderPoint: 10, safetyStock: 3 }).expect(200);
    });

    it('CA1: al caer bajo el punto de reorden se crea la alerta y llega un correo', async () => {
      ctx.mail.outbox.length = 0;
      await move(hammer, 'OUT', 22);
      const alerts = await ctx.http().get('/api/alerts').set(bearer(compras)).expect(200);
      expect(alerts.body.items).toHaveLength(1);
      expect(alerts.body.items[0]).toMatchObject({ status: 'OPEN', currentStock: 8, reorderPoint: 10, product: { sku: 'MAR-001' } });
      // Reciben quienes ven alertas (Admin, Compras, Bodega); el Analista no.
      expect(ctx.mail.outbox.map((m) => m.to).sort()).toEqual(['ana@x.co', 'bruno@x.co', 'marta@x.co']);
      expect(ctx.mail.outbox[0].subject).toBe('Stock bajo: MAR-001 Martillo');
      expect(ctx.mail.outbox[0].text).toContain('quedan 8 UND (punto de reorden 10)');
      const summary = await ctx.http().get('/api/alerts/summary').set(bearer(bodega)).expect(200);
      expect(summary.body).toEqual({ open: 1, seen: 0 });
    });

    it('CA2: la misma alerta no se repite más de una vez al día', async () => {
      await move(hammer, 'OUT', 22); // abre y avisa
      await move(hammer, 'OUT', 2); // sigue abierta: no avisa
      await move(hammer, 'IN', 10); // se recupera: se cierra
      await move(hammer, 'OUT', 10); // vuelve a caer el mismo día: se reabre sin correo
      expect(ctx.mail.outbox.filter((m) => m.to === 'marta@x.co')).toHaveLength(1);
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM stock_alerts`);
      expect(n).toBe(1);
      // Pasadas 24 horas sí vuelve a avisar.
      await move(hammer, 'IN', 10);
      await db.query(`UPDATE stock_alerts SET last_notified_at = now() - interval '25 hours'`);
      await move(hammer, 'OUT', 10);
      expect(ctx.mail.outbox.filter((m) => m.to === 'marta@x.co')).toHaveLength(2);
    });

    it('CA3: cuando el stock se recupera, la alerta se cierra sola', async () => {
      await move(hammer, 'OUT', 25);
      await move(hammer, 'IN', 20);
      const active = await ctx.http().get('/api/alerts').set(bearer(compras)).expect(200);
      expect(active.body.total).toBe(0);
      const resolved = await ctx.http().get('/api/alerts?status=RESOLVED').set(bearer(compras)).expect(200);
      expect(resolved.body.items[0]).toMatchObject({ status: 'RESOLVED', currentStock: 25 });
    });

    it('subir el punto de reorden también abre la alerta; marcarla como vista cambia su estado', async () => {
      await setReorder(hammer, { reorderPoint: 40, safetyStock: 10 }).expect(200);
      const list = await ctx.http().get('/api/alerts').set(bearer(compras)).expect(200);
      expect(list.body.total).toBe(1);
      await ctx.http().patch(`/api/alerts/${list.body.items[0].id}/seen`).set(bearer(compras)).expect(200);
      const seen = await ctx.http().get('/api/alerts?status=SEEN').set(bearer(compras)).expect(200);
      expect(seen.body.items[0]).toMatchObject({ status: 'SEEN', seenBy: 'marta' });
    });

    it('cada persona puede apagar el correo de alertas', async () => {
      const prefs = await ctx.http().patch('/api/auth/me/preferences').set(bearer(compras)).send({ notifyStockAlertsEmail: false }).expect(200);
      expect(prefs.body.user.preferences).toEqual({ notifyStockAlertsEmail: false });
      ctx.mail.outbox.length = 0;
      await move(hammer, 'OUT', 25);
      expect(ctx.mail.outbox.map((m) => m.to)).not.toContain('marta@x.co');
      const analista = await login(ctx, 'lina@x.co');
      await ctx.http().get('/api/alerts').set(bearer(analista)).expect(403);
    });
  });

  describe('HU-27 KPIs del panel', () => {
    it('CA1-CA3: valor, bajo reorden, sin movimiento en 90 días y rotación, con filtros', async () => {
      const north = (await ctx.http().post('/api/warehouses').set(bearer(admin)).send({ code: 'NORTE', name: 'Norte' }).expect(201)).body.id;
      await setReorder(hammer, { reorderPoint: 10, safetyStock: 2 }).expect(200);
      await move(hammer, 'IN', 5); // 5 × 20.000 = 100.000, bajo reorden
      await ctx.http().post('/api/movements').set(bearer(bodega)).send({ productId: brush, warehouseId: north, type: 'IN', quantity: 20, reason: 'Inicial' }).expect(201);
      // La brocha no se mueve hace 100 días.
      await db.query(`ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_movements_immutable`);
      await db.query(`UPDATE stock_movements SET created_at = now() - interval '100 days' WHERE product_id = $1`, [brush]);
      await db.query(`ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_movements_immutable`);
      // Ventas del último año: 40 martillos = 800.000 de costo vendido.
      await db.query(
        `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source) VALUES ($1, $2, CURRENT_DATE - 364, 20, 'IMPORT'), ($1, $2, CURRENT_DATE - 10, 20, 'IMPORT')`,
        [hammer, main],
      );

      const all = await ctx.http().get('/api/dashboard/kpis').set(bearer(compras)).expect(200);
      expect(all.body).toMatchObject({
        inventoryValue: 200000, // 100.000 + 20 × 5.000
        belowReorder: { count: 1, top: [{ sku: 'MAR-001', stock: 5, reorderPoint: 10 }] },
        noMovement90d: { count: 1, value: 100000, top: [{ sku: 'BRO-2' }] },
        rotation: { value: 4, basis: 'cost', daysOfInventory: 91 },
      });
      expect(all.body.generatedInMs).toBeLessThan(2000);

      const byWarehouse = await ctx.http().get(`/api/dashboard/kpis?warehouseId=${north}`).set(bearer(compras)).expect(200);
      expect(byWarehouse.body).toMatchObject({ inventoryValue: 100000, belowReorder: { count: 0 }, noMovement90d: { count: 1 } });
      const byCategory = await ctx.http().get(`/api/dashboard/kpis?categoryId=${tools}`).set(bearer(compras)).expect(200);
      expect(byCategory.body).toMatchObject({ inventoryValue: 100000, noMovement90d: { count: 0 } });

      // Bodega ve los indicadores en unidades, sin valores.
      const asBodega = await ctx.http().get('/api/dashboard/kpis').set(bearer(bodega)).expect(200);
      expect(asBodega.body.inventoryValue).toBeUndefined();
      expect(asBodega.body.noMovement90d.value).toBeUndefined();
      expect(asBodega.body.rotation.basis).toBe('units');
    });
  });

  describe('HU-18 Datos del modelo (lado API)', () => {
    it('muestra el estado de las series y explica si el servicio no está configurado', async () => {
      await db.query(`INSERT INTO forecast_series (product_id, first_week, last_week, weeks_of_history, total_quantity, status)
                      VALUES ($1, '2026-01-05', '2026-06-29', 26, 120, 'READY'), ($2, '2026-06-01', '2026-06-29', 5, 7, 'INSUFFICIENT_DATA')`, [hammer, brush]);
      const analista = await login(ctx, 'lina@x.co');
      const status = await ctx.http().get('/api/forecast/data-status').set(bearer(analista)).expect(200);
      expect(status.body.series).toMatchObject({ total: 2, ready: 1, insufficient: 1 });
      const insufficient = await ctx.http().get('/api/forecast/series?status=INSUFFICIENT_DATA').set(bearer(analista)).expect(200);
      expect(insufficient.body.items.map((i: { sku: string }) => i.sku)).toEqual(['BRO-2']);
      const run = await ctx.http().post('/api/forecast/runs').set(bearer(analista)).expect(503);
      expect(run.body.message).toMatch(/FORECAST_URL/);
      await ctx.http().post('/api/forecast/runs').set(bearer(bodega)).expect(403);
    });
  });
});
