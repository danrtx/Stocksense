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

describe('Sprints 2 y 4 · Proveedores, órdenes de compra y recepción', () => {
  let ctx: TestContext;
  let db: DataSource;
  let compras: string;
  let bodega: string;
  let main: string;
  let cat: string;
  let p1: string;
  let p2: string;
  let p3: string;
  let orphan: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    compras = await login(ctx, 'marta@x.co');
    bodega = await login(ctx, 'bruno@x.co');
    main = await defaultWarehouseId(db);
    cat = await createCategory(db);
    p1 = await createProduct(db, { sku: 'TOR-1', categoryId: cat, cost: 100 });
    p2 = await createProduct(db, { sku: 'TOR-2', categoryId: cat, cost: 250.5 });
    p3 = await createProduct(db, { sku: 'TOR-3', categoryId: cat, unit: 'KG', cost: 8000 });
    orphan = await createProduct(db, { sku: 'SIN-PROV', name: 'Producto sin proveedor', categoryId: cat });
  });

  const newSupplier = (body: object = {}) =>
    ctx.http().post('/api/suppliers').set(bearer(compras)).send({
      name: 'Ferretería Andina',
      contactName: 'Luis Gómez',
      email: 'Ventas@Andina.co',
      phone: '+57 300 000 0000',
      leadTimeDays: 5,
      ...body,
    });
  const assign = (supplierId: string, productId: string, extra: object = {}) =>
    ctx.http().post(`/api/suppliers/${supplierId}/products`).set(bearer(compras)).send({ productId, ...extra });

  describe('HU-10 Proveedores', () => {
    it('CA1: se guarda con nombre, contacto y días de entrega, aparece en el listado y se asigna a productos', async () => {
      const { body } = await newSupplier().expect(201);
      expect(body).toMatchObject({ name: 'Ferretería Andina', email: 'ventas@andina.co', leadTimeDays: 5, isActive: true });
      const list = await ctx.http().get('/api/suppliers').set(bearer(compras)).expect(200);
      expect(list.body.items.map((s: { name: string }) => s.name)).toEqual(['Ferretería Andina']);

      const withProduct = await assign(body.id, p1, { supplierSku: 'AND-77', unitCost: 95 }).expect(201);
      expect(withProduct.body.products).toEqual([
        expect.objectContaining({ sku: 'TOR-1', isPrimary: true, supplierSku: 'AND-77', unitCost: 95 }),
      ]);
      const forProduct = await ctx.http().get(`/api/suppliers/by-product/${p1}`).set(bearer(compras)).expect(200);
      expect(forProduct.body[0]).toMatchObject({ name: 'Ferretería Andina', isPrimary: true });
    });

    it('CA2: con órdenes de compra no se elimina, solo se desactiva', async () => {
      const { body: s } = await newSupplier().expect(201);
      await assign(s.id, p1).expect(201);
      await ctx.http().post('/api/purchase-orders').set(bearer(compras)).send({ supplierId: s.id, lines: [{ productId: p1, quantity: 1 }] }).expect(201);
      const res = await ctx.http().delete(`/api/suppliers/${s.id}`).set(bearer(compras)).expect(409);
      expect(res.body.message).toMatch(/tiene 1 orden\(es\) de compra\. Desactívalo/);
      await ctx.http().patch(`/api/suppliers/${s.id}/active`).set(bearer(compras)).send({ active: false }).expect(200);

      const { body: other } = await newSupplier({ name: 'Sin órdenes' }).expect(201);
      await ctx.http().delete(`/api/suppliers/${other.id}`).set(bearer(compras)).expect(204);
    });

    it('CA3: busca por nombre o correo', async () => {
      await newSupplier().expect(201);
      await newSupplier({ name: 'Eléctricos del Valle', email: 'pedidos@valle.co' }).expect(201);
      const byName = await ctx.http().get('/api/suppliers?q=valle').set(bearer(compras)).expect(200);
      expect(byName.body.items.map((s: { name: string }) => s.name)).toEqual(['Eléctricos del Valle']);
      const byEmail = await ctx.http().get('/api/suppliers?q=andina.co').set(bearer(compras)).expect(200);
      expect(byEmail.body.items.map((s: { name: string }) => s.name)).toEqual(['Ferretería Andina']);
    });

    it('T-10.3: los cambios quedan en la auditoría y se validan los datos', async () => {
      const { body } = await newSupplier().expect(201);
      await ctx.http().patch(`/api/suppliers/${body.id}`).set(bearer(compras)).send({ leadTimeDays: 8 }).expect(200);
      const audit = await db.query(`SELECT action, changes FROM audit_logs WHERE entity_type = 'supplier' ORDER BY created_at`);
      expect(audit.map((a: { action: string }) => a.action)).toEqual(['supplier.created', 'supplier.updated']);
      expect(audit[1].changes).toEqual({ leadTimeDays: { from: 5, to: 8 } });
      const bad = await newSupplier({ name: 'Otro', email: 'no-es-correo', leadTimeDays: -1 }).expect(400);
      expect(bad.body.message.join()).toMatch(/correo válido|negativos/);
      const dup = await newSupplier({ name: 'ferretería andina' }).expect(409);
      expect(dup.body.message).toMatch(/Ya existe un proveedor/);
    });

    it('Bodega no gestiona proveedores', async () => {
      await ctx.http().get('/api/suppliers').set(bearer(bodega)).expect(403);
    });
  });

  describe('HU-11 Órdenes de compra y HU-12 recepción', () => {
    let supplier: string;
    beforeEach(async () => {
      supplier = (await newSupplier().expect(201)).body.id;
      await assign(supplier, p1, { unitCost: 90 }).expect(201);
      await assign(supplier, p2).expect(201);
      await assign(supplier, p3).expect(201);
    });

    const createOrder = (lines: object[]) =>
      ctx.http().post('/api/purchase-orders').set(bearer(compras)).send({ supplierId: supplier, lines });

    it('HU-11 CA1: una orden con 3 productos queda Enviada con el total calculado', async () => {
      const draft = await createOrder([
        { productId: p1, quantity: 10 },
        { productId: p2, quantity: 4 },
        { productId: p3, quantity: 2.5, unitCost: 7900 },
      ]).expect(201);
      expect(draft.body).toMatchObject({ code: 'OC-000001', status: 'DRAFT' });
      // 10×90 (costo pactado) + 4×250,5 (costo del producto) + 2,5×7.900 = 900 + 1.002 + 19.750
      expect(draft.body.total).toBe(21652);
      const sent = await ctx.http().post(`/api/purchase-orders/${draft.body.id}/send`).set(bearer(compras)).expect(200);
      expect(sent.body).toMatchObject({ status: 'SENT', total: 21652 });
      const [{ total }] = await db.query(`SELECT total::float FROM purchase_orders WHERE id = $1`, [draft.body.id]);
      expect(total).toBe(21652);
    });

    it('HU-11 CA2: un producto sin proveedor no se puede agregar y el mensaje dice cómo corregirlo', async () => {
      const res = await createOrder([{ productId: orphan, quantity: 1 }]).expect(400);
      expect(res.body.message).toBe(
        'El producto SIN-PROV (Producto sin proveedor) no tiene proveedor asignado. Asígnaselo en Proveedores › Ferretería Andina › Productos y vuelve a intentarlo.',
      );
    });

    it('HU-11 CA3: exporta la orden a PDF', async () => {
      const draft = await createOrder([{ productId: p1, quantity: 3 }]).expect(201);
      const res = await ctx.http().get(`/api/purchase-orders/${draft.body.id}/pdf`).set(bearer(compras)).buffer(true).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('OC-000001.pdf');
      expect(Buffer.from(res.body).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('HU-12 CA1: de 100 recibo 60, el stock sube 60 y la orden queda Recibida parcial con 40 pendientes', async () => {
      const order = await createOrder([{ productId: p1, quantity: 100 }]).expect(201);
      await ctx.http().post(`/api/purchase-orders/${order.body.id}/send`).set(bearer(compras)).expect(200);
      // Bodega ve la orden sin costos.
      const seen = await ctx.http().get(`/api/purchase-orders/${order.body.id}`).set(bearer(bodega)).expect(200);
      expect(seen.body.total).toBeUndefined();
      expect(seen.body.lines[0].unitCost).toBeUndefined();

      const lineId = seen.body.lines[0].id;
      const partial = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega)).send({ lines: [{ lineId, quantity: 60 }] }).expect(201);
      expect(partial.body.status).toBe('PARTIALLY_RECEIVED');
      expect(partial.body.lines[0]).toMatchObject({ receivedQty: 60, pendingQty: 40 });
      expect(await stockOf(db, p1, main)).toBe(60);

      const rest = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega)).send({ lines: [{ lineId, quantity: 40 }] }).expect(201);
      expect(rest.body.status).toBe('RECEIVED');
      expect(await stockOf(db, p1, main)).toBe(100);
    });

    it('HU-12 CA2: recibir de más pide confirmación y lo deja anotado', async () => {
      const order = await createOrder([{ productId: p1, quantity: 10 }]).expect(201);
      await ctx.http().post(`/api/purchase-orders/${order.body.id}/send`).set(bearer(compras)).expect(200);
      const lineId = order.body.lines[0].id;
      const ask = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega)).send({ lines: [{ lineId, quantity: 12 }] }).expect(409);
      expect(ask.body).toMatchObject({ code: 'OVER_RECEIPT', lines: [{ sku: 'TOR-1', pending: 10, receiving: 12, over: 2 }] });
      expect(await stockOf(db, p1, main)).toBe(0);

      const ok = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega))
        .send({ lines: [{ lineId, quantity: 12 }], confirmOverReceipt: true }).expect(201);
      expect(ok.body.status).toBe('RECEIVED');
      expect(ok.body.receipts[0]).toMatchObject({ overReceipt: true, notes: 'Sobrante aceptado: TOR-1 +2', lines: [{ sku: 'TOR-1', quantity: 12, overQuantity: 2 }] });
      expect(await stockOf(db, p1, main)).toBe(12);
    });

    it('HU-12 CA3: guarda la fecha real de llegada y calcula el tiempo de entrega real del proveedor', async () => {
      const order = await createOrder([{ productId: p1, quantity: 5 }]).expect(201);
      await ctx.http().post(`/api/purchase-orders/${order.body.id}/send`).set(bearer(compras)).expect(200);
      // Simula que la orden se envió hace 7 días.
      await db.query(`UPDATE purchase_orders SET sent_at = now() - interval '7 days' WHERE id = $1`, [order.body.id]);
      const res = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega))
        .send({ lines: [{ lineId: order.body.lines[0].id, quantity: 5 }] }).expect(201);
      expect(res.body.receipts[0].leadTimeDays).toBe(7);
      const s = await ctx.http().get(`/api/suppliers/${supplier}`).set(bearer(compras)).expect(200);
      expect(s.body).toMatchObject({ leadTimeDays: 5, actualLeadTimeDays: 7, receipts: 1 });

      const future = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega))
        .send({ receivedOn: '2999-01-01', lines: [{ lineId: order.body.lines[0].id, quantity: 1 }] }).expect(400);
      expect(future.body.message).toMatch(/futuro/);
    });

    it('un borrador no recibe mercancía y una orden enviada no se edita', async () => {
      const order = await createOrder([{ productId: p1, quantity: 5 }]).expect(201);
      const early = await ctx.http().post(`/api/purchase-orders/${order.body.id}/receipts`).set(bearer(bodega))
        .send({ lines: [{ lineId: order.body.lines[0].id, quantity: 1 }] }).expect(409);
      expect(early.body.message).toMatch(/Primero envíala/);
      await ctx.http().patch(`/api/purchase-orders/${order.body.id}`).set(bearer(compras)).send({ lines: [{ productId: p2, quantity: 2 }] }).expect(200);
      await ctx.http().post(`/api/purchase-orders/${order.body.id}/send`).set(bearer(compras)).expect(200);
      await ctx.http().patch(`/api/purchase-orders/${order.body.id}`).set(bearer(compras)).send({ notes: 'x' }).expect(409);
      const list = await ctx.http().get('/api/purchase-orders?status=open').set(bearer(bodega)).expect(200);
      expect(list.body.items[0]).toMatchObject({ code: 'OC-000001', status: 'SENT', lineCount: 1 });
      expect(list.body.items[0].total).toBeUndefined();
    });
  });
});
