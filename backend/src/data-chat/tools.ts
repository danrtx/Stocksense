import { scrubText } from '../ai/data-filter';
import { Permission } from '../common/auth/roles';
import { METHOD_LABELS } from '../forecast/forecast.service';
import { MOVEMENT_LABELS } from '../inventory/stock.service';
import { ORDER_STATUS_LABELS } from '../purchases/purchases.service';

/**
 * HU-25 · T-25.1: herramientas de solo lectura que Gemini puede pedir (function calling).
 *
 * - Cada una es una consulta SELECT con parámetros; corre dentro de una transacción
 *   READ ONLY con tiempo máximo (ver DataChatService.runTool), así que aunque alguien
 *   cambiara el SQL no podría escribir en la base.
 * - Cada una declara los permisos que necesita: a Gemini solo se le ofrecen las del rol,
 *   y si pidiera otra se rechaza. Bodega, por ejemplo, no tiene ninguna con costos.
 * - Lo que devuelven son cifras de inventario: nada de costos unitarios, márgenes,
 *   proveedores con datos de contacto ni nombres de personas.
 */

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export type ColumnType = 'text' | 'code' | 'qty' | 'money' | 'pct' | 'date' | 'datetime';

export interface ToolColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ToolOutput {
  /** Título de la fuente que ve la persona («Productos bajo el punto de reorden»). */
  title: string;
  columns: ToolColumn[];
  rows: Record<string, unknown>[];
  /** Total de filas antes del límite. */
  total: number;
  /** Datos adicionales para Gemini (totales, periodo, notas). */
  extra?: Record<string, unknown>;
}

export interface ToolContext {
  canSeeCost: boolean;
}

export interface DataTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  permissions: Permission[];
  run: (q: Query, args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
}

// ------------------------------------------------------------------ validación de argumentos

const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const todayBogota = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const STATUS_LABEL = { OUT: 'Agotado', LOW: 'Bajo el punto de reorden', OK: 'Normal' } as const;

const STOCK_CTE = `
  stock AS (
    SELECT p.id, COALESCE(sum(sl.quantity), 0) AS on_hand
      FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id
     GROUP BY p.id
  ), transit AS (
    SELECT tl.product_id, sum(tl.quantity) AS qty FROM transfer_lines tl
      JOIN transfers t ON t.id = tl.transfer_id WHERE t.status = 'PENDING' GROUP BY tl.product_id
  )`;

const statusSql = (total: string) =>
  `CASE WHEN ${total} <= 0 THEN 'OUT' WHEN p.reorder_point > 0 AND ${total} <= p.reorder_point THEN 'LOW' ELSE 'OK' END`;

async function findProduct(q: Query, sku: unknown) {
  const s = text(sku, 40);
  if (!s) return null;
  const [p] = await q(
    `SELECT p.id, p.sku, p.name, p.unit, p.reorder_point::float AS "reorderPoint", c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active AND (upper(p.sku) = upper($1) OR p.name ILIKE $2)
      ORDER BY (upper(p.sku) = upper($1)) DESC, length(p.name) LIMIT 1`,
    [s, like(s)],
  );
  return (p as { id: string; sku: string; name: string; unit: string; reorderPoint: number | null; category: string | null }) ?? null;
}

const notFound = (title: string, sku: unknown): ToolOutput => ({
  title,
  columns: [],
  rows: [],
  total: 0,
  extra: { nota: `No hay un producto activo con SKU o nombre «${text(sku, 40)}». Usa buscar_productos para encontrarlo.` },
});

// ------------------------------------------------------------------ herramientas

