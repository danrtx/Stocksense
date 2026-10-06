import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import { bearer, createTestApp, createUser, login, resetDatabase, TestContext } from './helpers';

describe('Resumen del panel', () => {
  let ctx: TestContext;
  let db: DataSource;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());

  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'admin@x.co', role: Role.Admin, fullName: 'Sofía Admin' });
    await createUser(db, { email: 'bodega@x.co', role: Role.Bodega });
    const [tools] = await db.query(`INSERT INTO categories (name) VALUES ('Herramientas') RETURNING id`);
    const [paint] = await db.query(`INSERT INTO categories (name) VALUES ('Pinturas') RETURNING id`);
    await db.query(`INSERT INTO categories (name) VALUES ('Vacía')`);
    await db.query(
      `INSERT INTO products (sku, name, category_id, unit, cost, is_active) VALUES
        ('H-1', 'Martillo', $1, 'UND', 100, true),
        ('H-2', 'Llave', $1, 'UND', 200, true),
        ('H-3', 'Viejo', $1, 'UND', 999, false),
        ('P-1', 'Pintura', $2, 'L', 300, true)`,
      [tools.id, paint.id],
    );
  });

  it('el administrador ve catálogo, costos, equipo y actividad', async () => {
    const token = await login(ctx, 'admin@x.co');
    const res = await ctx.http().get('/api/dashboard/summary').set(bearer(token)).expect(200);

    expect(res.body.catalog).toEqual({ active: 3, inactive: 1, categories: 3, createdLast7Days: 3, averageCost: 200 });
    expect(res.body.byCategory.map((c: { name: string; count: number }) => [c.name, c.count])).toEqual([
      ['Herramientas', 2],
      ['Pinturas', 1],
      ['Vacía', 0],
    ]);
    expect(res.body.byCategory[0].averageCost).toBe(150);
    expect(res.body.recentProducts).toHaveLength(3);
    expect(res.body.recentProducts[0].cost).toEqual(expect.any(Number));
    expect(res.body.team).toMatchObject({ active: 2, invited: 0 });
    expect(Array.isArray(res.body.activity)).toBe(true);
  });

  it('Bodega no recibe costos, equipo ni actividad', async () => {
    const token = await login(ctx, 'bodega@x.co');
    const res = await ctx.http().get('/api/dashboard/summary').set(bearer(token)).expect(200);
    expect(res.body.catalog.averageCost).toBeUndefined();
    expect(res.body.byCategory[0].averageCost).toBeUndefined();
    expect(res.body.recentProducts[0].cost).toBeUndefined();
    expect(res.body.team).toBeUndefined();
    expect(res.body.activity).toBeUndefined();
  });

  it('exige sesión', async () => {
    await ctx.http().get('/api/dashboard/summary').expect(401);
  });
});
