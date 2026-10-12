import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { parseDate, parseDecimal, readCsv, todayInBogota } from '../common/csv';
import { WarehousesService } from '../inventory/warehouses.service';

export const SALES_CSV = {
  columns: {
    fecha: ['date', 'dia', 'fecha_venta'],
    sku: ['codigo', 'referencia'],
    cantidad: ['quantity', 'unidades', 'cantidad_vendida', 'qty'],
    bodega: ['warehouse', 'sucursal', 'tienda'],
    precio: ['price', 'precio_unitario', 'valor_unitario'],
  },
  required: ['fecha', 'sku', 'cantidad'],
  maxRows: 1_000_000,
};

const BATCH = 5000;
const MAX_ERRORS_RETURNED = 500;
/** Un hueco es una racha de al menos 7 días seguidos sin ninguna venta en el archivo. */
const GAP_MIN_DAYS = 7;
/** Igual que en el flujo de datos del modelo (HU-18). */
const MIN_WEEKS_FOR_FORECAST = 12;

export interface ImportError {
  line: number;
  sku: string;
  message: string;
}

export interface QualityReport {
  dateFrom: string | null;
  dateTo: string | null;
  daysCovered: number;
  daysWithoutSales: number;
  gaps: { from: string; to: string; days: number }[];
  negativeQuantities: number;
  zeroQuantities: number;
  futureDates: number;
  invalidDates: number;
  invalidQuantities: number;
  unknownSkus: { count: number; rows: number; sample: string[] };
  mergedRows: number;
  products: number;
  productsWithShortHistory: number;
}

/**
 * HU-13: carga del historial de ventas. Se guarda como ventas diarias por producto y bodega;
 * reimportar el mismo archivo actualiza en lugar de duplicar (T-13.2).
 * Estas ventas son historia: no mueven el stock actual.
 */
