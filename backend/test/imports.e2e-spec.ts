import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import {
  bearer,
  createCategory,
  createProduct,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  TestContext,
} from './helpers';

describe('Importaciones · HU-05 catálogo y HU-13 historial de ventas', () => {
  let ctx: TestContext;
  let db: DataSource;
  let compras: string;
  let analista: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    await createUser(db, { email: 'lina@x.co', role: Role.Analista });
    compras = await login(ctx, 'marta@x.co');
    analista = await login(ctx, 'lina@x.co');
    await createCategory(db, 'Herramientas');
  });

  const uploadProducts = (csv: string, query = '') =>
    ctx.http().post(`/api/products/import${query}`).set(bearer(compras)).attach('file', Buffer.from(csv, 'utf8'), 'productos.csv');
  const uploadSales = (csv: string, token = analista) =>
    ctx.http().post('/api/sales/import').set(bearer(token)).attach('file', Buffer.from(csv, 'utf8'), 'ventas.csv');

  describe('HU-05 Catálogo desde CSV', () => {
    it('CA1: crea los válidos, actualiza los existentes y muestra el resumen', async () => {
      const cat = (await db.query(`SELECT id FROM categories`))[0].id;
      await createProduct(db, { sku: 'MAR-001', name: 'Martillo viejo', categoryId: cat, cost: 1 });
      const csv = [
        '﻿sku;nombre;categoria;unidad;costo;descripcion;punto_reorden;stock_seguridad',
        'mar-001;Martillo de uña 16 oz;Herramientas;UND;25900;Cabeza forjada;10;4',
        'DES-002;Destornillador estrella;herramientas;Unidad;8.500,50;;;',
        'CAB-12;Cable 12 AWG;Eléctricos;M;1800;;;',
      ].join('\r\n');
      const res = await uploadProducts(csv).expect(201);
      expect(res.body).toMatchObject({ rowsTotal: 3, created: 1, updated: 1, failed: 1 });
      expect(res.body.errors).toEqual([
        { line: 4, sku: 'CAB-12', message: expect.stringContaining('La categoría "Eléctricos" no existe') },
      ]);
      const [hammer] = await db.query(`SELECT name, cost::float, reorder_point::float AS rp, safety_stock::float AS ss FROM products WHERE sku = 'MAR-001'`);
      expect(hammer).toEqual({ name: 'Martillo de uña 16 oz', cost: 25900, rp: 10, ss: 4 });
      const [screw] = await db.query(`SELECT cost::float, unit FROM products WHERE sku = 'DES-002'`);
      expect(screw).toEqual({ cost: 8500.5, unit: 'UND' });
    });

    it('CA2: reporta fila y motivo de cada error sin perder las filas válidas', async () => {
      const csv = [
        'sku,nombre,categoria,unidad,costo',
        'OK-1,Producto bueno,Herramientas,UND,100',
        'con espacio,Malo,Herramientas,UND,100',
        'OK-2,X,Herramientas,UND,100',
        'OK-3,Costo negativo,Herramientas,UND,-5',
        'OK-4,Unidad rara,Herramientas,GALON,5',
        'OK-1,Repetido,Herramientas,UND,100',
      ].join('\n');
      const res = await uploadProducts(csv).expect(201);
      expect(res.body.created).toBe(1);
      expect(res.body.errors.map((e: { line: number }) => e.line)).toEqual([3, 4, 5, 6, 7]);
      expect(res.body.errors[0].message).toMatch(/sin espacios/);
      expect(res.body.errors[4].message).toMatch(/repetido en el archivo \(ya aparece en la fila 2\)/);
    });

    it('crea las categorías que falten solo si se pide', async () => {
      const csv = 'sku,nombre,categoria,unidad,costo\nCAB-12,Cable 12 AWG,Eléctricos,M,1800';
      const res = await uploadProducts(csv, '?createCategories=true').expect(201);
      expect(res.body).toMatchObject({ created: 1, newCategories: ['Eléctricos'] });
    });

    it('explica cuando faltan columnas o el archivo está vacío', async () => {
      const res = await uploadProducts('sku,nombre\nA,B').expect(400);
      expect(res.body.message).toBe('Faltan columnas obligatorias: categoria, unidad, costo. Descarga la plantilla para ver el formato.');
      await ctx.http().post('/api/products/import').set(bearer(compras)).expect(400);
    });

    it('CA3: 5.000 filas terminan en menos de 60 segundos', async () => {
      const rows = ['sku,nombre,categoria,unidad,costo'];
      for (let i = 0; i < 5000; i++) rows.push(`P-${i},Producto ${i},Herramientas,UND,${1000 + i}`);
      const started = Date.now();
      const res = await uploadProducts(rows.join('\n')).expect(201);
      expect(res.body).toMatchObject({ created: 5000, failed: 0 });
      expect(Date.now() - started).toBeLessThan(60_000);
      // Repetir el archivo actualiza; no duplica.
      const again = await uploadProducts(rows.join('\n')).expect(201);
      expect(again.body).toMatchObject({ created: 0, updated: 5000 });
    });
  });

  describe('HU-13 Historial de ventas', () => {
    let cat: string;
    beforeEach(async () => {
      cat = (await db.query(`SELECT id FROM categories`))[0].id;
      await createProduct(db, { sku: 'MAR-001', categoryId: cat });
      await createProduct(db, { sku: 'CAB-12', categoryId: cat, unit: 'M' });
    });

    it('CA1 y CA2: asocia las ventas a sus productos y reporta SKU inexistentes sin detener la carga', async () => {
      const csv = [
        'fecha,sku,cantidad',
        '2026-01-05,MAR-001,3',
        '05/01/2026,mar-001,2',
        '2026-01-06,CAB-12,12.5',
        '2026-01-06,NO-EXISTE,4',
        '2026-01-07,MAR-001,-1',
        '2999-01-01,MAR-001,1',
      ].join('\n');
      const res = await uploadSales(csv).expect(201);
      expect(res.body).toMatchObject({ rowsTotal: 6, salesDays: 2, created: 2, failed: 3 });
      expect(res.body.quality).toMatchObject({
        negativeQuantities: 1,
        futureDates: 1,
        mergedRows: 1,
        unknownSkus: { count: 1, rows: 1, sample: ['NO-EXISTE'] },
        dateFrom: '2026-01-05',
        dateTo: '2026-01-06',
      });
      const rows = await db.query(`SELECT p.sku, s.sold_on::text AS d, s.quantity::float AS q FROM sales s JOIN products p ON p.id = s.product_id ORDER BY d, sku`);
      expect(rows).toEqual([
        { sku: 'MAR-001', d: '2026-01-05', q: 5 },
        { sku: 'CAB-12', d: '2026-01-06', q: 12.5 },
      ]);
      // Las ventas históricas no mueven el stock actual.
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM stock_movements`);
      expect(n).toBe(0);
    });

    it('T-13.3: el informe de calidad señala huecos de 7 días o más', async () => {
      const csv = ['fecha;sku;cantidad', '2026-02-01;MAR-001;1', '2026-02-02;MAR-001;1', '2026-02-20;MAR-001;1'].join('\n');
      const res = await uploadSales(csv).expect(201);
      expect(res.body.quality).toMatchObject({
        daysCovered: 3,
        daysWithoutSales: 17,
        gaps: [{ from: '2026-02-03', to: '2026-02-19', days: 17 }],
        productsWithShortHistory: 1,
      });
    });

    it('solo Analista o Administrador cargan ventas', async () => {
      await uploadSales('fecha,sku,cantidad\n2026-01-01,MAR-001,1', compras).expect(403);
    });

    it('CA3: 24 meses de 1.000 productos cargan en menos de 3 minutos y repetir no duplica', async () => {
      const skus = Array.from({ length: 1000 }, (_, i) => `V-${i}`);
      await db.query(
        `INSERT INTO products (sku, name, category_id, unit, cost)
         SELECT s, 'Venta ' || s, $2, 'UND', 1000 FROM unnest($1::text[]) AS s`,
        [skus, cat],
      );
      // Una fila por producto y día de venta; cada producto vende en 1 de cada 3 días (≈ 243.000 filas).
      const lines = ['fecha,sku,cantidad'];
      const start = Date.UTC(2024, 9, 1);
      for (let d = 0; d < 730; d++) {
        const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
        for (let p = d % 3; p < 1000; p += 3) lines.push(`${date},V-${p},${(p % 7) + 1}`);
      }
      const csv = lines.join('\n');
      const started = Date.now();
      const first = await uploadSales(csv).expect(201);
      const elapsed = Date.now() - started;
      expect(first.body.failed).toBe(0);
      expect(first.body.created).toBe(lines.length - 1);
      expect(elapsed).toBeLessThan(180_000);

      const second = await uploadSales(csv).expect(201);
      expect(second.body).toMatchObject({ created: 0, updated: 0, unchanged: lines.length - 1 });
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM sales`);
      expect(n).toBe(lines.length - 1);
    }, 400_000);
  });
});
