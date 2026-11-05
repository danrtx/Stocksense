import bcrypt from 'bcryptjs';
import { AppDataSource } from '../data-source';

/**
 * Datos de demostración: bodegas, proveedores, stock, 18 meses de ventas, puntos de
 * reorden, alertas, órdenes de compra y una persona por rol para probar permisos.
 * Uso: npm run seed:demo   (después de npm run seed)
 * Solo para desarrollo: no lo corras en producción. Los datos se cargan una sola vez;
 * las cuentas de prueba se crean (o se les restablece la clave) cada vez que se corre.
 */

/** Cuentas de prueba, una por rol. Todas con la clave DEMO_PASSWORD. */
export const DEMO_PASSWORD = 'ClaveSegura2026';
export const DEMO_USERS = [
  { email: 'marta@demo.co', fullName: 'Marta Compras', role: 'COMPRAS' },
  { email: 'bruno@demo.co', fullName: 'Bruno Bodega', role: 'BODEGA' },
  { email: 'lina@demo.co', fullName: 'Lina Analista', role: 'ANALISTA' },
];

async function seedDemoUsers() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, Number(process.env.BCRYPT_COST ?? 12));
  for (const u of DEMO_USERS) {
    await AppDataSource.query(
      `INSERT INTO users (email, full_name, role, status, password_hash)
       VALUES ($1, $2, $3, 'ACTIVE', $4)
       ON CONFLICT (email) DO UPDATE SET status = 'ACTIVE', password_hash = EXCLUDED.password_hash,
         failed_login_attempts = 0, locked_until = NULL, invite_token_hash = NULL, updated_at = now()`,
      [u.email, u.fullName, u.role, hash],
    );
  }
  console.log(`Cuentas de prueba listas (clave ${DEMO_PASSWORD}): ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(', ')}.`);
}

// Generador pseudoaleatorio con semilla: los datos salen iguales en cada equipo.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261010);
const between = (min: number, max: number) => min + random() * (max - min);
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

