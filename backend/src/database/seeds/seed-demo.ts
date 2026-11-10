import bcrypt from 'bcryptjs';
import { AppDataSource } from '../data-source';
import { DemoData, DemoUser, SUPPLIERS, WAREHOUSES, WarehouseCode, generateDemo, rng } from './demo-data';

/**
 * Datos de demostración de una ferretería de Pasto: 3 bodegas, 6 proveedores, 68 productos,
 * 18 meses de ventas, kardex de 5 meses con compras, transferencias y conteos, alertas y
 * una persona por rol para probar permisos. Los datos se calculan en demo-data.ts.
 *
 *   npm run seed:demo    carga la demo si no está; si ya está, completa las ventas hasta ayer
 *   npm run seed:reset   borra todos los datos del inventario y carga la demo de nuevo
 *
 * Solo para desarrollo: no lo corras en producción. Las cuentas de usuario se conservan y
 * las de prueba se crean (o se les restablece la clave) cada vez que se corre.
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

const random = rng(20261010);
const between = (min: number, max: number) => min + random() * (max - min);

const RESET = process.argv.includes('--reset');

/**
 * Borra todos los datos del negocio: productos, ventas, stock, movimientos, compras,
 * transferencias, conteos, alertas, pronósticos, anomalías, consumo de IA y auditoría.
 * Conserva las cuentas de usuario, los ajustes, las claves de API y el modelo del asistente.
 */
async function resetBusinessData() {
  await AppDataSource.query(
    `TRUNCATE products, categories, suppliers, sales_imports, purchase_orders, purchase_receipts,
              transfers, stock_counts, stock_alerts, forecast_runs, pipeline_runs, ml_jobs,
              ai_usage, ai_feedback, audit_logs, assistant_conversations
     RESTART IDENTITY CASCADE`,
  );
  await AppDataSource.query(`DELETE FROM warehouses WHERE NOT is_default`);
}

async function seedDemo() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('No se permite en producción. En un servidor de demostración, pon ALLOW_DEMO_SEED=true en el .env.');
  }
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  const db = AppDataSource;
  await seedDemoUsers();

  if (RESET) {
    await resetBusinessData();
    console.log('Se borraron los datos del inventario (las cuentas de usuario se conservan).');
  } else {
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
      console.log('Para empezar de cero con datos nuevos: npm run seed:reset');
      await db.destroy();
      return;
    }
  }

  const summary = await loadDemo(generateDemo(bogotaDay()));
  // El servicio de pronóstico toma este trabajo solo: calcula series, modelos y anomalías.
  await db.query(
    `INSERT INTO ml_jobs (kind, trigger, requested_by) VALUES ('FORECAST_RETRAIN', 'MANUAL', 'seed:demo')`,
  );
  console.log(summary);
  console.log('Se pidió un reentrenamiento: en uno o dos minutos el servicio de pronóstico calcula el pronóstico y las anomalías.');
  await db.destroy();
}