@Injectable()
export class SalesImportService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
  ) {}

  async import(file: { buffer: Buffer; originalname: string } | undefined, actor: AuthUser) {
    const started = Date.now();
    const csv = readCsv(file?.buffer, SALES_CSV);
    const today = todayInBogota();

    const products = new Map<string, string>(
      (await this.db.query(`SELECT sku, id FROM products`)).map((p: { sku: string; id: string }) => [p.sku, p.id]),
    );
    const warehouseRows: { id: string; code: string; name: string }[] = await this.db.query(
      `SELECT id, code, lower(name) AS name FROM warehouses`,
    );
    const defaultWarehouse = await this.warehouses.getDefault();
    const findWarehouse = (raw: string) => {
      if (!raw) return defaultWarehouse.id;
      const v = raw.trim();
      return (
        warehouseRows.find((w) => w.code === v.toUpperCase())?.id ??
        warehouseRows.find((w) => w.name === v.toLowerCase())?.id ??
        null
      );
    };

    const errors: ImportError[] = [];
    let errorCount = 0;
    const fail = (line: number, sku: string, message: string) => {
      errorCount++;
      if (errors.length < MAX_ERRORS_RETURNED) errors.push({ line, sku, message });
    };
    const quality: QualityReport = {
      dateFrom: null,
      dateTo: null,
      daysCovered: 0,
      daysWithoutSales: 0,
      gaps: [],
      negativeQuantities: 0,
      zeroQuantities: 0,
      futureDates: 0,
      invalidDates: 0,
      invalidQuantities: 0,
      unknownSkus: { count: 0, rows: 0, sample: [] },
      mergedRows: 0,
      products: 0,
      productsWithShortHistory: 0,
    };
    const unknown = new Set<string>();

    // Ventas del mismo producto, bodega y día dentro del archivo se suman en una sola fila.
    const daily = new Map<string, { productId: string; warehouseId: string; date: string; quantity: number; price: number | null }>();
    for (const { line, values } of csv.rows) {
      const sku = values.sku.trim().toUpperCase();
      const date = parseDate(values.fecha);
      if (!date) {
        quality.invalidDates++;
        fail(line, sku, `La fecha "${values.fecha}" no es válida. Usa AAAA-MM-DD o DD/MM/AAAA.`);
        continue;
      }
      if (date > today) {
        quality.futureDates++;
        fail(line, sku, `La fecha ${date} está en el futuro.`);
        continue;
      }
      const quantity = parseDecimal(values.cantidad);
      if (quantity === null || Number.isNaN(quantity)) {
        quality.invalidQuantities++;
        fail(line, sku, `La cantidad "${values.cantidad}" no es un número.`);
        continue;
      }
      if (quantity < 0) {
        quality.negativeQuantities++;
        fail(line, sku, 'La cantidad es negativa. Las devoluciones no se cargan como ventas.');
        continue;
      }
      if (quantity === 0) {
        quality.zeroQuantities++;
        fail(line, sku, 'La cantidad es 0; no hay venta que registrar.');
        continue;
      }
      const productId = products.get(sku);
      if (!productId) {
        quality.unknownSkus.rows++;
        unknown.add(sku);
        fail(line, sku, `El SKU ${sku || '(vacío)'} no existe en el catálogo.`);
        continue;
      }
      const warehouseId = findWarehouse(values.bodega ?? '');
      if (!warehouseId) {
        fail(line, sku, `La bodega "${values.bodega}" no existe. Usa su código o su nombre.`);
        continue;
      }
      let price: number | null = null;
      if (values.precio) {
        price = parseDecimal(values.precio);
        if (price === null || Number.isNaN(price) || price < 0) {
          fail(line, sku, `El precio "${values.precio}" no es válido.`);
          continue;
        }
      }
      const key = `${productId}|${warehouseId}|${date}`;
      const existing = daily.get(key);
      if (existing) {
        quality.mergedRows++;
        existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000;
        if (price !== null) existing.price = price;
      } else {
        daily.set(key, { productId, warehouseId, date, quantity, price });
      }
    }

    quality.unknownSkus.count = unknown.size;
    quality.unknownSkus.sample = [...unknown].slice(0, 20);
    Object.assign(quality, analyzeCoverage([...daily.values()]));

    const rows = [...daily.values()];
    let inserted = 0;
    let updated = 0;
    const importId = await this.db.transaction(async (m) => {
      const [record] = await m.query(
        `INSERT INTO sales_imports (file_name, rows_total, rows_imported, rows_failed, quality, duration_ms, created_by)
         VALUES ($1, $2, 0, $3, $4, 0, $5) RETURNING id`,
        [file?.originalname?.slice(0, 200) || 'ventas.csv', csv.rows.length, errorCount, quality, actor.id],
      );
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const result: { inserted: boolean }[] = await m.query(
          `INSERT INTO sales (product_id, warehouse_id, sold_on, quantity, unit_price, source, import_id)
           SELECT t.product_id, t.warehouse_id, t.sold_on, t.quantity, t.unit_price, 'IMPORT', $6
             FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::numeric[], $5::numeric[])
                  AS t(product_id, warehouse_id, sold_on, quantity, unit_price)
           ON CONFLICT (product_id, warehouse_id, sold_on) WHERE source = 'IMPORT'
           DO UPDATE SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, import_id = EXCLUDED.import_id
             WHERE sales.quantity IS DISTINCT FROM EXCLUDED.quantity
                OR sales.unit_price IS DISTINCT FROM EXCLUDED.unit_price
           RETURNING (xmax = 0) AS inserted`,
          [
            chunk.map((r) => r.productId),
            chunk.map((r) => r.warehouseId),
            chunk.map((r) => r.date),
            chunk.map((r) => r.quantity),
            chunk.map((r) => r.price),
            record.id,
          ],
        );
        for (const r of result) {
          if (r.inserted) inserted++;
          else updated++;
        }
      }
      return record.id as string;
    });

    const durationMs = Date.now() - started;
    const summary = {
      importId,
      fileName: file?.originalname ?? 'ventas.csv',
      rowsTotal: csv.rows.length,
      salesDays: rows.length,
      created: inserted,
      updated,
      unchanged: rows.length - inserted - updated,
      failed: errorCount,
      errors,
      errorsTruncated: errorCount > errors.length,
      quality,
      durationMs,
    };
    await this.db.query(
      `UPDATE sales_imports SET rows_imported = $2, duration_ms = $3 WHERE id = $1`,
      [importId, inserted + updated, durationMs],
    );
    await this.audit.record({
      actor,
      action: 'sales.imported',
      entityType: 'sales_import',
      entityId: importId,
      changes: {
        file: summary.fileName,
        rows: summary.rowsTotal,
        created: inserted,
        updated,
        unchanged: summary.unchanged,
        failed: errorCount,
      },
    });
    return summary;
  }

  listImports(page: number, limit: number) {
    return this.db.query(
      `SELECT i.id, i.file_name AS "fileName", i.rows_total AS "rowsTotal", i.rows_imported AS "rowsImported",
              i.rows_failed AS "rowsFailed", i.duration_ms AS "durationMs", i.created_at AS "createdAt",
              i.quality, u.full_name AS "createdBy"
         FROM sales_imports i LEFT JOIN users u ON u.id = i.created_by
        ORDER BY i.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    );
  }

  async getImport(id: string) {
    const [row] = await this.db.query(
      `SELECT i.id, i.file_name AS "fileName", i.rows_total AS "rowsTotal", i.rows_imported AS "rowsImported",
              i.rows_failed AS "rowsFailed", i.duration_ms AS "durationMs", i.created_at AS "createdAt",
              i.quality, u.full_name AS "createdBy"
         FROM sales_imports i LEFT JOIN users u ON u.id = i.created_by WHERE i.id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Importación no encontrada.');
    return row;
  }

  /** Resumen del historial cargado (para la pantalla de ventas). */
  async overview() {
    const [totals] = await this.db.query(
      `SELECT count(*)::int AS rows, COALESCE(sum(quantity), 0)::float AS units,
              min(sold_on)::text AS "dateFrom", max(sold_on)::text AS "dateTo",
              count(DISTINCT product_id)::int AS products,
              count(*) FILTER (WHERE source = 'API')::int AS "apiSales",
              count(*) FILTER (WHERE source = 'IMPORT')::int AS "importedDays"
         FROM sales`,
    );
    const monthly = await this.db.query(
      `SELECT to_char(date_trunc('month', sold_on), 'YYYY-MM') AS month, sum(quantity)::float AS units
         FROM sales
        WHERE sold_on >= (date_trunc('month', CURRENT_DATE) - interval '23 months')
        GROUP BY 1 ORDER BY 1`,
    );
    return { ...totals, monthly };
  }
}

