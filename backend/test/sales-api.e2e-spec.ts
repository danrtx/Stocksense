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
  stockOf,
  TestContext,
} from './helpers';

describe('HU-14 Ventas por API desde el punto de venta', () => {
  let ctx: TestContext;
  let db: DataSource;
  let admin: string;
  let key: string;
  let keyId: string;
  let main: string;
  let hammer: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'ana@x.co', role: Role.Admin });
    admin = await login(ctx, 'ana@x.co');
    main = await defaultWarehouseId(db);
    hammer = await createProduct(db, { sku: 'MAR-001', categoryId: await createCategory(db) });
    await ctx.http().post('/api/movements').set(bearer(admin)).send({ productId: hammer, warehouseId: main, type: 'IN', quantity: 10, reason: 'Inicial' }).expect(201);
    const created = await ctx.http().post('/api/api-keys').set(bearer(admin)).send({ name: 'Caja tienda centro' }).expect(201);
    key = created.body.key;
    keyId = created.body.id;
  });

  const sell = (body: object, apiKey: string | null = key) => {
    const req = ctx.http().post('/api/integrations/sales');
    return apiKey ? req.set('X-Api-Key', apiKey).send(body) : req.send(body);
  };

  it('la clave se muestra una sola vez y solo se guarda su hash', async () => {
    expect(key).toMatch(/^ssk_/);
    const [row] = await db.query(`SELECT key_hash, prefix FROM api_keys`);
    expect(row.key_hash).not.toContain(key);
    expect(key.startsWith(row.prefix)).toBe(true);
    const list = await ctx.http().get('/api/api-keys').set(bearer(admin)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(key);
  });

  it('CA1: con clave válida el stock baja y la venta queda en el historial', async () => {
    const res = await sell({ externalId: 'POS1-0001', sku: 'mar-001', quantity: 2, unitPrice: 32900 }).expect(201);
    expect(res.body).toMatchObject({ status: 'created', sale: { externalId: 'POS1-0001', sku: 'MAR-001', quantity: 2, stockAfter: 8, warehouseCode: 'PRINCIPAL' } });
    expect(await stockOf(db, hammer, main)).toBe(8);
    const [movement] = await db.query(`SELECT type, reason, user_id FROM stock_movements WHERE type = 'SALE'`);
    expect(movement).toEqual({ type: 'SALE', reason: 'Venta POS1-0001 (Caja tienda centro)', user_id: null });
  });

  it('T-14.2: reenviar la misma venta no la duplica ni descuenta dos veces', async () => {
    await sell({ externalId: 'POS1-0002', sku: 'MAR-001', quantity: 3 }).expect(201);
    const again = await sell({ externalId: 'POS1-0002', sku: 'MAR-001', quantity: 3 }).expect(200);
    expect(again.body.status).toBe('duplicate');
    const parallel = await Promise.all([1, 2, 3].map(() => sell({ externalId: 'POS1-0003', sku: 'MAR-001', quantity: 1 })));
    expect(parallel.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await stockOf(db, hammer, main)).toBe(6);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM sales`);
    expect(n).toBe(2);
  });

  it('CA2: con clave inválida, ausente o revocada responde 401 y no guarda nada', async () => {
    await sell({ externalId: 'X-1', sku: 'MAR-001', quantity: 1 }, null).expect(401);
    const bad = await sell({ externalId: 'X-1', sku: 'MAR-001', quantity: 1 }, 'ssk_inventada').expect(401);
    expect(bad.body.message).toBe('La clave de API no es válida o fue revocada.');
    await ctx.http().delete(`/api/api-keys/${keyId}`).set(bearer(admin)).expect(204);
    await sell({ externalId: 'X-1', sku: 'MAR-001', quantity: 1 }).expect(401);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM sales`);
    expect(n).toBe(0);
    expect(await stockOf(db, hammer, main)).toBe(10);
  });

  it('sin stock suficiente o con SKU desconocido no guarda nada', async () => {
    const res = await sell({ externalId: 'POS1-9', sku: 'MAR-001', quantity: 50 }).expect(409);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 10 });
    await sell({ externalId: 'POS1-10', sku: 'NO-EXISTE', quantity: 1 }).expect(404);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM sales`);
    expect(n).toBe(0);
  });

  it('valida el cuerpo y la sesión de usuario no sirve como clave', async () => {
    const res = await sell({ sku: 'MAR-001', quantity: 0 }).expect(400);
    expect(res.body.message.join()).toMatch(/externalId/);
    await ctx.http().post('/api/integrations/sales').set(bearer(admin)).send({ externalId: 'a', sku: 'MAR-001', quantity: 1 }).expect(401);
    const ping = await ctx.http().get('/api/integrations/ping').set('X-Api-Key', key).expect(200);
    expect(ping.body).toEqual({ ok: true, client: 'Caja tienda centro' });
  });

  it('CA3: la API está documentada con OpenAPI y ejemplos', async () => {
    const res = await ctx.http().get('/api/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(['/api/integrations/ping', '/api/integrations/sales']);
    const post = res.body.paths['/api/integrations/sales'].post;
    expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(['200', '201', '401', '409']));
    expect(post.requestBody.content['application/json'].examples.minima.value).toMatchObject({ sku: 'MAR-001' });
    expect(res.body.components.securitySchemes['api-key']).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-Api-Key' });
    const html = await ctx.http().get('/api/docs').expect(200);
    expect(html.text).toContain('swagger-ui');
  });

  it('solo el Administrador gestiona claves', async () => {
    await createUser(db, { email: 'lina@x.co', role: Role.Analista });
    const analista = await login(ctx, 'lina@x.co');
    await ctx.http().post('/api/api-keys').set(bearer(analista)).send({ name: 'Otra caja' }).expect(403);
  });
});