/** Escribe en la base lo que calculó `generateDemo`, en una sola transacción. */
async function loadDemo(data: DemoData): Promise<string> {
  return AppDataSource.transaction(async (m) => {
    const users: Record<DemoUser, string | null> = { admin: null, marta: null, bruno: null, lina: null };
    for (const row of await m.query(`SELECT id, email, role FROM users`)) {
      if (row.email === 'marta@demo.co') users.marta = row.id;
      else if (row.email === 'bruno@demo.co') users.bruno = row.id;
      else if (row.email === 'lina@demo.co') users.lina = row.id;
      else if (row.role === 'ADMIN' && !users.admin) users.admin = row.id;
    }
    const emails: Record<DemoUser, string | null> = { admin: null, marta: 'marta@demo.co', bruno: 'bruno@demo.co', lina: 'lina@demo.co' };
    const [adminRow] = await m.query(`SELECT email FROM users WHERE id = $1`, [users.admin]);
    emails.admin = adminRow?.email ?? null;

    // Bodegas: la principal ya existe (la crea la migración); se le pone la dirección.
    const wh: Record<WarehouseCode, string> = { PRINCIPAL: '', NORTE: '', SUR: '' };
    for (const w of WAREHOUSES) {
      if (w.code === 'PRINCIPAL') {
        const [[row]] = await m.query(
          `UPDATE warehouses SET name = $1, address = $2, is_active = true WHERE is_default RETURNING id`,
          [w.name, w.address],
        );
        wh.PRINCIPAL = row.id;
      } else {
        const [row] = await m.query(
          `INSERT INTO warehouses (code, name, address) VALUES ($1, $2, $3)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, is_active = true
           RETURNING id`,
          [w.code, w.name, w.address],
        );
        wh[w.code] = row.id;
      }
    }

    // Proveedores
    const sup: Record<string, string> = {};
    for (const s of SUPPLIERS) {
      const [row] = await m.query(
        `INSERT INTO suppliers (name, tax_id, contact_name, email, phone, lead_time_days, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() - interval '20 months') RETURNING id`,
        [s.name, s.taxId, s.contact, s.email, s.phone, s.lead],
      );
      sup[s.key] = row.id;
    }

    // Catálogo
    const prod: Record<string, string> = {};
    for (const p of data.products) {
      await m.query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [p.category]);
      const [row] = await m.query(
        `INSERT INTO products (sku, name, description, category_id, unit, cost, is_active, reorder_point, safety_stock, created_at)
         SELECT $1, $2, $3, c.id, $5, $6, $7, $8, $9, now() - make_interval(days => $10) FROM categories c WHERE c.name = $4
         RETURNING id`,
        [p.sku, p.name, p.description, p.category, p.unit, p.cost, p.isActive, p.reorderPoint, p.safetyStock, p.createdDaysAgo],
      );
      prod[p.sku] = row.id;
      await m.query(
        `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, supplier_sku, unit_cost) VALUES ($1, $2, true, $3, $4)`,
        [row.id, sup[p.supplier], `PRV-${p.sku}`, p.cost],
      );
    }

    // Historial de ventas (y la importación de los casos raros, para no sembrarlos de nuevo).
    const [imp] = await m.query(
      `INSERT INTO sales_imports (file_name, rows_total, rows_imported, rows_failed, quality, duration_ms, created_by, created_at)
       VALUES ($1, $2, $2, 0, '{}'::jsonb, 0, $3, now() - interval '18 months') RETURNING id`,
      [DEMO_IMPORT, data.sales.length, users.admin],
    );
    await m.query(
      `INSERT INTO sales_imports (file_name, rows_total, rows_imported, rows_failed, quality, duration_ms, created_by)
       VALUES ($1, 1, 1, 0, '{}'::jsonb, 0, $2)`,
      [ANOMALY_IMPORT, users.admin],
    );
    for (let i = 0; i < data.sales.length; i += 5000) {
      const chunk = data.sales.slice(i, i + 5000);
      await m.query(
        `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, unit_price, source, import_id)
         SELECT p, w, d, q, pr, 'IMPORT', $6 FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::numeric[], $5::numeric[]) AS t(p, w, d, q, pr)`,
        [chunk.map((r) => prod[r.sku]), chunk.map((r) => wh[r.warehouse]), chunk.map((r) => r.day), chunk.map((r) => r.qty), chunk.map((r) => r.price), imp.id],
      );
    }

    // Órdenes de compra con sus recepciones
    const audit: { user: DemoUser; action: string; type: string; id: string; changes: unknown; at: string }[] = [];
    const supplierName = Object.fromEntries(SUPPLIERS.map((s) => [s.key, s.name]));
    const refs: Record<string, { id: string; code: string }> = {};
    const orders = [...data.orders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const o of orders) {
      const total = o.lines.reduce((t, l) => t + l.qty * l.cost, 0);
      const [po] = await m.query(
        `INSERT INTO purchase_orders (supplier_id, warehouse_id, status, expected_at, notes, total, created_by, created_at, updated_at,
                                      sent_by, sent_at, cancelled_by, cancelled_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8::timestamptz, COALESCE($11::timestamptz, $9::timestamptz, $8::timestamptz),
                 CASE WHEN $9::timestamptz IS NULL THEN NULL ELSE $7::uuid END, $9::timestamptz,
                 CASE WHEN $10::timestamptz IS NULL THEN NULL ELSE $7::uuid END, $10::timestamptz, $11::timestamptz)
         RETURNING id, number`,
        [sup[o.supplier], wh.PRINCIPAL, o.status, o.expectedAt, o.notes, total, users.marta, o.createdAt, o.sentAt, o.cancelledAt, o.receivedAt],
      );
      const code = `OC-${String(po.number).padStart(6, '0')}`;
      refs[o.key] = { id: po.id, code };
      const lineIds: Record<string, string> = {};
      for (const l of o.lines) {
        const [line] = await m.query(
          `INSERT INTO purchase_order_lines (order_id, product_id, quantity, unit_cost, received_qty) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [po.id, prod[l.sku], l.qty, l.cost, l.received],
        );
        lineIds[l.sku] = line.id;
      }
      audit.push({ user: 'marta', action: 'purchase_order.created', type: 'purchase_order', id: po.id, changes: { number: code, supplier: supplierName[o.supplier], lines: o.lines.length }, at: o.createdAt });
      if (o.sentAt) audit.push({ user: 'marta', action: 'purchase_order.sent', type: 'purchase_order', id: po.id, changes: { number: code, total }, at: o.sentAt });
      if (o.cancelledAt) audit.push({ user: 'marta', action: 'purchase_order.cancelled', type: 'purchase_order', id: po.id, changes: { number: code }, at: o.cancelledAt });
      for (const [n, rc] of o.receipts.entries()) {
        const [receipt] = await m.query(
          `INSERT INTO purchase_receipts (order_id, received_on, lead_time_days, notes, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [po.id, rc.day, rc.leadDays, rc.notes, users.bruno, rc.at],
        );
        for (const l of rc.lines) {
          await m.query(
            `INSERT INTO purchase_receipt_lines (receipt_id, order_line_id, product_id, quantity) VALUES ($1, $2, $3, $4)`,
            [receipt.id, lineIds[l.sku], prod[l.sku], l.qty],
          );
        }
        const last = n === o.receipts.length - 1;
        audit.push({
          user: 'bruno', action: 'purchase_order.received', type: 'purchase_order', id: po.id, at: rc.at,
          changes: { number: code, receivedOn: rc.day, leadTimeDays: rc.leadDays, lines: rc.lines.map((l) => ({ sku: l.sku, quantity: l.qty, over: 0 })),
                     status: last && o.status === 'RECEIVED' ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
        });
      }
    }

    // Transferencias
    const whName = Object.fromEntries(WAREHOUSES.map((w) => [w.code, w.name]));
    for (const t of [...data.transfers].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
      const [tr] = await m.query(
        `INSERT INTO transfers (from_warehouse_id, to_warehouse_id, status, notes, created_by, created_at, received_by, received_at)
         VALUES ($1, $2, $3, $4, $5::uuid, $6, CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE $5::uuid END, $7::timestamptz) RETURNING id, number`,
        [wh[t.from], wh[t.to], t.status, t.notes, users.bruno, t.createdAt, t.receivedAt],
      );
      const code = `TR-${String(tr.number).padStart(6, '0')}`;
      refs[t.key] = { id: tr.id, code };
      for (const l of t.lines) {
        await m.query(`INSERT INTO transfer_lines (transfer_id, product_id, quantity) VALUES ($1, $2, $3)`, [tr.id, prod[l.sku], l.qty]);
      }
      audit.push({ user: 'bruno', action: 'transfer.created', type: 'transfer', id: tr.id, at: t.createdAt, changes: { number: code, from: whName[t.from], to: whName[t.to], lines: t.lines.length } });
      if (t.receivedAt) audit.push({ user: 'bruno', action: 'transfer.received', type: 'transfer', id: tr.id, at: t.receivedAt, changes: { number: code, to: whName[t.to] } });
    }

    // Conteos físicos
    for (const c of data.counts) {
      const [row] = await m.query(
        `INSERT INTO stock_counts (warehouse_id, status, notes, created_by, created_at, submitted_by, submitted_at, reviewed_by, reviewed_at, review_notes)
         VALUES ($1, $2, $3, $4::uuid, $5, $4::uuid, $6, CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE $8::uuid END, $7::timestamptz, $9) RETURNING id, number`,
        [wh[c.warehouse], c.status, c.notes, users.bruno, c.createdAt, c.submittedAt, c.reviewedAt, users.admin, c.reviewNotes],
      );
      const code = `CF-${String(row.number).padStart(6, '0')}`;
      refs[c.key] = { id: row.id, code };
      for (const l of c.lines) {
        await m.query(
          `INSERT INTO stock_count_lines (count_id, product_id, counted_qty, system_qty, difference, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.id, prod[l.sku], l.counted, l.system, l.counted - l.system, c.submittedAt],
        );
      }
      audit.push({ user: 'bruno', action: 'count.submitted', type: 'stock_count', id: row.id, at: c.submittedAt, changes: { number: code, counted: c.lines.length } });
      if (c.reviewedAt) audit.push({ user: 'admin', action: 'count.approved', type: 'stock_count', id: row.id, at: c.reviewedAt, changes: { number: code, adjustments: c.lines.filter((l) => l.counted !== l.system).length } });
    }

    // Kardex y stock de hoy
    for (let i = 0; i < data.movements.length; i += 5000) {
      const chunk = data.movements.slice(i, i + 5000);
      await m.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reason, reference_type, reference_id, user_id, created_at)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::movement_type[], $4::numeric[], $5::numeric[], $6::varchar[], $7::varchar[], $8::uuid[], $9::uuid[], $10::timestamptz[])`,
        [
          chunk.map((x) => prod[x.sku]),
          chunk.map((x) => wh[x.warehouse]),
          chunk.map((x) => x.type),
          chunk.map((x) => x.qty),
          chunk.map((x) => x.balance),
          chunk.map((x) => (x.ref ? x.reason.replace('{ref}', refs[x.ref.key].code) : x.reason)),
          chunk.map((x) => x.ref?.kind ?? null),
          chunk.map((x) => (x.ref ? refs[x.ref.key].id : null)),
          chunk.map((x) => users[x.user] ?? users.admin),
          chunk.map((x) => x.at),
        ],
      );
    }
    for (const s of data.stock) {
      await m.query(`INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES ($1, $2, $3)`, [prod[s.sku], wh[s.warehouse], s.qty]);
    }

    // Alertas de stock bajo (abiertas, vistas y resueltas)
    for (const a of data.alerts) {
      await m.query(
        `INSERT INTO stock_alerts (product_id, status, stock_at_open, current_stock, reorder_point, opened_at, last_notified_at, seen_by, seen_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz, CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE $8::uuid END, $7::timestamptz, $9)`,
        [prod[a.sku], a.status, a.stockAtOpen, a.current, a.reorderPoint, a.openedAt, a.seenAt, users.marta, a.resolvedAt],
      );
    }

    // Auditoría
    audit.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (let i = 0; i < audit.length; i += 2000) {
      const chunk = audit.slice(i, i + 2000);
      await m.query(
        `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, changes, created_at)
         SELECT * FROM unnest($1::uuid[], $2::varchar[], $3::varchar[], $4::varchar[], $5::uuid[], $6::jsonb[], $7::timestamptz[])`,
        [
          chunk.map((x) => users[x.user]),
          chunk.map((x) => emails[x.user]),
          chunk.map((x) => x.action),
          chunk.map((x) => x.type),
          chunk.map((x) => x.id),
          chunk.map((x) => JSON.stringify(x.changes)),
          chunk.map((x) => x.at),
        ],
      );
    }
    await m.query(
      `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, changes)
       VALUES ($1, $2, 'demo.seeded', 'system', $3::jsonb)`,
      [users.admin, emails.admin, JSON.stringify({ products: data.products.length, sales: data.sales.length, movements: data.movements.length, reset: RESET })],
    );

    const low = data.alerts.filter((a) => a.status !== 'RESOLVED').length;
    return (
      `Demo lista: ${data.products.length} productos, ${WAREHOUSES.length} bodegas, ${SUPPLIERS.length} proveedores, ` +
      `${data.sales.length.toLocaleString('es-CO')} ventas diarias, ${data.movements.length.toLocaleString('es-CO')} movimientos, ` +
      `${data.orders.length} órdenes de compra, ${data.transfers.length} transferencias, ${data.counts.length} conteos y ${low} alertas abiertas. ` +
      `Casos raros sembrados en la semana del ${data.anomalyWeek}.`
    );
  });
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