const CATALOG: [string, string, string, string, number][] = [
  // sku, nombre, categoría, unidad, costo
  ['MAR-016', 'Martillo de uña 16 oz', 'Herramientas', 'UND', 25900],
  ['DES-PH2', 'Destornillador estrella PH2', 'Herramientas', 'UND', 8500],
  ['LLA-AJ10', 'Llave ajustable 10"', 'Herramientas', 'UND', 32000],
  ['ALI-8', 'Alicate universal 8"', 'Herramientas', 'UND', 21500],
  ['FLE-5M', 'Flexómetro 5 m', 'Herramientas', 'UND', 14900],
  ['TAL-13', 'Taladro percutor 1/2" 650 W', 'Herramientas', 'UND', 189000],
  ['TOR-DRY6', 'Tornillo drywall 6 x 1"', 'Ferretería', 'CAJA', 12800],
  ['CHA-3/8', 'Chazo plástico 3/8"', 'Ferretería', 'PAQ', 4200],
  ['PUN-2.5', 'Puntilla con cabeza 2 1/2"', 'Ferretería', 'KG', 9800],
  ['CAN-50', 'Candado de seguridad 50 mm', 'Ferretería', 'UND', 27500],
  ['BIS-3', 'Bisagra de cobre 3"', 'Ferretería', 'UND', 3900],
  ['CAB-12', 'Cable eléctrico calibre 12', 'Eléctricos', 'M', 1850],
  ['CAB-14', 'Cable eléctrico calibre 14', 'Eléctricos', 'M', 1320],
  ['TOM-DOB', 'Tomacorriente doble con polo a tierra', 'Eléctricos', 'UND', 7900],
  ['INT-SEN', 'Interruptor sencillo', 'Eléctricos', 'UND', 5600],
  ['BOM-LED9', 'Bombillo LED 9 W', 'Eléctricos', 'UND', 6200],
  ['CIN-AIS', 'Cinta aislante 18 m', 'Eléctricos', 'UND', 3100],
  ['TUB-PVC1/2', 'Tubo PVC presión 1/2" x 6 m', 'Plomería', 'UND', 13900],
  ['COD-PVC1/2', 'Codo PVC 1/2" x 90°', 'Plomería', 'UND', 900],
  ['LLA-PASO', 'Llave de paso 1/2"', 'Plomería', 'UND', 18500],
  ['SOL-PVC', 'Soldadura PVC 1/4 galón', 'Plomería', 'UND', 24900],
  ['GRI-LAV', 'Grifería lavamanos sencilla', 'Plomería', 'UND', 64900],
  ['PIN-BLA1', 'Pintura vinilo blanco 1 galón', 'Pinturas', 'UND', 48900],
  ['PIN-BLA5', 'Pintura vinilo blanco 5 galones', 'Pinturas', 'UND', 189000],
  ['BRO-2', 'Brocha de 2"', 'Pinturas', 'UND', 5400],
  ['ROD-9', 'Rodillo de felpa 9"', 'Pinturas', 'UND', 15900],
  ['THI-1G', 'Thinner 1 galón', 'Pinturas', 'L', 21000],
  ['CEM-50', 'Cemento gris 50 kg', 'Construcción', 'UND', 32500],
  ['ARE-BUL', 'Arena de pega por bulto', 'Construcción', 'UND', 9500],
  ['BLO-10', 'Bloque de arcilla #10', 'Construcción', 'UND', 1650],
  ['VAR-3/8', 'Varilla corrugada 3/8" x 6 m', 'Construcción', 'UND', 21900],
  ['MAN-JAR', 'Manguera de jardín 15 m', 'Jardinería', 'UND', 39900],
  ['TIJ-POD', 'Tijera de podar', 'Jardinería', 'UND', 28900],
  ['GUA-NIT', 'Guantes de nitrilo (par)', 'Seguridad industrial', 'PAQ', 7800],
  ['GAF-SEG', 'Gafas de seguridad claras', 'Seguridad industrial', 'UND', 6900],
  ['CAS-BLA', 'Casco de seguridad blanco', 'Seguridad industrial', 'UND', 22900],
];

const SUPPLIERS = [
  { name: 'Distribuidora Andina S.A.S.', taxId: '900123456-7', contact: 'Luis Gómez', email: 'pedidos@andina.example', phone: '+57 601 555 0101', lead: 5, categories: ['Herramientas', 'Ferretería'] },
  { name: 'Eléctricos del Valle', taxId: '901234567-1', contact: 'Paola Ríos', email: 'ventas@electricosvalle.example', phone: '+57 602 555 0202', lead: 3, categories: ['Eléctricos'] },
  { name: 'Hidráulicos y Pinturas Ltda.', taxId: '800987654-3', contact: 'Jorge Martínez', email: 'comercial@hypinturas.example', phone: '+57 604 555 0303', lead: 7, categories: ['Plomería', 'Pinturas'] },
  { name: 'Materiales La Roca', taxId: '890456789-2', contact: 'Ana Restrepo', email: 'despachos@laroca.example', phone: '+57 605 555 0404', lead: 10, categories: ['Construcción', 'Jardinería', 'Seguridad industrial'] },
];

