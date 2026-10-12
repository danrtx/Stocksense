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
  seedForecast,
  TestContext,
} from './helpers';

describe('Sprint 8 · HU-17 Sugerencias de reposición', () => {
  let ctx: TestContext;
  let db: DataSource;
  let compras: string;
  let bodega: string;
  let analista: string;
  let main: string;
  let supplier: string;
  let hammer: string;
  let nails: string;
  let loose: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    await createUser(db, { email: 'lina@x.co', role: Role.Analista });
    [compras, bodega, analista] = await Promise.all(['marta@x.co', 'bruno@x.co', 'lina@x.co'].map((e) => login(ctx, e)));
    main = await defaultWarehouseId(db);
    const tools = await createCategory(db, 'Herramientas');
    hammer = await createProduct(db, { sku: 'MAR-001', name: 'Martillo', categoryId: tools, cost: 20000, safetyStock: 5, reorderPoint: 20 });
    nails = await createProduct(db, { sku: 'CLA-2', name: 'Clavo', categoryId: tools, cost: 50 });
    loose = await createProduct(db, { sku: 'SUELTO', name: 'Sin proveedor', categoryId: tools });
    const res = await ctx.http().post('/api/suppliers').set(bearer(compras)).send({ name: 'Ferretería Andina', leadTimeDays: 7 }).expect(201);
    supplier = res.body.id;
    for (const productId of [hammer, nails]) {
      await ctx.http().post(`/api/suppliers/${supplier}/products`).set(bearer(compras)).send({ productId, isPrimary: true, unitCost: 18000 }).expect(201);
    }
    // 14 por semana = 2 por día; 10 martillos en bodega.
    await seedForecast(db, hammer, { weekly: 14, yhat: 14 });
    await seedForecast(db, nails, { weekly: 14, yhat: 14 });
    await seedForecast(db, loose, { weekly: 14, yhat: 14 });
    await db.query(`INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES ($1, $2, 10), ($3, $2, 500)`, [hammer, main, nails]);
  });

  it('CA1 y CA2: cantidad y fecha por producto con el cálculo a la vista', async () => {
    const res = await ctx.http().get('/api/purchase-suggestions').set(bearer(compras)).expect(200);
    expect(res.body.withoutSupplier).toBe(1);
    expect(res.body.items).toHaveLength(1); // los clavos alcanzan
    const [s] = res.body.items;
    expect(s.product.sku).toBe('MAR-001');
    expect(s).toMatchObject({
      quantity: 23, // 2/día × (7 entrega + 7 revisión) + 5 seguridad − 10 en bodega
      urgency: 'NOW',
      demandLeadReview: 28,
      safetyStock: 5,
      onHand: 10,
      onOrder: 0,
      target: 33,
      reviewDays: 7,
      unitCost: 18000,
      subtotal: 414000,
    });
    expect(s.supplier).toMatchObject({ name: 'Ferretería Andina', leadTimeDays: 7, leadTimeSource: 'AGREED' });
    expect(s.orderBy).toBe(res.body.today);

    const analyst = await ctx.http().get('/api/purchase-suggestions').set(bearer(analista)).expect(200);
    expect(analyst.body.items[0].unitCost).toBe(18000); // Analista sí ve costos (products:cost:read)
    await ctx.http().get('/api/purchase-suggestions').set(bearer(bodega)).expect(403);
  });

  it('CA3: un clic crea el borrador de la orden y la sugerencia descuenta lo pedido al enviarla', async () => {
    const draft = await ctx.http().post('/api/purchase-suggestions/draft').set(bearer(compras)).send({ supplierId: supplier, productIds: [hammer] }).expect(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', code: 'OC-000001' });
    expect(draft.body.lines).toHaveLength(1);
    expect(draft.body.lines[0]).toMatchObject({ quantity: 23, unitCost: 18000 });
    expect(draft.body.notes).toContain('Sugerencias de compra');

    let res = await ctx.http().get('/api/purchase-suggestions').set(bearer(compras)).expect(200);
    expect(res.body.items[0]).toMatchObject({ inDraft: 23, draftCode: 'OC-000001', quantity: 23 });

    await ctx.http().post(`/api/purchase-orders/${draft.body.id}/send`).set(bearer(compras)).expect(200);
    res = await ctx.http().get('/api/purchase-suggestions').set(bearer(compras)).expect(200);
    expect(res.body.items).toHaveLength(0); // ya está pedido

    await ctx.http().post('/api/purchase-suggestions/draft').set(bearer(compras)).send({ supplierId: supplier, productIds: [hammer] }).expect(409);
    await ctx.http().post('/api/purchase-suggestions/draft').set(bearer(analista)).send({ supplierId: supplier, productIds: [hammer] }).expect(403);
  });

  it('sin pronóstico activo no hay sugerencias y lo dice', async () => {
    await db.query(`UPDATE forecast_runs SET is_active = false`);
    const res = await ctx.http().get('/api/purchase-suggestions').set(bearer(compras)).expect(200);
    expect(res.body).toMatchObject({ run: null, items: [] });
  });
});
