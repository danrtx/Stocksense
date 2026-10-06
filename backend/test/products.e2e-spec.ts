import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import { bearer, createTestApp, createUser, login, resetDatabase, TestContext } from './helpers';

describe('HU-04 Crear, editar y buscar productos', () => {
  let ctx: TestContext;
  let db: DataSource;
  let token: string;
  let tools: string;
  let paint: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    token = await login(ctx, 'marta@x.co');
    tools = (await ctx.http().post('/api/categories').set(bearer(token)).send({ name: 'Herramientas' }).expect(201)).body.id;
    paint = (await ctx.http().post('/api/categories').set(bearer(token)).send({ name: 'Pinturas' }).expect(201)).body.id;
  });

  const create = (body: object) => ctx.http().post('/api/products').set(bearer(token)).send(body);
  const base = () => ({ sku: 'MAR-001', name: 'Martillo de uña 16 oz', categoryId: tools, unit: 'UND', cost: 25900 });

  it('CA1: crea el producto con nombre, categoría, unidad de medida y costo', async () => {
    const res = await create({ ...base(), sku: '  mar-001 ' }).expect(201);
    expect(res.body).toMatchObject({
      sku: 'MAR-001',
      name: 'Martillo de uña 16 oz',
      unit: 'UND',
      cost: 25900,
      isActive: true,
      category: { id: tools, name: 'Herramientas' },
    });
  });

  it('CA2: un SKU repetido muestra un error que lo explica (sin importar mayúsculas)', async () => {
    await create(base()).expect(201);
    const res = await create({ ...base(), sku: 'mar-001', name: 'Otro martillo' }).expect(409);
    expect(res.body.message).toBe(
      'Ya existe un producto con el SKU MAR-001. Usa otro SKU o edita el producto existente.',
    );
  });

  it('T-04.1: la base de datos rechaza SKU duplicados aunque se salte la API', async () => {
    await create(base()).expect(201);
    await expect(
      db.query(`INSERT INTO products (sku, name, category_id, unit, cost) VALUES ('MAR-001', 'x', $1, 'UND', 1)`, [tools]),
    ).rejects.toThrow(/uq_products_sku/);
  });

  it('valida cada campo con su mensaje', async () => {
    const neg = await create({ ...base(), cost: -5 }).expect(400);
    expect(neg.body.message.join()).toMatch(/no puede ser negativo/);
    const noCat = await create({ ...base(), categoryId: undefined }).expect(400);
    expect(noCat.body.message.join()).toMatch(/Elige una categoría/);
    const badSku = await create({ ...base(), sku: 'con espacio' }).expect(400);
    expect(badSku.body.message.join()).toMatch(/sin espacios/);
    const badUnit = await create({ ...base(), unit: 'GALON' }).expect(400);
    expect(badUnit.body.message.join()).toMatch(/unidad de medida/);
  });

  it('CA3: busca por nombre, SKU o categoría y permite filtrar y paginar', async () => {
    await create(base()).expect(201);
    await create({ ...base(), sku: 'MAR-002', name: 'Martillo de goma' }).expect(201);
    await create({ ...base(), sku: 'PIN-100', name: 'Pintura blanca 1 galón', categoryId: paint }).expect(201);

    const byName = await ctx.http().get('/api/products?q=martillo').set(bearer(token)).expect(200);
    expect(byName.body.total).toBe(2);
    const bySku = await ctx.http().get('/api/products?q=pin-1').set(bearer(token)).expect(200);
    expect(bySku.body.items.map((p: { sku: string }) => p.sku)).toEqual(['PIN-100']);
    const byCategory = await ctx.http().get(`/api/products?categoryId=${paint}`).set(bearer(token)).expect(200);
    expect(byCategory.body.total).toBe(1);
    const page2 = await ctx.http().get('/api/products?limit=2&page=2&sort=sku').set(bearer(token)).expect(200);
    expect(page2.body).toMatchObject({ total: 3, page: 2, pages: 2 });
    expect(page2.body.items).toHaveLength(1);
  });

  it('los comodines de búsqueda se tratan como texto', async () => {
    await create(base()).expect(201);
    const res = await ctx.http().get('/api/products?q=%25').set(bearer(token)).expect(200);
    expect(res.body.total).toBe(0);
  });

  it('edita y desactiva productos dejando rastro en la auditoría', async () => {
    const { body } = await create(base()).expect(201);
    const edited = await ctx.http().patch(`/api/products/${body.id}`).set(bearer(token)).send({ cost: 27500 }).expect(200);
    expect(edited.body.cost).toBe(27500);

    await ctx.http().patch(`/api/products/${body.id}/active`).set(bearer(token)).send({ active: false }).expect(200);
    const active = await ctx.http().get('/api/products').set(bearer(token)).expect(200);
    expect(active.body.total).toBe(0);
    const all = await ctx.http().get('/api/products?active=all').set(bearer(token)).expect(200);
    expect(all.body.total).toBe(1);

    const audit: { action: string; changes: Record<string, unknown> }[] = await db.query(
      `SELECT action, changes FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [body.id],
    );
    expect(audit.map((a) => a.action)).toEqual(['product.created', 'product.updated', 'product.deactivated']);
    expect(audit[1].changes).toEqual({ cost: { from: 25900, to: 27500 } });
  });

  it('no deja cambiar el SKU a uno que ya existe', async () => {
    await create(base()).expect(201);
    const other = await create({ ...base(), sku: 'MAR-002' }).expect(201);
    await ctx.http().patch(`/api/products/${other.body.id}`).set(bearer(token)).send({ sku: 'mar-001' }).expect(409);
  });

  it('Bodega puede consultar productos pero no ve costos ni puede editarlos', async () => {
    await create(base()).expect(201);
    await createUser(db, { email: 'carlos@x.co', role: Role.Bodega });
    const bodega = await login(ctx, 'carlos@x.co');
    const res = await ctx.http().get('/api/products').set(bearer(bodega)).expect(200);
    expect(res.body.items[0].cost).toBeUndefined();
    await ctx.http().post('/api/products').set(bearer(bodega)).send({ ...base(), sku: 'X-1' }).expect(403);
  });

  it('T-04.2: el listado paginado y la búsqueda responden en menos de 1 segundo con 10.000 productos', async () => {
    await db.query(
      `INSERT INTO products (sku, name, category_id, unit, cost)
       SELECT 'DEMO-' || lpad(g::text, 6, '0'),
              (ARRAY['Tornillo','Martillo','Cable','Tubo PVC','Pintura'])[1 + g % 5] || ' modelo ' || g,
              CASE WHEN g % 2 = 0 THEN $1::uuid ELSE $2::uuid END, 'UND', 1000 + g
       FROM generate_series(1, 10000) g`,
      [tools, paint],
    );
    await db.query('ANALYZE products');

    for (const url of [
      '/api/products?page=1&limit=20',
      '/api/products?page=250&limit=20&sort=sku',
      '/api/products?q=martillo',
      `/api/products?q=cable&categoryId=${tools}`,
      '/api/products?q=DEMO-0099',
    ]) {
      const start = Date.now();
      const res = await ctx.http().get(url).set(bearer(token)).expect(200);
      const elapsed = Date.now() - start;
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000);
    }
  });
});
