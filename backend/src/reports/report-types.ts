/** HU-28: tipos compartidos por la consulta, la vista previa y los archivos (Excel y PDF). */

export const REPORT_KINDS = ['stock', 'movements', 'rotation', 'accuracy'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type ColumnType = 'text' | 'code' | 'qty' | 'money' | 'pct' | 'number' | 'datetime' | 'bool';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Ancho relativo en el PDF y aproximado en caracteres en Excel. */
  width: number;
}

export type ReportRow = Record<string, string | number | boolean | null>;

export interface ReportFilters {
  warehouseId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  type?: string;
  onlyFlagged?: boolean;
}

export interface ReportResult {
  kind: ReportKind;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  /** Fila de totales (solo columnas numéricas que tiene sentido sumar). */
  totals: ReportRow | null;
  /** Filtros aplicados en palabras, para el encabezado del archivo. */
  filtersApplied: { label: string; value: string }[];
  /** Avisos, por ejemplo columnas ocultas por permisos o que el archivo se recortó. */
  notes: string[];
}

export interface ReportMeta {
  generatedAt: Date;
  generatedBy: { fullName: string; email: string };
}

const BOGOTA = 'America/Bogota';

export const fmtQty = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
export const fmtMoney = (n: number) => `$ ${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
export const fmtPct = (n: number) => `${(n * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
export const fmtDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: BOGOTA }).format(new Date(value));
export const fmtDate = (value: string) =>
  new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: BOGOTA }).format(new Date(`${value.slice(0, 10)}T12:00:00-05:00`));

/** Texto de una celda tal como se ve en el PDF y en la vista previa. */
export function formatCell(value: ReportRow[string], type: ColumnType): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'qty':
    case 'number':
      return typeof value === 'number' ? fmtQty(value) : String(value);
    case 'money':
      return typeof value === 'number' ? fmtMoney(value) : String(value);
    case 'pct':
      return typeof value === 'number' ? fmtPct(value) : String(value);
    case 'datetime':
      return fmtDateTime(String(value));
    case 'bool':
      return value ? 'Sí' : 'No';
    default:
      return String(value);
  }
}

export function fileName(kind: ReportKind, format: ReportFormat, at: Date): string {
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: BOGOTA, dateStyle: 'short', timeStyle: 'short' })
    .format(at)
    .replace(' ', '_')
    .replace(':', '');
  const names: Record<ReportKind, string> = {
    stock: 'stock-valorizado',
    movements: 'movimientos',
    rotation: 'rotacion',
    accuracy: 'precision-pronostico',
  };
  return `stocksense_${names[kind]}_${stamp}.${format}`;
}
