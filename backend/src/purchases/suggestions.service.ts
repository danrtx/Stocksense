import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';
import { todayInBogota } from '../common/csv';
import { PurchasesService } from './purchases.service';

/** Días entre una revisión de compras y la siguiente (se revisa cada semana). */
export const REVIEW_DAYS = 7;
const WHOLE_UNITS = new Set(['UND', 'CAJA', 'PAQ']);
const DAY = 86_400_000;

export interface SuggestionInput {
  /** Pronóstico semanal (yhat), empezando en `firstWeek`. */
  weekly: number[];
  firstWeek: string;
  today: string;
  leadTimeDays: number;
  onHand: number;
  inTransit: number;
  onOrder: number;
  safetyStock: number;
  unit: string;
}

export interface SuggestionResult {
  quantity: number;
  orderBy: string | null;
  daysUntilOrder: number | null;
  urgency: 'NOW' | 'WEEK' | 'LATER' | 'NONE';
  demandLeadReview: number;
  position: number;
  target: number;
  coverageDays: number;
  stockoutDate: string | null;
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);

/**
 * T-17.1: política de revisión periódica («pedir hasta»).
 *
 *   posición       = stock en bodegas + en camino + pedido a proveedores sin recibir
 *   objetivo       = demanda pronosticada durante (días de entrega + 7 días de revisión) + stock de seguridad
 *   cantidad       = objetivo − posición (redondeado hacia arriba en unidades enteras)
 *   fecha de pedido = último día en que, pidiendo ese día, el pedido llega antes de que el
 *                     stock baje del stock de seguridad.
 *
 * La demanda diaria es el pronóstico semanal ÷ 7. Más allá del horizonte se repite la última semana.
 */
export function computeSuggestion(input: SuggestionInput): SuggestionResult {
  const daily = (offset: number) => {
    const date = addDays(input.today, offset);
    const index = Math.floor(diffDays(date, input.firstWeek) / 7);
    const week = input.weekly[Math.min(Math.max(index, 0), input.weekly.length - 1)] ?? 0;
    return week / 7;
  };
  const cumulative = (days: number) => {
    let total = 0;
    for (let d = 0; d < days; d++) total += daily(d);
    return total;
  };
  const lead = Math.max(0, Math.round(input.leadTimeDays));
  const position = input.onHand + input.inTransit + input.onOrder;
  const demandLeadReview = cumulative(lead + REVIEW_DAYS);
  const target = demandLeadReview + input.safetyStock;
  const raw = Math.max(0, target - position);
  const quantity = WHOLE_UNITS.has(input.unit) ? Math.ceil(raw - 1e-9) : Math.ceil(raw * 10 - 1e-9) / 10;

  // Primer día en que el stock proyectado al llegar el pedido quedaría bajo el de seguridad.
  const horizonDays = input.weekly.length * 7;
  let orderDay: number | null = null;
  let running = 0;
  const prefix: number[] = [0];
  for (let d = 0; d < horizonDays + lead; d++) prefix.push((running += daily(d)));
  for (let t = 0; t < horizonDays; t++) {
    if (position - prefix[t + lead] < input.safetyStock) {
      orderDay = t;
      break;
    }
  }
  let stockout: number | null = null;
  for (let d = 1; d < prefix.length; d++) {
    if (input.onHand + input.inTransit - prefix[d] < 0) {
      stockout = d - 1; // el día d-1 es el primero en que la demanda ya no alcanza
      break;
    }
  }
  const avgDaily = demandLeadReview / Math.max(1, lead + REVIEW_DAYS);
  const urgency = quantity <= 0 || orderDay === null ? 'NONE' : orderDay === 0 ? 'NOW' : orderDay <= 7 ? 'WEEK' : 'LATER';
  return {
    quantity: quantity > 0 ? quantity : 0,
    orderBy: orderDay === null ? null : addDays(input.today, orderDay),
    daysUntilOrder: orderDay,
    urgency,
    demandLeadReview: Math.round(demandLeadReview * 10) / 10,
    position: Math.round(position * 1000) / 1000,
    target: Math.round(target * 10) / 10,
    coverageDays: avgDaily > 0 ? Math.floor((input.onHand + input.inTransit) / avgDaily) : 999,
    stockoutDate: stockout === null ? null : addDays(input.today, stockout),
  };
}

interface Row {
  id: string;
  sku: string;
  name: string;
  unit: string;
  cost: number;
  safetyStock: number | null;
  reorderPoint: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierLead: number | null;
  actualLead: number | null;
  unitCost: number | null;
  weekly: number[] | null;
  firstWeek: string | null;
  onHand: number;
  inTransit: number;
  onOrder: number;
  inDraft: number;
  draftCode: string | null;
}

