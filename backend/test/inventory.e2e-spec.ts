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

describe('Sprints 2 y 3 · Bodegas, stock, movimientos, transferencias y conteos', () => {
  let ctx: TestContext;
  let db: DataSource;
  let admin: string;
  let bodega: string;
  let compras: string;
  let main: string;
  let north: string;
  let hammer: string;
  let cable: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'ana@x.co', role: Role.Admin });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    admin = await login(ctx, 'ana@x.co');
    bodega = await login(ctx, 'bruno@x.co');
    compras = await login(ctx, 'marta@x.co');
    main = await defaultWarehouseId(db);
    north = (
      await ctx.http().post('/api/warehouses').set(bearer(admin)).send({ code: 'norte', name: 'Bodega Norte' }).expect(201)
    ).body.id;
    const cat = await createCategory(db);
    hammer = await createProduct(db, { sku: 'MAR-001', name: 'Martillo', categoryId: cat, cost: 25000 });
    cable = await createProduct(db, { sku: 'CAB-12', name: 'Cable 12 AWG', categoryId: cat, unit: 'M', cost: 1800 });
  });

  const move = (token: string, body: object) => ctx.http().post('/api/movements').set(bearer(token)).send(body);

  describe('HU-06 Stock por bodega', () => {
    it('CA1: al abrir un producto veo su stock en cada bodega y el total', async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 30, reason: 'Inventario inicial' }).expect(201);
      await move(bodega, { productId: hammer, warehouseId: north, type: 'IN', quantity: 12, reason: 'Inventario inicial' }).expect(201);
      const res = await ctx.http().get(`/api/stock/products/${hammer}`).set(bearer(bodega)).expect(200);
      expect(res.body.warehouses.map((w: { name: string; quantity: number }) => [w.name, w.quantity])).toEqual([
        ['Bodega principal', 30],
        ['Bodega Norte', 12],
      ]);
      expect(res.body.total).toBe(42);
    });

    it('CA2: un producto sin movimientos aparece con 0 y no da error', async () => {
      const res = await ctx.http().get(`/api/stock/products/${cable}`).set(bearer(bodega)).expect(200);
      expect(res.body.total).toBe(0);
      expect(res.body.status).toBe('OUT');
      const list = await ctx.http().get('/api/stock?q=CAB').set(bearer(bodega)).expect(200);
      expect(list.body.items[0]).toMatchObject({ sku: 'CAB-12', quantity: 0, total: 0, byWarehouse: {} });
    });

    it('filtra el listado por bodega y estado', async () => {
      await move(bodega, { productId: hammer, warehouseId: north, type: 'IN', quantity: 5, reason: 'Compra local' }).expect(201);
      const inNorth = await ctx.http().get(`/api/stock?warehouseId=${north}&status=with_stock`).set(bearer(bodega)).expect(200);
      expect(inNorth.body.items.map((i: { sku: string }) => i.sku)).toEqual(['MAR-001']);
      const out = await ctx.http().get('/api/stock?status=out').set(bearer(bodega)).expect(200);
      expect(out.body.items.map((i: { sku: string }) => i.sku)).toEqual(['CAB-12']);
    });

    it('Bodega no ve el valor del stock; Compras sí', async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 2, reason: 'Compra local' }).expect(201);
      const asBodega = await ctx.http().get('/api/stock?q=MAR').set(bearer(bodega)).expect(200);
      expect(asBodega.body.items[0].value).toBeUndefined();
      const asCompras = await ctx.http().get('/api/stock?q=MAR').set(bearer(compras)).expect(200);
      expect(asCompras.body.items[0].value).toBe(50000);
    });

    it('CA3: el Administrador crea, renombra y desactiva bodegas; con stock no se puede desactivar', async () => {
      await ctx.http().patch(`/api/warehouses/${north}`).set(bearer(admin)).send({ name: 'Bodega Norte 2' }).expect(200);
      await move(bodega, { productId: hammer, warehouseId: north, type: 'IN', quantity: 3, reason: 'Compra local' }).expect(201);
      const blocked = await ctx.http().patch(`/api/warehouses/${north}/active`).set(bearer(admin)).send({ active: false }).expect(409);
      expect(blocked.body.message).toMatch(/todavía tiene stock \(3 unidades en 1 productos\)/);
      await move(bodega, { productId: hammer, warehouseId: north, type: 'OUT', quantity: 3, reason: 'Daño' }).expect(201);
      const off = await ctx.http().patch(`/api/warehouses/${north}/active`).set(bearer(admin)).send({ active: false }).expect(200);
      expect(off.body.isActive).toBe(false);
      const dup = await ctx.http().post('/api/warehouses').set(bearer(admin)).send({ code: 'NORTE', name: 'Otra' }).expect(409);
      expect(dup.body.message).toMatch(/código NORTE/);
    });

    it('solo el Administrador gestiona bodegas y la principal no se desactiva', async () => {
      await ctx.http().post('/api/warehouses').set(bearer(bodega)).send({ code: 'SUR', name: 'Sur' }).expect(403);
      const res = await ctx.http().patch(`/api/warehouses/${main}/active`).set(bearer(admin)).send({ active: false }).expect(409);
      expect(res.body.message).toMatch(/bodega principal/);
    });
  });

  describe('HU-07 Entradas y salidas', () => {
    it('CA1: una entrada de 20 sube el stock y guarda usuario, fecha y motivo', async () => {
      const res = await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 20, reason: 'Compra local' }).expect(201);
      expect(res.body.balance).toBe(20);
      expect(res.body.movement).toMatchObject({ type: 'IN', quantity: 20, balanceAfter: 20, reason: 'Compra local', userName: 'bruno' });
      expect(res.body.movement.createdAt).toBeTruthy();
    });

    it('CA2: una salida mayor al stock se rechaza e indica cuánto hay', async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 6, reason: 'Compra local' }).expect(201);
      const res = await move(bodega, { productId: hammer, warehouseId: main, type: 'OUT', quantity: 10, reason: 'Venta mostrador' }).expect(409);
      expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 6 });
      expect(res.body.message).toBe('Stock insuficiente de MAR-001 en Bodega principal: hay 6 UND disponibles y se pidieron 10.');
      expect(await stockOf(db, hammer, main)).toBe(6);
    });

    it('valida motivo, decimales según la unidad y permisos', async () => {
      const noReason = await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 1, reason: '' }).expect(400);
      expect(noReason.body.message.join()).toMatch(/motivo/);
      const decimals = await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 1.5, reason: 'Compra' }).expect(400);
      expect(decimals.body.message).toMatch(/unidades enteras/);
      await move(bodega, { productId: cable, warehouseId: main, type: 'IN', quantity: 12.5, reason: 'Compra' }).expect(201);
      await move(compras, { productId: hammer, warehouseId: main, type: 'IN', quantity: 1, reason: 'Compra' }).expect(403);
    });

    it('la base de datos impide stock negativo y editar movimientos', async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 1, reason: 'Compra' }).expect(201);
      await expect(db.query(`UPDATE stock_levels SET quantity = -1`)).rejects.toThrow(/ck_stock_levels_non_negative/);
      await expect(db.query(`UPDATE stock_movements SET quantity = 99`)).rejects.toThrow(/no se pueden modificar/);
      await expect(db.query(`DELETE FROM stock_movements`)).rejects.toThrow(/no se pueden modificar/);
    });

    it('salidas simultáneas nunca dejan el stock negativo', async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 5, reason: 'Compra' }).expect(201);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => move(bodega, { productId: hammer, warehouseId: main, type: 'OUT', quantity: 1, reason: 'Venta' })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await stockOf(db, hammer, main)).toBe(0);
    });
  });

  describe('HU-08 Transferencias', () => {
    beforeEach(async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 25, reason: 'Inicial' }).expect(201);
    });
    const transfer = (qty: number) =>
      ctx.http().post('/api/transfers').set(bearer(bodega)).send({
        fromWarehouseId: main,
        toWarehouseId: north,
        lines: [{ productId: hammer, quantity: qty }],
      });

    it('CA1: A baja 10, B sube 10 al confirmar y el total no cambia', async () => {
      const created = await transfer(10).expect(201);
      expect(created.body).toMatchObject({ code: 'TR-000001', status: 'PENDING' });
      expect(await stockOf(db, hammer, main)).toBe(15);
      const pending = await ctx.http().get(`/api/stock/products/${hammer}`).set(bearer(bodega)).expect(200);
      expect(pending.body).toMatchObject({ onHand: 15, inTransit: 10, total: 25 });

      const received = await ctx.http().post(`/api/transfers/${created.body.id}/receive`).set(bearer(bodega)).expect(200);
      // CA3: estado y quién la confirmó en destino.
      expect(received.body).toMatchObject({ status: 'RECEIVED', receivedBy: 'bruno' });
      expect(await stockOf(db, hammer, north)).toBe(10);
      const after = await ctx.http().get(`/api/stock/products/${hammer}`).set(bearer(bodega)).expect(200);
      expect(after.body).toMatchObject({ onHand: 25, inTransit: 0, total: 25 });
    });

    it('CA2: si A tiene 6 y pido 10, se rechaza', async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'OUT', quantity: 19, reason: 'Venta' }).expect(201);
      const res = await transfer(10).expect(409);
      expect(res.body.message).toMatch(/hay 6 UND disponibles/);
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM transfers`);
      expect(n).toBe(0);
    });

    it('no se confirma dos veces y cancelar devuelve el stock', async () => {
      const t = await transfer(4).expect(201);
      await ctx.http().post(`/api/transfers/${t.body.id}/cancel`).set(bearer(bodega)).expect(200);
      expect(await stockOf(db, hammer, main)).toBe(25);
      const again = await ctx.http().post(`/api/transfers/${t.body.id}/receive`).set(bearer(bodega)).expect(409);
      expect(again.body.message).toMatch(/fue cancelada/);
      const list = await ctx.http().get('/api/transfers').set(bearer(bodega)).expect(200);
      expect(list.body.items[0]).toMatchObject({ status: 'CANCELLED', cancelledBy: 'bruno', lineCount: 1, totalQuantity: 4 });
    });

    it('rechaza origen igual a destino', async () => {
      const res = await ctx.http().post('/api/transfers').set(bearer(bodega)).send({
        fromWarehouseId: main,
        toWarehouseId: main,
        lines: [{ productId: hammer, quantity: 1 }],
      }).expect(400);
      expect(res.body.message).toMatch(/distintas/);
    });
  });

  describe('HU-09 Conteo físico', () => {
    beforeEach(async () => {
      await move(bodega, { productId: hammer, warehouseId: main, type: 'IN', quantity: 20, reason: 'Inicial' }).expect(201);
      await move(bodega, { productId: cable, warehouseId: main, type: 'IN', quantity: 100, reason: 'Inicial' }).expect(201);
    });

    it('CA1-CA3: diferencias por producto, aprobación del Administrador y ajuste con motivo «Conteo físico»', async () => {
      const count = await ctx.http().post('/api/counts').set(bearer(bodega)).send({ warehouseId: main }).expect(201);
      expect(count.body.code).toBe('CF-000001');
      expect(count.body.lines).toHaveLength(2);

      const saved = await ctx.http().put(`/api/counts/${count.body.id}/lines`).set(bearer(bodega)).send({
        lines: [
          { productId: hammer, countedQty: 18 },
          { productId: cable, countedQty: 100 },
        ],
      }).expect(200);
      const byS = Object.fromEntries(saved.body.lines.map((l: { sku: string; difference: number }) => [l.sku, l.difference]));
      expect(byS).toEqual({ 'MAR-001': -2, 'CAB-12': 0 });

      const submitted = await ctx.http().post(`/api/counts/${count.body.id}/submit`).set(bearer(bodega)).expect(200);
      expect(submitted.body).toMatchObject({ status: 'SUBMITTED', summary: { counted: 2, withDifference: 1, shortage: -2 } });

      // Bodega no puede aprobar; el stock no cambia hasta la aprobación.
      await ctx.http().post(`/api/counts/${count.body.id}/approve`).set(bearer(bodega)).send({}).expect(403);
      expect(await stockOf(db, hammer, main)).toBe(20);

      await ctx.http().post(`/api/counts/${count.body.id}/approve`).set(bearer(admin)).send({ notes: 'OK' }).expect(200);
      expect(await stockOf(db, hammer, main)).toBe(18);
      const [movement] = await db.query(`SELECT type, quantity::float AS q, reason FROM stock_movements WHERE reference_type = 'stock_count'`);
      expect(movement).toEqual({ type: 'ADJUSTMENT', q: -2, reason: 'Conteo físico' });
      const [audit] = await db.query(`SELECT changes FROM audit_logs WHERE action = 'count.approved'`);
      expect(audit.changes.adjustments).toEqual([{ sku: 'MAR-001', difference: -2 }]);
    });

    it('un conteo rechazado no cambia el stock y solo hay uno activo por bodega', async () => {
      const count = await ctx.http().post('/api/counts').set(bearer(bodega)).send({ warehouseId: main }).expect(201);
      const dup = await ctx.http().post('/api/counts').set(bearer(bodega)).send({ warehouseId: main }).expect(409);
      expect(dup.body.message).toMatch(/Ya hay un conteo abierto/);
      await ctx.http().put(`/api/counts/${count.body.id}/lines`).set(bearer(bodega)).send({ lines: [{ productId: hammer, countedQty: 5 }] }).expect(200);
      await ctx.http().post(`/api/counts/${count.body.id}/submit`).set(bearer(bodega)).expect(200);
      const noNotes = await ctx.http().post(`/api/counts/${count.body.id}/reject`).set(bearer(admin)).send({}).expect(400);
      expect(noNotes.body.message.join()).toMatch(/por qué rechazas/);
      await ctx.http().post(`/api/counts/${count.body.id}/reject`).set(bearer(admin)).send({ notes: 'Recontar' }).expect(200);
      expect(await stockOf(db, hammer, main)).toBe(20);
      await ctx.http().post('/api/counts').set(bearer(bodega)).send({ warehouseId: main }).expect(201);
    });

    it('no se envía un conteo sin cantidades', async () => {
      const count = await ctx.http().post('/api/counts').set(bearer(bodega)).send({ warehouseId: main }).expect(201);
      const res = await ctx.http().post(`/api/counts/${count.body.id}/submit`).set(bearer(bodega)).expect(400);
      expect(res.body.message).toMatch(/al menos un producto/);
    });
  });
});