/** Calcula rango de fechas, días sin ventas, huecos largos y productos con poca historia. */
export function analyzeCoverage(rows: { productId: string; date: string }[]) {
  if (rows.length === 0) {
    return { dateFrom: null, dateTo: null, daysCovered: 0, daysWithoutSales: 0, gaps: [], products: 0, productsWithShortHistory: 0 };
  }
  const days = new Set(rows.map((r) => r.date));
  const sorted = [...days].sort();
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  const dayMs = 86_400_000;
  const span = Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;

  const gaps: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const missing = Math.round((Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / dayMs) - 1;
    if (missing >= GAP_MIN_DAYS) {
      gaps.push({
        from: new Date(Date.parse(sorted[i - 1]) + dayMs).toISOString().slice(0, 10),
        to: new Date(Date.parse(sorted[i]) - dayMs).toISOString().slice(0, 10),
        days: missing,
      });
    }
  }
  gaps.sort((a, b) => b.days - a.days);

  // Semanas distintas con venta por producto (lunes como inicio de semana).
  const weeks = new Map<string, Set<number>>();
  for (const r of rows) {
    const t = Date.parse(r.date) / dayMs;
    const monday = Math.floor((t + 3) / 7); // 1970-01-01 fue jueves
    const set = weeks.get(r.productId) ?? new Set<number>();
    set.add(monday);
    weeks.set(r.productId, set);
  }
  let short = 0;
  for (const set of weeks.values()) {
    const list = [...set];
    const spanWeeks = Math.max(...list) - Math.min(...list) + 1;
    if (spanWeeks < MIN_WEEKS_FOR_FORECAST) short++;
  }
  return {
    dateFrom: from,
    dateTo: to,
    daysCovered: days.size,
    daysWithoutSales: span - days.size,
    gaps: gaps.slice(0, 10),
    products: weeks.size,
    productsWithShortHistory: short,
  };
}