/** HU-17: sugerencias de reposición con el pronóstico y el tiempo de entrega. */
@Injectable()
export class SuggestionsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly purchases: PurchasesService,
  ) {}

  async list(viewer: AuthUser, supplierId?: string) {
    const [run] = await this.db.query(`SELECT id, version, finished_at AS "trainedAt" FROM forecast_runs WHERE is_active`);
    if (!run) {
      return { run: null, today: todayInBogota(), reviewDays: REVIEW_DAYS, items: [], suppliers: [], withoutSupplier: 0, withoutForecast: 0 };
    }
    const rows: Row[] = await this.db.query(
      `WITH f AS (
         SELECT product_id, array_agg(yhat::float ORDER BY step) AS weekly, min(week_start)::text AS "firstWeek"
           FROM forecasts WHERE run_id = $1 GROUP BY product_id),
       lead AS (
         SELECT po.supplier_id, round(avg(r.lead_time_days), 1)::float AS days
           FROM purchase_receipts r JOIN purchase_orders po ON po.id = r.order_id
          WHERE r.lead_time_days IS NOT NULL GROUP BY po.supplier_id),
       transit AS (
         SELECT tl.product_id, sum(tl.quantity)::float AS qty
           FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
          WHERE t.status = 'PENDING' GROUP BY tl.product_id),
       ordered AS (
         SELECT pol.product_id,
                sum(GREATEST(pol.quantity - pol.received_qty, 0)) FILTER (WHERE po.status IN ('SENT', 'PARTIALLY_RECEIVED'))::float AS open,
                sum(pol.quantity) FILTER (WHERE po.status = 'DRAFT')::float AS draft,
                min(po.number) FILTER (WHERE po.status = 'DRAFT') AS "draftNumber"
           FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
          GROUP BY pol.product_id)
       SELECT p.id, p.sku, p.name, p.unit, p.cost::float AS cost,
              p.safety_stock::float AS "safetyStock", p.reorder_point::float AS "reorderPoint",
              s.id AS "supplierId", s.name AS "supplierName", s.lead_time_days AS "supplierLead",
              lead.days AS "actualLead", ps.unit_cost::float AS "unitCost",
              f.weekly, f."firstWeek",
              COALESCE((SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id), 0)::float AS "onHand",
              COALESCE(transit.qty, 0) AS "inTransit",
              COALESCE(ordered.open, 0) AS "onOrder",
              COALESCE(ordered.draft, 0) AS "inDraft",
              CASE WHEN ordered."draftNumber" IS NOT NULL THEN 'OC-' || lpad(ordered."draftNumber"::text, 6, '0') END AS "draftCode"
         FROM products p
         LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.is_primary
         LEFT JOIN suppliers s ON s.id = ps.supplier_id AND s.is_active
         LEFT JOIN lead ON lead.supplier_id = s.id
         LEFT JOIN f ON f.product_id = p.id
         LEFT JOIN transit ON transit.product_id = p.id
         LEFT JOIN ordered ON ordered.product_id = p.id
        WHERE p.is_active`,
      [run.id],
    );

    const today = todayInBogota();
    const canSeeCost = roleHas(viewer.role, Permission.ProductsCostRead);
    let withoutSupplier = 0;
    let withoutForecast = 0;
    const items = [];
    const suppliers = new Map<string, { id: string; name: string; count: number }>();
    for (const r of rows) {
      if (!r.weekly) {
        withoutForecast += 1;
        continue;
      }
      if (!r.supplierId) {
        withoutSupplier += 1;
        continue;
      }
      const leadTimeDays = r.actualLead ?? r.supplierLead ?? 0;
      const result = computeSuggestion({
        weekly: r.weekly,
        firstWeek: r.firstWeek!,
        today,
        leadTimeDays,
        onHand: r.onHand,
        inTransit: r.inTransit,
        onOrder: r.onOrder,
        safetyStock: r.safetyStock ?? 0,
        unit: r.unit,
      });
      if (result.quantity <= 0) continue;
      if (supplierId && r.supplierId !== supplierId) continue;
      const entry = suppliers.get(r.supplierId) ?? { id: r.supplierId, name: r.supplierName!, count: 0 };
      entry.count += 1;
      suppliers.set(r.supplierId, entry);
      const unitCost = r.unitCost ?? r.cost;
      items.push({
        product: { id: r.id, sku: r.sku, name: r.name, unit: r.unit },
        supplier: { id: r.supplierId, name: r.supplierName, leadTimeDays, leadTimeSource: r.actualLead !== null ? 'ACTUAL' : 'AGREED' },
        ...result,
        safetyStock: r.safetyStock ?? 0,
        safetyStockDefined: r.safetyStock !== null,
        onHand: r.onHand,
        inTransit: r.inTransit,
        onOrder: r.onOrder,
        inDraft: r.inDraft,
        draftCode: r.draftCode,
        reviewDays: REVIEW_DAYS,
        ...(canSeeCost ? { unitCost, subtotal: Math.round(unitCost * result.quantity * 100) / 100 } : {}),
      });
    }
    const rank = { NOW: 0, WEEK: 1, LATER: 2, NONE: 3 } as const;
    items.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.orderBy ?? '').localeCompare(b.orderBy ?? '') || a.product.sku.localeCompare(b.product.sku));
    return {
      run: { version: run.version, trainedAt: run.trainedAt },
      today,
      reviewDays: REVIEW_DAYS,
      items,
      suppliers: [...suppliers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      withoutSupplier,
      withoutForecast,
    };
  }

  /** T-17.3: crea el borrador de orden con las sugerencias elegidas (un clic). */
  async createDraft(actor: AuthUser, supplierId: string, productIds: string[]) {
    const { items, run } = await this.list(actor, supplierId);
    const chosen = items.filter((i) => productIds.includes(i.product.id));
    if (chosen.length === 0) {
      throw new ConflictException('Esas sugerencias ya no están vigentes (quizá ya hiciste el pedido). Actualiza la pantalla.');
    }
    const earliest = chosen.reduce((max, i) => Math.max(max, i.supplier.leadTimeDays), 0);
    return this.purchases.create(
      {
        supplierId,
        lines: chosen.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        expectedAt: addDays(todayInBogota(), Math.ceil(earliest)),
        notes: `Creada desde Sugerencias de compra (pronóstico v${run?.version}).`,
      },
      actor,
    );
  }
}
