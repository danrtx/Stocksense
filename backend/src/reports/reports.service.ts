import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, roleHas } from '../common/auth/roles';
import { METHOD_LABELS } from '../forecast/forecast.service';
import { MOVEMENT_LABELS } from '../inventory/stock.service';
import { SettingsService } from '../settings/settings.service';
import { fmtDate, fmtPct, ReportColumn, ReportFilters, ReportKind, ReportResult, ReportRow } from './report-types';

/** Máximo de filas en un archivo. La meta de HU-28 es 10.000 filas en menos de 30 s; se deja margen. */
export const EXPORT_MAX_ROWS = 50_000;
export const PREVIEW_ROWS = 100;

const DAY = 86_400_000;

const todayBogota = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * HU-28: los cuatro reportes. La misma consulta alimenta la vista previa, el Excel y el PDF,
 * así el archivo trae exactamente lo que se ve con los filtros aplicados.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly settings: SettingsService,
  ) {}

  async build(kind: ReportKind, filters: ReportFilters, viewer: AuthUser, limit: number): Promise<ReportResult> {
    const canSeeCost = roleHas(viewer.role, Permission.ProductsCostRead);
    const lookups = await this.lookups(filters);
    let result: ReportResult;
    switch (kind) {
      case 'stock':
        result = await this.stock(filters, limit);
        break;
      case 'movements':
        result = await this.movements(filters, limit);
        break;
      case 'rotation':
        result = await this.rotation(filters, limit);
        break;
      case 'accuracy':
        result = await this.accuracy(filters, limit);
        break;
      default:
        throw new BadRequestException('Ese reporte no existe.');
    }
    result.filtersApplied = [...lookups, ...result.filtersApplied];
    if (!canSeeCost) {
      const hidden = result.columns.filter((c) => c.type === 'money');
      if (hidden.length) {
        result.columns = result.columns.filter((c) => c.type !== 'money');
        result.rows = result.rows.map((r) => strip(r, hidden));
        result.totals = result.totals ? strip(result.totals, hidden) : null;
        result.notes.push('Tu rol no ve costos: las columnas de valor no se incluyen.');
      }
    }
    if (result.total > result.rows.length && limit >= EXPORT_MAX_ROWS) {
      result.notes.push(`El archivo trae las primeras ${EXPORT_MAX_ROWS.toLocaleString('es-CO')} filas de ${result.total.toLocaleString('es-CO')}. Usa filtros para acotar.`);
    }
    return result;
  }

  private async lookups(filters: ReportFilters) {
    const out: { label: string; value: string }[] = [];
    if (filters.warehouseId) {
      const [w] = await this.db.query(`SELECT name FROM warehouses WHERE id = $1`, [filters.warehouseId]);
      if (!w) throw new BadRequestException('La bodega del filtro no existe.');
      out.push({ label: 'Bodega', value: w.name });
    }
    if (filters.categoryId) {
      const [c] = await this.db.query(`SELECT name FROM categories WHERE id = $1`, [filters.categoryId]);
      if (!c) throw new BadRequestException('La categoría del filtro no existe.');
      out.push({ label: 'Categoría', value: c.name });
    }
    return out;
  }

  private period(filters: ReportFilters, defaultDays: number) {
    const to = filters.to ?? todayBogota();
    const from = filters.from ?? shiftDays(to, -(defaultDays - 1));
    if (from > to) throw new BadRequestException('La fecha inicial es posterior a la final.');
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    if (days > 3 * 366) throw new BadRequestException('El periodo máximo es de 3 años.');
    return { from, to, days };
  }

  // ---------------------------------------------------------------- Stock valorizado

  private async stock(filters: ReportFilters, limit: number): Promise<ReportResult> {
    const rows = await this.db.query(
      `SELECT p.sku, p.name, c.name AS category, p.unit, w.name AS warehouse,
              sl.quantity::float AS quantity, p.cost::float AS cost, round(sl.quantity * p.cost, 2)::float AS value,
              count(*) OVER()::int AS total,
              sum(round(sl.quantity * p.cost, 2)) OVER()::float AS "totalValue"
         FROM stock_levels sl
         JOIN products p ON p.id = sl.product_id
         JOIN warehouses w ON w.id = sl.warehouse_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active AND sl.quantity <> 0
          AND ($1::uuid IS NULL OR sl.warehouse_id = $1)
          AND ($2::uuid IS NULL OR p.category_id = $2)
        ORDER BY sl.quantity * p.cost DESC, p.sku, w.name
        LIMIT $3`,
      [filters.warehouseId ?? null, filters.categoryId ?? null, limit],
    );
    const columns: ReportColumn[] = [
      { key: 'sku', label: 'SKU', type: 'code', width: 11 },
      { key: 'name', label: 'Producto', type: 'text', width: 30 },
      { key: 'category', label: 'Categoría', type: 'text', width: 16 },
      { key: 'warehouse', label: 'Bodega', type: 'text', width: 16 },
      { key: 'unit', label: 'Unidad', type: 'text', width: 7 },
      { key: 'quantity', label: 'Cantidad', type: 'qty', width: 10 },
      { key: 'cost', label: 'Costo unitario', type: 'money', width: 13 },
      { key: 'value', label: 'Valor', type: 'money', width: 14 },
    ];
    return {
      kind: 'stock',
      title: 'Stock valorizado',
      subtitle: 'Existencias actuales por producto y bodega, valoradas al costo del producto.',
      columns,
      rows: rows.map(({ total: _t, totalValue: _v, ...r }: ReportRow) => r),
      total: rows[0]?.total ?? 0,
      totals: rows.length ? { name: 'Total', value: rows[0].totalValue } : null,
      filtersApplied: [],
      notes: [],
    };
  }

  // ---------------------------------------------------------------- Movimientos

  private async movements(filters: ReportFilters, limit: number): Promise<ReportResult> {
    const { from, to } = this.period(filters, 30);
    if (filters.type && !MOVEMENT_LABELS[filters.type]) throw new BadRequestException('Tipo de movimiento desconocido.');
    const rows = await this.db.query(
      `SELECT m.created_at AS date, m.type::text AS type, p.sku, p.name, w.name AS warehouse,
              m.quantity::float AS quantity, m.balance_after::float AS balance, p.unit, m.reason,
              u.full_name AS "user", count(*) OVER()::int AS total
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Bogota')
          AND m.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Bogota')
          AND ($3::uuid IS NULL OR m.warehouse_id = $3)
          AND ($4::uuid IS NULL OR p.category_id = $4)
          AND ($5::text IS NULL OR m.type::text = $5)
        ORDER BY m.created_at DESC, m.id
        LIMIT $6`,
      [from, to, filters.warehouseId ?? null, filters.categoryId ?? null, filters.type ?? null, limit],
    );
    const applied = [{ label: 'Periodo', value: `${fmtDate(from)} a ${fmtDate(to)}` }];
    if (filters.type) applied.push({ label: 'Tipo', value: MOVEMENT_LABELS[filters.type] });
    return {
      kind: 'movements',
      title: 'Movimientos de inventario',
      subtitle: 'Entradas, salidas, ajustes, transferencias, recepciones y ventas con el saldo que dejó cada una.',
      columns: [
        { key: 'date', label: 'Fecha y hora', type: 'datetime', width: 20 },
        { key: 'type', label: 'Tipo', type: 'text', width: 15 },
        { key: 'sku', label: 'SKU', type: 'code', width: 11 },
        { key: 'name', label: 'Producto', type: 'text', width: 24 },
        { key: 'warehouse', label: 'Bodega', type: 'text', width: 14 },
        { key: 'quantity', label: 'Cantidad', type: 'qty', width: 9 },
        { key: 'balance', label: 'Saldo', type: 'qty', width: 9 },
        { key: 'unit', label: 'Unidad', type: 'text', width: 7 },
        { key: 'reason', label: 'Motivo', type: 'text', width: 22 },
        { key: 'user', label: 'Usuario', type: 'text', width: 15 },
      ],
      rows: rows.map(({ total: _t, ...r }: ReportRow) => ({
        ...r,
        date: new Date(r.date as string).toISOString(),
        type: MOVEMENT_LABELS[r.type as string] ?? r.type,
      })),
      total: rows[0]?.total ?? 0,
      totals: null,
      filtersApplied: applied,
      notes: [],
    };
  }

  // ---------------------------------------------------------------- Rotación

  private async rotation(filters: ReportFilters, limit: number): Promise<ReportResult> {
    const { from, to, days } = this.period(filters, 365);
    const rows: {
      sku: string;
      name: string;
      category: string | null;
      unit: string;
      sold: number;
      stock: number;
      cost: number;
    }[] = await this.db.query(
      `WITH sold AS (
         SELECT s.product_id, sum(s.quantity) AS units FROM sales s
          WHERE s.sold_on BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR s.warehouse_id = $3)
          GROUP BY s.product_id
       ), stock AS (
         SELECT product_id, sum(quantity) AS qty FROM stock_levels
          WHERE ($3::uuid IS NULL OR warehouse_id = $3) GROUP BY product_id
       )
       SELECT p.sku, p.name, c.name AS category, p.unit,
              COALESCE(sold.units, 0)::float AS sold, COALESCE(stock.qty, 0)::float AS stock, p.cost::float AS cost
         FROM products p
         LEFT JOIN sold ON sold.product_id = p.id
         LEFT JOIN stock ON stock.product_id = p.id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active AND ($4::uuid IS NULL OR p.category_id = $4)
          AND (COALESCE(sold.units, 0) > 0 OR COALESCE(stock.qty, 0) > 0)`,
      [from, to, filters.warehouseId ?? null, filters.categoryId ?? null],
    );
    const factor = 365 / days;
    const computed = rows.map((r) => {
      const perDay = r.sold / days;
      const rotation = r.stock > 0 ? Math.round(((r.sold * factor) / r.stock) * 100) / 100 : null;
      const daysOfInventory = perDay > 0 ? Math.round(Math.max(0, r.stock) / perDay) : null;
      return {
        sku: r.sku,
        name: r.name,
        category: r.category,
        unit: r.unit,
        sold: r.sold,
        stock: r.stock,
        rotation,
        daysOfInventory,
        soldCost: Math.round(r.sold * r.cost),
        stockValue: Math.round(Math.max(0, r.stock) * r.cost),
      };
    });
    // Primero lo que menos rota (más días de inventario o sin ventas): es lo que hay que revisar.
    computed.sort((a, b) => (b.daysOfInventory ?? Infinity) - (a.daysOfInventory ?? Infinity) || a.sku.localeCompare(b.sku));
    const sum = (k: 'soldCost' | 'stockValue') => computed.reduce((s, r) => s + r[k], 0);
    return {
      kind: 'rotation',
      title: 'Rotación de inventario',
      subtitle: `Ventas del periodo (${days} días) frente al stock actual. Rotación anualizada = ventas × 365 / días del periodo / stock actual.`,
      columns: [
        { key: 'sku', label: 'SKU', type: 'code', width: 11 },
        { key: 'name', label: 'Producto', type: 'text', width: 28 },
        { key: 'category', label: 'Categoría', type: 'text', width: 15 },
        { key: 'unit', label: 'Unidad', type: 'text', width: 7 },
        { key: 'sold', label: 'Vendido', type: 'qty', width: 10 },
        { key: 'stock', label: 'Stock actual', type: 'qty', width: 10 },
        { key: 'rotation', label: 'Rotación anual', type: 'number', width: 10 },
        { key: 'daysOfInventory', label: 'Días de inventario', type: 'number', width: 11 },
        { key: 'soldCost', label: 'Costo de lo vendido', type: 'money', width: 14 },
        { key: 'stockValue', label: 'Valor del stock', type: 'money', width: 13 },
      ],
      rows: computed.slice(0, limit),
      total: computed.length,
      totals: computed.length ? { name: 'Total', soldCost: sum('soldCost'), stockValue: sum('stockValue') } : null,
      filtersApplied: [{ label: 'Periodo', value: `${fmtDate(from)} a ${fmtDate(to)}` }],
      notes: ['«Días de inventario» vacío = no hubo ventas en el periodo.'],
    };
  }

  // ---------------------------------------------------------------- Precisión del pronóstico

  private async accuracy(filters: ReportFilters, limit: number): Promise<ReportResult> {
    const [run] = await this.db.query(
      `SELECT id, version, finished_at AS "finishedAt", data_last_week::text AS "dataLastWeek", test_weeks AS "testWeeks",
              overall_wape::float AS "overallWape", baseline_wape::float AS "baselineWape"
         FROM forecast_runs WHERE is_active`,
    );
    const { forecastErrorThreshold: threshold } = await this.settings.get();
    const columns: ReportColumn[] = [
      { key: 'sku', label: 'SKU', type: 'code', width: 11 },
      { key: 'name', label: 'Producto', type: 'text', width: 28 },
      { key: 'category', label: 'Categoría', type: 'text', width: 15 },
      { key: 'method', label: 'Técnica', type: 'text', width: 20 },
      { key: 'weeks', label: 'Semanas de historia', type: 'number', width: 10 },
      { key: 'accuracy', label: 'Precisión', type: 'pct', width: 10 },
      { key: 'wape', label: 'Error (WAPE)', type: 'pct', width: 10 },
      { key: 'bias', label: 'Sesgo', type: 'pct', width: 9 },
      { key: 'baselineWape', label: 'Error promedio móvil', type: 'pct', width: 11 },
      { key: 'beatsBaseline', label: 'Mejor que el promedio móvil', type: 'bool', width: 11 },
      { key: 'flagged', label: 'Para revisar', type: 'bool', width: 9 },
    ];
    const applied = [{ label: 'Umbral para revisar', value: `error mayor a ${fmtPct(threshold)}` }];
    if (filters.onlyFlagged) applied.push({ label: 'Mostrar', value: 'solo productos para revisar' });
    if (!run) {
      return {
        kind: 'accuracy',
        title: 'Precisión del pronóstico',
        subtitle: 'Todavía no hay un pronóstico activo.',
        columns,
        rows: [],
        total: 0,
        totals: null,
        filtersApplied: applied,
        notes: ['Entrena el modelo en Pronóstico › Modelos para generar este reporte.'],
      };
    }
    const rows = await this.db.query(
      `SELECT p.sku, p.name, c.name AS category, m.method, m.weeks_of_history AS weeks,
              m.test_wape::float AS wape, m.test_bias::float AS bias, m.baseline_wape::float AS "baselineWape",
              m.beats_baseline AS "beatsBaseline", (m.test_wape IS NOT NULL AND m.test_wape > $2) AS flagged,
              count(*) OVER()::int AS total
         FROM forecast_product_models m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE m.run_id = $1 AND ($3::uuid IS NULL OR p.category_id = $3)
          AND (NOT $4::boolean OR m.test_wape > $2)
        ORDER BY m.test_wape DESC NULLS LAST, p.sku
        LIMIT $5`,
      [run.id, threshold, filters.categoryId ?? null, Boolean(filters.onlyFlagged), limit],
    );
    return {
      kind: 'accuracy',
      title: 'Precisión del pronóstico',
      subtitle: `Versión ${run.version} del modelo, datos hasta la semana del ${fmtDate(run.dataLastWeek)}. Error medido en las últimas ${run.testWeeks} semanas, pronosticando de 1 a 4 semanas antes. Precisión = 100 % − error.`,
      columns,
      rows: rows.map(({ total: _t, ...r }: ReportRow) => ({
        ...r,
        method: METHOD_LABELS[r.method as string] ?? (r.method === 'COMBO' ? 'Combinación de técnicas' : r.method),
        accuracy: typeof r.wape === 'number' ? Math.max(0, 1 - r.wape) : null,
      })),
      total: rows[0]?.total ?? 0,
      totals:
        run.overallWape !== null
          ? { name: 'General', accuracy: Math.max(0, 1 - run.overallWape), wape: run.overallWape, baselineWape: run.baselineWape }
          : null,
      filtersApplied: applied,
      notes: [],
    };
  }
}

function strip(row: ReportRow, hidden: ReportColumn[]): ReportRow {
  const out = { ...row };
  for (const c of hidden) delete out[c.key];
  return out;
}