async function seedDemo() {
  if (process.env.NODE_ENV === 'production') throw new Error('No se permite en producción.');
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  const db = AppDataSource;
  await seedDemoUsers();

  const [{ n: already }] = await db.query(`SELECT count(*)::int AS n FROM suppliers WHERE email LIKE '%.example'`);
  if (already > 0) {
    const added = await refreshDemoSales();
    const planted = await plantDemoAnomalies();
    console.log(
      added
        ? `Los datos de demostración ya estaban cargados. Se agregaron ${added} días de venta hasta ayer.`
        : 'Los datos de demostración ya están cargados y al día.',
    );
    if (planted) console.log(planted);
    if (added || planted) console.log('Reentrena el modelo (Pronóstico › Modelos) para que el pronóstico use las ventas nuevas.');
    await db.destroy();
    return;
  }
  const [admin] = await db.query(`SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`);
  const adminId: string | null = admin?.id ?? null;

  await db.transaction(async (m) => {
    // Bodegas
    await m.query(`INSERT INTO warehouses (code, name, address) VALUES
      ('NORTE', 'Bodega Norte', 'Calle 80 # 45-12'), ('SUR', 'Tienda Sur', 'Carrera 50 # 10-30')
      ON CONFLICT (code) DO NOTHING`);
    const warehouses: { id: string; code: string }[] = await m.query(`SELECT id, code FROM warehouses WHERE is_active`);
    const main = warehouses.find((w) => w.code === 'PRINCIPAL') ?? warehouses[0];
    const north = warehouses.find((w) => w.code === 'NORTE')!;
    const south = warehouses.find((w) => w.code === 'SUR')!;

    // Catálogo
    for (const [sku, name, category, unit, cost] of CATALOG) {
      await m.query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [category]);
      await m.query(
        `INSERT INTO products (sku, name, category_id, unit, cost, created_at)
         SELECT $1, $2, c.id, $4, $5, now() - interval '20 months' FROM categories c WHERE c.name = $3
         ON CONFLICT (sku) DO NOTHING`,
        [sku, name, category, unit, cost],
      );
    }
    const products: { id: string; sku: string; unit: string; category: string }[] = await m.query(
      `SELECT p.id, p.sku, p.unit, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.sku = ANY($1)`,
      [CATALOG.map((c) => c[0])],
    );

    // Proveedores y asignación
    const supplierIds: Record<string, { id: string; lead: number }> = {};
    for (const s of SUPPLIERS) {
      const [row] = await m.query(
        `INSERT INTO suppliers (name, tax_id, contact_name, email, phone, lead_time_days)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [s.name, s.taxId, s.contact, s.email, s.phone, s.lead],
      );
      for (const c of s.categories) supplierIds[c] = { id: row.id, lead: s.lead };
    }
    for (const p of products) {
      const s = supplierIds[p.category] ?? Object.values(supplierIds)[0];
      await m.query(
        `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, supplier_sku) VALUES ($1, $2, true, $3)
         ON CONFLICT DO NOTHING`,
        [p.id, s.id, `PRV-${p.sku}`],
      );
    }

    // Historial de ventas: 18 meses con estacionalidad semanal y anual
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const days = 548;
    const daily: Record<string, number> = {};
    const salesRows: { product: string; warehouse: string; day: string; qty: number }[] = [];
    products.forEach((p, i) => {
      const base = p.unit === 'M' ? between(20, 60) : p.unit === 'KG' ? between(2, 8) : between(0.6, 6);
      // Algunos productos son nuevos (poca historia) para ver "datos insuficientes".
      const startDay = i % 9 === 0 ? 50 : days;
      let total = 0;
      for (let d = startDay; d >= 1; d--) {
        const date = new Date(today.getTime() - d * 86_400_000);
        const dow = date.getUTCDay();
        if (dow === 0 && random() < 0.7) continue; // domingos casi sin ventas
        const yearly = 1 + 0.25 * Math.sin(((date.getUTCMonth() + 1) / 12) * 2 * Math.PI);
        const weekly = dow === 6 ? 1.5 : 1;
        const trend = 1 + (days - d) / days / 3;
        const mean = base * yearly * weekly * trend;
        let qty = mean * between(0.4, 1.6);
        qty = ['UND', 'CAJA', 'PAQ'].includes(p.unit) ? Math.round(qty) : Math.round(qty * 10) / 10;
        if (qty <= 0) continue;
        const warehouse = random() < 0.6 ? main.id : random() < 0.5 ? north.id : south.id;
        salesRows.push({ product: p.id, warehouse, day: date.toISOString().slice(0, 10), qty });
        if (d <= 90) total += qty;
      }
      daily[p.id] = total / 90;
    });
    const [imp] = await m.query(
      `INSERT INTO sales_imports (file_name, rows_total, rows_imported, rows_failed, quality, duration_ms, created_by)
       VALUES ('demo-historial-ventas.csv', $1, $1, 0, '{}'::jsonb, 0, $2) RETURNING id`,
      [salesRows.length, adminId],
    );
    for (let i = 0; i < salesRows.length; i += 5000) {
      const chunk = salesRows.slice(i, i + 5000);
      await m.query(
        `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source, import_id)
         SELECT p, w, d, q, 'IMPORT', $5 FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::numeric[]) AS t(p, w, d, q)
         ON CONFLICT (product_id, warehouse_id, sold_on) WHERE source = 'IMPORT'
         DO UPDATE SET quantity = sales.quantity + EXCLUDED.quantity`,
        [chunk.map((r) => r.product), chunk.map((r) => r.warehouse), chunk.map((r) => r.day), chunk.map((r) => r.qty), imp.id],
      );
    }

    // Stock, puntos de reorden y movimientos
    const round = (unit: string, v: number) => (['UND', 'CAJA', 'PAQ'].includes(unit) ? Math.max(0, Math.round(v)) : Math.max(0, Math.round(v * 10) / 10));
    for (const [i, p] of products.entries()) {
      const avg = Math.max(daily[p.id], 0.2);
      const lead = (supplierIds[p.category] ?? Object.values(supplierIds)[0]).lead;
      const safety = round(p.unit, Math.ceil(avg * 3));
      const reorder = round(p.unit, Math.ceil(avg * lead + safety));
      // Uno de cada cuatro queda bajo su punto de reorden; algunos sin definir.
      const low = i % 4 === 1;
      const target = low ? reorder * between(0.2, 0.9) : reorder * between(1.5, 4);
      const inMain = round(p.unit, target * 0.65);
      const inNorth = round(p.unit, target * 0.35);
      const idle = i % 11 === 5; // stock quieto hace más de 90 días
      if (i % 13 !== 7) {
        await m.query(`UPDATE products SET reorder_point = $2, safety_stock = $3 WHERE id = $1`, [p.id, reorder, Math.min(safety, reorder)]);
      }
      for (const [warehouse, qty] of [[main.id, inMain], [north.id, inNorth]] as [string, number][]) {
        if (qty <= 0) continue;
        const initial = round(p.unit, qty * (idle ? 1 : 1.4));
        await m.query(`INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES ($1, $2, $3)`, [p.id, warehouse, initial]);
        await m.query(
          `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, user_id, created_at)
           VALUES ($1, $2, 'IN', $3, $3, 'Inventario inicial', $4, now() - interval '150 days')`,
          [p.id, warehouse, initial, adminId],
        );
        if (!idle && initial - qty > 0) {
          const out = round(p.unit, initial - qty);
          if (out > 0) {
            await m.query(`UPDATE stock_levels SET quantity = $3 WHERE product_id = $1 AND warehouse_id = $2`, [p.id, warehouse, qty]);
            await m.query(
              `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, user_id, created_at)
               VALUES ($1, $2, 'OUT', $3, $4, $5, $6, now() - make_interval(days => $7))`,
              [p.id, warehouse, -out, qty, pick(['Venta de mostrador', 'Consumo interno', 'Despacho a obra']), adminId, Math.floor(between(1, 25))],
            );
          }
        }
      }
    }

    // Alertas para lo que quedó bajo su punto de reorden
    await m.query(`
      INSERT INTO stock_alerts (product_id, stock_at_open, current_stock, reorder_point, last_notified_at, opened_at)
      SELECT p.id, s.total, s.total, p.reorder_point, now() - interval '3 hours', now() - interval '3 hours'
        FROM products p
        JOIN (SELECT product_id, sum(quantity) AS total FROM stock_levels GROUP BY product_id) s ON s.product_id = p.id
       WHERE p.is_active AND p.reorder_point > 0 AND s.total <= p.reorder_point
      ON CONFLICT DO NOTHING`);

    // Órdenes de compra: una enviada, una recibida parcial y un borrador
    const andina = supplierIds['Herramientas'].id;
    const valle = supplierIds['Eléctricos'].id;
    const bySku = (sku: string) => products.find((p) => p.sku === sku)!;
    const order = async (supplier: string, status: string, lines: [string, number, number][], sentDaysAgo: number | null) => {
      const [po] = await m.query(
        `INSERT INTO purchase_orders (supplier_id, warehouse_id, status, expected_at, created_by, sent_by, sent_at, total, created_at)
         VALUES ($1, $2, $3, CURRENT_DATE + 3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE $4::uuid END,
                 CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(days => $5::int) END, $6,
                 now() - make_interval(days => COALESCE($5::int, 0) + 1))
         RETURNING id`,
        [supplier, main.id, status, adminId, sentDaysAgo, lines.reduce((s, l) => s + l[1] * l[2], 0)],
      );
      const ids: string[] = [];
      for (const [sku, qty, cost] of lines) {
        const [line] = await m.query(
          `INSERT INTO purchase_order_lines (order_id, product_id, quantity, unit_cost) VALUES ($1, $2, $3, $4) RETURNING id`,
          [po.id, bySku(sku).id, qty, cost],
        );
        ids.push(line.id);
      }
      return { id: po.id as string, lines: ids };
    };
    await order(andina, 'SENT', [['MAR-016', 24, 24500], ['FLE-5M', 30, 13800], ['TOR-DRY6', 40, 11900]], 2);
    const partial = await order(valle, 'PARTIALLY_RECEIVED', [['CAB-12', 500, 1750], ['BOM-LED9', 120, 5800]], 6);
    const [receipt] = await m.query(
      `INSERT INTO purchase_receipts (order_id, received_on, lead_time_days, notes, created_by)
       VALUES ($1, CURRENT_DATE - 2, 4, 'Llegó solo el cable; los bombillos llegan la otra semana', $2) RETURNING id`,
      [partial.id, adminId],
    );
    await m.query(`UPDATE purchase_order_lines SET received_qty = 500 WHERE id = $1`, [partial.lines[0]]);
    await m.query(
      `INSERT INTO purchase_receipt_lines (receipt_id, order_line_id, product_id, quantity) VALUES ($1, $2, $3, 500)`,
      [receipt.id, partial.lines[0], bySku('CAB-12').id],
    );
    const cable = bySku('CAB-12');
    const [lvl] = await m.query(
      `UPDATE stock_levels SET quantity = quantity + 500 WHERE product_id = $1 AND warehouse_id = $2 RETURNING quantity`,
      [cable.id, main.id],
    ).then((r: unknown[]) => r[0] as { quantity: string }[]);
    await m.query(
      `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, reference_type, reference_id, user_id, created_at)
       VALUES ($1, $2, 'PURCHASE_RECEIPT', 500, $3, 'Recepción de OC-000002', 'purchase_order', $4, $5, now() - interval '2 days')`,
      [cable.id, main.id, lvl?.quantity ?? 500, partial.id, adminId],
    );
    await order(supplierIds['Plomería'].id, 'DRAFT', [['TUB-PVC1/2', 60, 13200], ['SOL-PVC', 12, 23500]], null);

    await m.query(`
      INSERT INTO audit_logs (actor_id, action, entity_type, changes)
      VALUES ($1, 'demo.seeded', 'system', jsonb_build_object('products', $2::int, 'sales', $3::int))`,
      [adminId, products.length, salesRows.length]);
    console.log(`Demo lista: ${products.length} productos, ${SUPPLIERS.length} proveedores, ${salesRows.length} días de venta, 3 órdenes.`);
  });

  const planted = await plantDemoAnomalies();
  if (planted) console.log(planted);
  console.log('Abre StockSense › Pronóstico › Modelos y pulsa "Reentrenar ahora" para calcular el pronóstico.');
  await db.destroy();
}

const DEMO_IMPORT = 'demo-historial-ventas.csv';
const ANOMALY_IMPORT = 'demo-casos-anomalos.csv';
const WHOLE = ['UND', 'CAJA', 'PAQ'];

/** Fecha AAAA-MM-DD en Bogotá, `offset` días desde hoy. */
function bogotaDay(offset = 0): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date(Date.now() + offset * 86_400_000));
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Lunes de la semana de `day`. */
const monday = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * La demo se carga una vez, pero el tiempo pasa: si se cargó hace semanas, al pronóstico le
 * faltarían las ventas recientes. Esto completa las ventas de cada producto hasta ayer, con el
 * mismo ritmo que tenía en sus últimas 8 semanas.
 */
async function refreshDemoSales(): Promise<number> {
  const db = AppDataSource;
  const [imp] = await db.query(`SELECT id FROM sales_imports WHERE file_name = $1 ORDER BY created_at LIMIT 1`, [DEMO_IMPORT]);
  if (!imp) return 0;
  const yesterday = bogotaDay(-1);
  const products: { id: string; unit: string; last: string; avg: number }[] = await db.query(
    `WITH last AS (SELECT product_id, max(sold_on) AS last FROM sales WHERE import_id = $1 GROUP BY product_id)
     SELECT l.product_id AS id, p.unit, l.last::text AS last,
            (SELECT COALESCE(sum(s.quantity), 0) / 56.0 FROM sales s
              WHERE s.product_id = l.product_id AND s.import_id = $1 AND s.sold_on > l.last - 56)::float AS avg
       FROM last l JOIN products p ON p.id = l.product_id
      WHERE p.is_active AND l.last < $2::date`,
    [imp.id, yesterday],
  );
  if (!products.length) return 0;
  const warehouses: { id: string; code: string }[] = await db.query(`SELECT id, code FROM warehouses WHERE is_active`);
  const main = warehouses.find((w) => w.code === 'PRINCIPAL') ?? warehouses[0];
  const north = warehouses.find((w) => w.code === 'NORTE') ?? main;
  const south = warehouses.find((w) => w.code === 'SUR') ?? main;
  const rows: { product: string; warehouse: string; day: string; qty: number }[] = [];
  const days = new Set<string>();
  for (const p of products) {
    for (let day = addDays(p.last, 1); day <= yesterday; day = addDays(day, 1)) {
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (dow === 0 && random() < 0.7) continue;
      let qty = p.avg * (dow === 6 ? 1.35 : 0.95) * between(0.4, 1.6);
      qty = WHOLE.includes(p.unit) ? Math.round(qty) : Math.round(qty * 10) / 10;
      if (qty <= 0) continue;
      const warehouse = random() < 0.6 ? main.id : random() < 0.5 ? north.id : south.id;
      rows.push({ product: p.id, warehouse, day, qty });
      days.add(day);
    }
  }
  await insertSales(imp.id, rows);
  await db.query(`UPDATE sales_imports SET rows_total = rows_total + $2, rows_imported = rows_imported + $2 WHERE id = $1`, [imp.id, rows.length]);
  return days.size;
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function insertSales(
  importId: string,
  rows: { product: string; warehouse: string; day: string; qty: number }[],
  runner: Runner = AppDataSource,
) {
  for (let i = 0; i < rows.length; i += 5000) {
    const chunk = rows.slice(i, i + 5000);
    await runner.query(
      `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, source, import_id)
       SELECT p, w, d, q, 'IMPORT', $5 FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::numeric[]) AS t(p, w, d, q)
       ON CONFLICT (product_id, warehouse_id, sold_on) WHERE source = 'IMPORT'
       DO UPDATE SET quantity = sales.quantity + EXCLUDED.quantity`,
      [chunk.map((r) => r.product), chunk.map((r) => r.warehouse), chunk.map((r) => r.day), chunk.map((r) => r.qty), importId],
    );
  }
}

/**
 * HU-26: tres casos fuera de lo normal en la última semana completa, para que la bandeja de
 * anomalías tenga algo que mostrar en la demo. Se siembran una sola vez.
 *  1. Pintura vinilo 1 galón: ventas 4 veces lo normal (parece una promoción).
 *  2. Chazo plástico 3/8": un día con 30 veces lo normal (parece un error de digitación).
 *  3. Cemento gris 50 kg: una merma grande por producto dañado.
 */
async function plantDemoAnomalies(): Promise<string | null> {
  const db = AppDataSource;
  const [done] = await db.query(`SELECT 1 FROM sales_imports WHERE file_name = $1`, [ANOMALY_IMPORT]);
  if (done) return null;
  const week = addDays(monday(bogotaDay()), -7);
  const products: { id: string; sku: string; unit: string; avg: number }[] = await db.query(
    `SELECT p.id, p.sku, p.unit,
            (SELECT COALESCE(sum(s.quantity), 0) / 8.0 FROM sales s
              WHERE s.product_id = p.id AND s.sold_on >= $2::date - 56 AND s.sold_on < $2::date)::float AS avg
       FROM products p WHERE p.sku = ANY($1) AND p.is_active`,
    [['PIN-BLA1', 'CHA-3/8', 'CEM-50'], week],
  );
  const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));
  const [main] = await db.query(`SELECT id FROM warehouses WHERE is_active ORDER BY is_default DESC, code LIMIT 1`);
  const [admin] = await db.query(`SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`);
  if (!main || !bySku['PIN-BLA1'] || !bySku['CHA-3/8'] || !bySku['CEM-50']) return null;

  await db.transaction(async (m) => {
    const [imp] = await m.query(
      `INSERT INTO sales_imports (file_name, rows_total, rows_imported, rows_failed, quality, duration_ms, created_by)
       VALUES ($1, 3, 3, 0, '{}'::jsonb, 0, $2) RETURNING id`,
      [ANOMALY_IMPORT, admin?.id ?? null],
    );
    const paint = bySku['PIN-BLA1'];
    const anchor = bySku['CHA-3/8'];
    const roundQ = (unit: string, v: number) => (WHOLE.includes(unit) ? Math.max(1, Math.round(v)) : Math.round(v * 10) / 10);
    await insertSales(imp.id, [
      { product: paint.id, warehouse: main.id, day: addDays(week, 4), qty: roundQ(paint.unit, Math.max(8, paint.avg * 1.5)) },
      { product: paint.id, warehouse: main.id, day: addDays(week, 5), qty: roundQ(paint.unit, Math.max(8, paint.avg * 1.5)) },
      { product: anchor.id, warehouse: main.id, day: addDays(week, 2), qty: roundQ(anchor.unit, Math.max(40, (anchor.avg / 6) * 30)) },
    ], m);

    // Merma: salida por producto dañado, con su movimiento y el stock actualizado.
    const cement = bySku['CEM-50'];
    const [level] = await m.query(`SELECT quantity::float AS q FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2`, [cement.id, main.id]);
    const shrink = Math.min(Math.max(1, Math.round(level?.q ?? 0) - 1), Math.max(12, Math.round(cement.avg)));
    if (level && shrink > 0) {
      // UPDATE … RETURNING en TypeORM devuelve [filas, cantidad].
      const [[row]] = await m.query(
        `UPDATE stock_levels SET quantity = quantity - $3 WHERE product_id = $1 AND warehouse_id = $2 RETURNING quantity::float AS q`,
        [cement.id, main.id, shrink],
      );
      await m.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, user_id, created_at)
         VALUES ($1, $2, 'OUT', $3, $4, 'Producto dañado: bultos mojados por una gotera', $5, ($6::date + 3 + time '15:20') AT TIME ZONE 'America/Bogota')`,
        [cement.id, main.id, -shrink, row.q, admin?.id ?? null, week],
      );
    }
  });
  return `Se sembraron 3 casos raros en la semana del ${week} para la bandeja de anomalías.`;
}

seedDemo().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