export const DATA_TOOLS: DataTool[] = [
  {
    name: 'buscar_productos',
    description:
      'Busca productos activos por nombre, SKU o categoría y devuelve su stock total, punto de reorden y estado. Úsala primero cuando la persona nombra un producto de forma aproximada.',
    parameters: {
      type: 'OBJECT',
      properties: {
        texto: { type: 'STRING', description: 'Parte del nombre, el SKU o la categoría.' },
        limite: { type: 'INTEGER', description: 'Máximo de resultados (1 a 15).' },
      },
      required: ['texto'],
    },
    permissions: [Permission.ProductsRead, Permission.StockRead],
    async run(q, args) {
      const term = text(args.texto, 60);
      const rows = await q(
        `WITH ${STOCK_CTE}
         SELECT p.sku, p.name AS nombre, c.name AS categoria, p.unit AS unidad,
                (s.on_hand + COALESCE(t.qty, 0))::float AS stock, p.reorder_point::float AS "puntoReorden",
                ${statusSql('(s.on_hand + COALESCE(t.qty, 0))')} AS estado, count(*) OVER()::int AS total
           FROM products p JOIN stock s ON s.id = p.id LEFT JOIN transit t ON t.product_id = p.id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.is_active AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR c.name ILIKE $1)
          ORDER BY p.name LIMIT $2`,
        [like(term), int(args.limite, 1, 15, 10)],
      );
      return {
        title: `Productos que coinciden con «${term}»`,
        columns: [
          { key: 'sku', label: 'SKU', type: 'code' },
          { key: 'nombre', label: 'Producto', type: 'text' },
          { key: 'categoria', label: 'Categoría', type: 'text' },
          { key: 'stock', label: 'Stock', type: 'qty' },
          { key: 'unidad', label: 'Unidad', type: 'text' },
          { key: 'estado', label: 'Estado', type: 'text' },
        ],
        rows: rows.map(({ total: _t, ...r }) => ({ ...r, estado: STATUS_LABEL[r.estado as keyof typeof STATUS_LABEL] })),
        total: (rows[0]?.total as number) ?? 0,
      };
    },
  },
  {
    name: 'stock_producto',
    description: 'Stock actual de un producto en cada bodega, lo que va en camino entre bodegas y su punto de reorden.',
    parameters: {
      type: 'OBJECT',
      properties: { sku: { type: 'STRING', description: 'SKU exacto o nombre del producto.' } },
      required: ['sku'],
    },
    permissions: [Permission.StockRead],
    async run(q, args) {
      const p = await findProduct(q, args.sku);
      if (!p) return notFound('Stock por bodega', args.sku);
      const rows = await q(
        `SELECT w.name AS bodega, COALESCE(sl.quantity, 0)::float AS cantidad
           FROM warehouses w LEFT JOIN stock_levels sl ON sl.warehouse_id = w.id AND sl.product_id = $1
          WHERE w.is_active ORDER BY w.is_default DESC, w.name`,
        [p.id],
      );
      const [transit] = await q(
        `SELECT COALESCE(sum(tl.quantity), 0)::float AS qty FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
          WHERE t.status = 'PENDING' AND tl.product_id = $1`,
        [p.id],
      );
      const onHand = rows.reduce((s, r) => s + (r.cantidad as number), 0);
      return {
        title: `Stock por bodega de ${p.sku} · ${p.name}`,
        columns: [
          { key: 'bodega', label: 'Bodega', type: 'text' },
          { key: 'cantidad', label: `Cantidad (${p.unit})`, type: 'qty' },
        ],
        rows,
        total: rows.length,
        extra: {
          producto: { sku: p.sku, nombre: p.name, unidad: p.unit, categoria: p.category },
          totalEnBodegas: Math.round(onHand * 1000) / 1000,
          enCamino: transit.qty,
          puntoReorden: p.reorderPoint,
        },
      };
    },
  },
  {
    name: 'productos_bajo_reorden',
    description: 'Productos cuyo stock total (bodegas más lo que va en camino) está en su punto de reorden o por debajo, con cuánto les falta.',
    parameters: {
      type: 'OBJECT',
      properties: {
        categoria: { type: 'STRING', description: 'Nombre de la categoría (opcional).' },
        limite: { type: 'INTEGER', description: 'Máximo de productos (1 a 25).' },
      },
    },
    permissions: [Permission.StockRead],
    async run(q, args) {
      const cat = text(args.categoria, 60);
      const rows = await q(
        `WITH ${STOCK_CTE}
         SELECT p.sku, p.name AS nombre, p.unit AS unidad, (s.on_hand + COALESCE(t.qty, 0))::float AS stock,
                p.reorder_point::float AS "puntoReorden",
                (p.reorder_point - (s.on_hand + COALESCE(t.qty, 0)))::float AS "faltaParaElPunto", count(*) OVER()::int AS total
           FROM products p JOIN stock s ON s.id = p.id LEFT JOIN transit t ON t.product_id = p.id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.is_active AND p.reorder_point > 0 AND (s.on_hand + COALESCE(t.qty, 0)) <= p.reorder_point
            AND ($1 = '' OR c.name ILIKE $2)
          ORDER BY (s.on_hand + COALESCE(t.qty, 0)) / NULLIF(p.reorder_point, 0), p.sku
          LIMIT $3`,
        [cat, like(cat), int(args.limite, 1, 25, 15)],
      );
      return {
        title: cat ? `Bajo el punto de reorden en ${cat}` : 'Productos bajo el punto de reorden',
        columns: [
          { key: 'sku', label: 'SKU', type: 'code' },
          { key: 'nombre', label: 'Producto', type: 'text' },
          { key: 'stock', label: 'Stock', type: 'qty' },
          { key: 'puntoReorden', label: 'Punto de reorden', type: 'qty' },
          { key: 'faltaParaElPunto', label: 'Falta', type: 'qty' },
          { key: 'unidad', label: 'Unidad', type: 'text' },
        ],
        rows: rows.map(({ total: _t, ...r }) => r),
        total: (rows[0]?.total as number) ?? 0,
      };
    },
  },
  {
    name: 'productos_por_agotarse',
    description:
      'Según el pronóstico vigente, productos cuyo stock actual no alcanza para la demanda esperada de las próximas N semanas, con la semana en que se agotarían. Úsala para «¿qué se agota este mes?».',
    parameters: {
      type: 'OBJECT',
      properties: {
        semanas: { type: 'INTEGER', description: 'Semanas hacia adelante (1 a 12). «Este mes» = 4.' },
        limite: { type: 'INTEGER', description: 'Máximo de productos (1 a 25).' },
      },
    },
    permissions: [Permission.StockRead, Permission.ForecastRead],
    async run(q, args) {
      const weeks = int(args.semanas, 1, 12, 4);
      const [run] = await q(`SELECT id, version, data_last_week::text AS "dataLastWeek" FROM forecast_runs WHERE is_active`);
      if (!run) {
        return { title: 'Productos por agotarse', columns: [], rows: [], total: 0, extra: { nota: 'Todavía no hay un pronóstico activo.' } };
      }
      const rows = await q(
        `WITH ${STOCK_CTE},
         demand AS (
           SELECT f.product_id, f.step, f.week_start, sum(f.yhat) OVER (PARTITION BY f.product_id ORDER BY f.step) AS cum
             FROM forecasts f WHERE f.run_id = $1 AND f.step <= $2
         ), out AS (
           SELECT d.product_id, min(d.week_start) FILTER (WHERE d.cum >= s.on_hand) AS week, max(d.cum) AS need
             FROM demand d JOIN stock s ON s.id = d.product_id GROUP BY d.product_id
         )
         SELECT p.sku, p.name AS nombre, p.unit AS unidad, s.on_hand::float AS stock,
                round(o.need, 1)::float AS "demandaEsperada", o.week::text AS "semanaEnQueSeAgota", count(*) OVER()::int AS total
           FROM out o JOIN products p ON p.id = o.product_id JOIN stock s ON s.id = p.id
          WHERE p.is_active AND o.week IS NOT NULL
          ORDER BY o.week, o.need - s.on_hand DESC, p.sku
          LIMIT $3`,
        [run.id, weeks, int(args.limite, 1, 25, 15)],
      );
      return {
        title: `Productos que se agotarían en las próximas ${weeks} semanas`,
        columns: [
          { key: 'sku', label: 'SKU', type: 'code' },
          { key: 'nombre', label: 'Producto', type: 'text' },
          { key: 'stock', label: 'Stock hoy', type: 'qty' },
          { key: 'demandaEsperada', label: `Demanda ${weeks} sem.`, type: 'qty' },
          { key: 'semanaEnQueSeAgota', label: 'Se agota la semana del', type: 'date' },
          { key: 'unidad', label: 'Unidad', type: 'text' },
        ],
        rows: rows.map(({ total: _t, ...r }) => r),
        total: (rows[0]?.total as number) ?? 0,
        extra: {
          semanas: weeks,
          versionPronostico: run.version,
          datosHastaLaSemanaDel: run.dataLastWeek,
          nota: 'No descuenta compras en camino; es el stock en bodegas frente a la demanda pronosticada.',
        },
      };
    },
  },
  {
    name: 'pronostico_producto',
    description: 'Pronóstico semanal de un producto (cantidad esperada con mínimo y máximo probables) y la precisión del modelo para ese producto.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sku: { type: 'STRING', description: 'SKU exacto o nombre del producto.' },
        semanas: { type: 'INTEGER', description: 'Semanas hacia adelante (1 a 12).' },
      },
      required: ['sku'],
    },
    permissions: [Permission.ForecastRead],
    async run(q, args) {
      const p = await findProduct(q, args.sku);
      if (!p) return notFound('Pronóstico', args.sku);
      const weeks = int(args.semanas, 1, 12, 4);
      const rows = await q(
        `SELECT f.week_start::text AS semana, f.yhat::float AS esperado, f.lo::float AS minimo, f.hi::float AS maximo
           FROM forecasts f JOIN forecast_runs r ON r.id = f.run_id AND r.is_active
          WHERE f.product_id = $1 AND f.step <= $2 ORDER BY f.step`,
        [p.id, weeks],
      );
      const [m] = await q(
        `SELECT m.method, m.test_wape::float AS wape FROM forecast_product_models m JOIN forecast_runs r ON r.id = m.run_id AND r.is_active
          WHERE m.product_id = $1`,
        [p.id],
      );
      return {
        title: `Pronóstico de ${p.sku} · ${p.name}`,
        columns: [
          { key: 'semana', label: 'Semana del', type: 'date' },
          { key: 'esperado', label: `Esperado (${p.unit})`, type: 'qty' },
          { key: 'minimo', label: 'Mínimo', type: 'qty' },
          { key: 'maximo', label: 'Máximo', type: 'qty' },
        ],
        rows,
        total: rows.length,
        extra: rows.length
          ? {
              producto: { sku: p.sku, nombre: p.name, unidad: p.unit },
              totalEsperado: Math.round(rows.reduce((s, r) => s + (r.esperado as number), 0) * 10) / 10,
              tecnica: m ? (METHOD_LABELS[m.method as string] ?? 'Combinación de técnicas') : null,
              precisionPct: m?.wape !== null && m?.wape !== undefined ? Math.round((1 - (m.wape as number)) * 100) : null,
            }
          : { nota: 'Este producto no tiene pronóstico: le faltan semanas de ventas o el modelo no se ha entrenado.' },
      };
    },
  },
  {
    name: 'ventas_resumen',
    description:
      'Unidades vendidas en un periodo, agrupadas por producto, por categoría o por semana. Sirve para «¿qué fue lo más vendido?», «¿cuánto vendimos de X?» o «¿cómo van las ventas por semana?».',
    parameters: {
      type: 'OBJECT',
      properties: {
        desde: { type: 'STRING', description: 'Fecha inicial AAAA-MM-DD (por defecto, hace 30 días).' },
        hasta: { type: 'STRING', description: 'Fecha final AAAA-MM-DD (por defecto, hoy).' },
        agrupar: { type: 'STRING', enum: ['producto', 'categoria', 'semana'], description: 'Cómo agrupar.' },
        sku: { type: 'STRING', description: 'Solo este producto (opcional).' },
        categoria: { type: 'STRING', description: 'Solo esta categoría (opcional).' },
        limite: { type: 'INTEGER', description: 'Máximo de filas (1 a 25).' },
      },
    },
    permissions: [Permission.ProductsRead, Permission.StockRead],
    async run(q, args) {
      const to = isoDate(args.hasta) ?? todayBogota();
      let from = isoDate(args.desde) ?? addDays(to, -29);
      if (from > to) from = addDays(to, -29);
      if (Date.parse(to) - Date.parse(from) > 2 * 366 * 86_400_000) from = addDays(to, -2 * 366);
      const group = ['producto', 'categoria', 'semana'].includes(args.agrupar as string) ? (args.agrupar as string) : 'producto';
      const p = args.sku ? await findProduct(q, args.sku) : null;
      if (args.sku && !p) return notFound('Ventas', args.sku);
      const cat = text(args.categoria, 60);
      const key =
        group === 'categoria' ? `COALESCE(c.name, 'Sin categoría')` : group === 'semana' ? `date_trunc('week', s.sold_on)::date::text` : `p.sku || ' · ' || p.name`;
      const rows = await q(
        `SELECT ${key} AS grupo, ${group === 'producto' ? 'min(p.unit::text)' : `CASE WHEN count(DISTINCT p.unit) = 1 THEN min(p.unit::text) ELSE 'varias' END`} AS unidad,
                sum(s.quantity)::float AS vendido, count(DISTINCT s.sold_on)::int AS "diasConVenta", count(*) OVER()::int AS total
           FROM sales s JOIN products p ON p.id = s.product_id LEFT JOIN categories c ON c.id = p.category_id
          WHERE s.sold_on BETWEEN $1::date AND $2::date
            AND ($3::uuid IS NULL OR p.id = $3) AND ($4 = '' OR c.name ILIKE $5)
          GROUP BY 1
          ORDER BY ${group === 'semana' ? '1' : '3 DESC'}
          LIMIT $6`,
        [from, to, p?.id ?? null, cat, like(cat), int(args.limite, 1, 25, group === 'semana' ? 25 : 10)],
      );
      const label = { producto: 'Producto', categoria: 'Categoría', semana: 'Semana del' }[group]!;
      return {
        title: `Ventas del ${from} al ${to} por ${group}${p ? ` (${p.sku})` : ''}${cat ? ` en ${cat}` : ''}`,
        columns: [
          { key: 'grupo', label, type: group === 'semana' ? 'date' : 'text' },
          { key: 'vendido', label: 'Vendido', type: 'qty' },
          { key: 'unidad', label: 'Unidad', type: 'text' },
          { key: 'diasConVenta', label: 'Días con venta', type: 'qty' },
        ],
        rows: rows.map(({ total: _t, ...r }) => r),
        total: (rows[0]?.total as number) ?? 0,
        extra: { desde: from, hasta: to, agrupadoPor: group, nota: 'Cantidades en unidades del producto; no incluye valores en dinero.' },
      };
    },
  },
  {
    name: 'movimientos_recientes',
    description: 'Últimos movimientos de inventario (entradas, salidas, ajustes, transferencias, recepciones, ventas) de un producto o de todos, con su motivo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sku: { type: 'STRING', description: 'SKU o nombre del producto (opcional).' },
        tipo: { type: 'STRING', enum: Object.keys(MOVEMENT_LABELS), description: 'Tipo de movimiento (opcional).' },
        dias: { type: 'INTEGER', description: 'Días hacia atrás (1 a 90).' },
        limite: { type: 'INTEGER', description: 'Máximo de movimientos (1 a 20).' },
      },
    },
    permissions: [Permission.StockRead],
    async run(q, args) {
      const p = args.sku ? await findProduct(q, args.sku) : null;
      if (args.sku && !p) return notFound('Movimientos', args.sku);
      const type = typeof args.tipo === 'string' && MOVEMENT_LABELS[args.tipo] ? args.tipo : null;
      const days = int(args.dias, 1, 90, 30);
      const rows = await q(
        `SELECT m.created_at AS fecha, m.type::text AS tipo, p.sku, p.name AS producto, w.name AS bodega,
                m.quantity::float AS cantidad, m.balance_after::float AS saldo, m.reason AS motivo, count(*) OVER()::int AS total
           FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id
          WHERE m.created_at >= now() - make_interval(days => $1)
            AND ($2::uuid IS NULL OR m.product_id = $2) AND ($3::text IS NULL OR m.type::text = $3)
          ORDER BY m.created_at DESC LIMIT $4`,
        [days, p?.id ?? null, type, int(args.limite, 1, 20, 10)],
      );
      return {
        title: `Movimientos de los últimos ${days} días${p ? ` de ${p.sku}` : ''}${type ? ` (${MOVEMENT_LABELS[type]})` : ''}`,
        columns: [
          { key: 'fecha', label: 'Fecha', type: 'datetime' },
          { key: 'tipo', label: 'Tipo', type: 'text' },
          { key: 'sku', label: 'SKU', type: 'code' },
          { key: 'cantidad', label: 'Cantidad', type: 'qty' },
          { key: 'saldo', label: 'Saldo', type: 'qty' },
          { key: 'bodega', label: 'Bodega', type: 'text' },
          { key: 'motivo', label: 'Motivo', type: 'text' },
        ],
        rows: rows.map(({ total: _t, ...r }) => ({
          ...r,
          fecha: new Date(r.fecha as string).toISOString(),
          tipo: MOVEMENT_LABELS[r.tipo as string] ?? r.tipo,
          motivo: scrubText(String(r.motivo ?? '')).slice(0, 120),
        })),
        total: (rows[0]?.total as number) ?? 0,
      };
    },
  },
  {
    name: 'valor_inventario',
    description: 'Valor total del inventario al costo, por categoría y por bodega. Solo para roles que pueden ver costos.',
    parameters: {
      type: 'OBJECT',
      properties: { agrupar: { type: 'STRING', enum: ['categoria', 'bodega'], description: 'Cómo desglosar.' } },
    },
    permissions: [Permission.StockRead, Permission.ProductsCostRead],
    async run(q, args) {
      const byWarehouse = args.agrupar === 'bodega';
      const rows = await q(
        `SELECT ${byWarehouse ? 'w.name' : `COALESCE(c.name, 'Sin categoría')`} AS grupo,
                round(sum(sl.quantity * p.cost))::float AS valor, count(DISTINCT p.id)::int AS productos
           FROM stock_levels sl JOIN products p ON p.id = sl.product_id JOIN warehouses w ON w.id = sl.warehouse_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.is_active AND sl.quantity > 0
          GROUP BY 1 ORDER BY 2 DESC`,
      );
      const total = rows.reduce((s, r) => s + (r.valor as number), 0);
      return {
        title: `Valor del inventario por ${byWarehouse ? 'bodega' : 'categoría'}`,
        columns: [
          { key: 'grupo', label: byWarehouse ? 'Bodega' : 'Categoría', type: 'text' },
          { key: 'valor', label: 'Valor al costo', type: 'money' },
          { key: 'productos', label: 'Productos', type: 'qty' },
        ],
        rows,
        total: rows.length,
        extra: { valorTotal: total, moneda: 'COP' },
      };
    },
  },
  {
    name: 'ordenes_compra_abiertas',
    description: 'Órdenes de compra en borrador, enviadas o recibidas a medias, con su proveedor, fecha esperada y si están atrasadas.',
    parameters: { type: 'OBJECT', properties: { proveedor: { type: 'STRING', description: 'Parte del nombre del proveedor (opcional).' } } },
    permissions: [Permission.PurchasesRead],
    async run(q, args) {
      const sup = text(args.proveedor, 60);
      const rows = await q(
        `SELECT 'OC-' || lpad(o.number::text, 6, '0') AS orden, s.name AS proveedor, o.status::text AS estado,
                o.expected_at::text AS "fechaEsperada", (o.status <> 'DRAFT' AND o.expected_at < CURRENT_DATE) AS atrasada,
                (SELECT count(*)::int FROM purchase_order_lines l WHERE l.order_id = o.id) AS productos
           FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
          WHERE o.status IN ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED') AND ($1 = '' OR s.name ILIKE $2)
          ORDER BY o.expected_at NULLS LAST, o.number LIMIT 20`,
        [sup, like(sup)],
      );
      return {
        title: 'Órdenes de compra abiertas',
        columns: [
          { key: 'orden', label: 'Orden', type: 'code' },
          { key: 'proveedor', label: 'Proveedor', type: 'text' },
          { key: 'estado', label: 'Estado', type: 'text' },
          { key: 'fechaEsperada', label: 'Llega', type: 'date' },
          { key: 'productos', label: 'Productos', type: 'qty' },
        ],
        rows: rows.map((r) => ({ ...r, estado: `${ORDER_STATUS_LABELS[r.estado as string] ?? r.estado}${r.atrasada ? ' (atrasada)' : ''}` })),
        total: rows.length,
      };
    },
  },
  {
    name: 'anomalias_abiertas',
    description: 'Semanas con ventas o mermas fuera de lo normal que nadie ha revisado todavía.',
    permissions: [Permission.ReportsRead],
    async run(q) {
      const rows = await q(
        `SELECT p.sku, p.name AS producto, a.kind AS tipo, a.week_start::text AS semana, a.observed::float AS observado,
                round(a.expected, 1)::float AS esperado, p.unit AS unidad
           FROM anomalies a JOIN products p ON p.id = a.product_id
          WHERE a.status = 'OPEN' ORDER BY a.week_start DESC, abs(a.z_score) DESC LIMIT 15`,
      );
      const kinds: Record<string, string> = { SALES_SPIKE: 'Ventas muy altas', SALES_DROP: 'Ventas muy bajas', SHRINK: 'Merma' };
      return {
        title: 'Anomalías sin revisar',
        columns: [
          { key: 'sku', label: 'SKU', type: 'code' },
          { key: 'producto', label: 'Producto', type: 'text' },
          { key: 'tipo', label: 'Tipo', type: 'text' },
          { key: 'semana', label: 'Semana del', type: 'date' },
          { key: 'observado', label: 'Observado', type: 'qty' },
          { key: 'esperado', label: 'Esperado', type: 'qty' },
        ],
        rows: rows.map((r) => ({ ...r, tipo: kinds[r.tipo as string] ?? r.tipo })),
        total: rows.length,
      };
    },
  },
];

/** Herramienta especial: Gemini la pide cuando la pregunta no se puede o no se debe responder. */
export const OUT_OF_SCOPE = {
  name: 'fuera_de_alcance',
  description:
    'Llámala cuando la pregunta no trate del inventario, ventas, compras o pronósticos de este negocio; cuando pida crear, modificar o borrar algo; o cuando necesite datos que tu rol no puede ver (por ejemplo costos o márgenes si no tienes la herramienta valor_inventario).',
  parameters: {
    type: 'OBJECT',
    properties: {
      motivo: { type: 'STRING', enum: ['no_es_inventario', 'pide_modificar', 'sin_permiso', 'otro'] },
    },
    required: ['motivo'],
  },
};

export function toolsFor(permissions: Permission[]): DataTool[] {
  return DATA_TOOLS.filter((t) => t.permissions.every((p) => permissions.includes(p)));
}
