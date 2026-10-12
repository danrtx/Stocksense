import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

/**
 * Lectura de archivos CSV que llegan desde Excel o Google Sheets.
 * - Acepta coma o punto y coma como separador (Excel en español usa punto y coma).
 * - Ignora el BOM, mayúsculas, tildes y espacios en los encabezados.
 * - Cada fila conserva su número real en el archivo (contando el encabezado como fila 1).
 */
export interface CsvRow {
  line: number;
  values: Record<string, string>;
}

export interface CsvFile {
  delimiter: ',' | ';';
  rows: CsvRow[];
}

export interface CsvSpec {
  /** Nombre canónico → encabezados aceptados (ya normalizados). */
  columns: Record<string, string[]>;
  required: string[];
  maxRows: number;
}

export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function readCsv(buffer: Buffer | undefined, spec: CsvSpec): CsvFile {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('Adjunta un archivo CSV con datos.');
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  let records: string[][];
  try {
    records = parse(text, {
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }) as string[][];
  } catch (error) {
    throw new BadRequestException(
      `No pudimos leer el archivo como CSV: ${(error as Error).message}. Guárdalo como "CSV UTF-8" e inténtalo de nuevo.`,
    );
  }
  if (records.length < 2) {
    throw new BadRequestException('El archivo no tiene filas de datos debajo del encabezado.');
  }

  const header = records[0].map(normalizeHeader);
  const index: Record<string, number> = {};
  for (const [canonical, aliases] of Object.entries(spec.columns)) {
    const position = header.findIndex((h) => h === canonical || aliases.includes(h));
    if (position >= 0) index[canonical] = position;
  }
  const missing = spec.required.filter((c) => index[c] === undefined);
  if (missing.length > 0) {
    throw new BadRequestException(
      `Faltan columnas obligatorias: ${missing.join(', ')}. Descarga la plantilla para ver el formato.`,
    );
  }
  if (records.length - 1 > spec.maxRows) {
    throw new BadRequestException(
      `El archivo tiene ${records.length - 1} filas y el máximo por carga es ${spec.maxRows}. Divídelo en varios archivos.`,
    );
  }

  // csv-parse no expone el número de línea con skip_empty_lines; contamos filas de datos.
  const rows: CsvRow[] = records.slice(1).map((record, i) => {
    const values: Record<string, string> = {};
    for (const [canonical, position] of Object.entries(index)) {
      values[canonical] = (record[position] ?? '').trim();
    }
    return { line: i + 2, values };
  });
  return { delimiter, rows };
}

/**
 * Convierte "25900", "25900.5", "25900,5" o "25.900,50" en número.
 * Si el texto trae punto y coma, el último símbolo es el separador decimal.
 */
export function parseDecimal(raw: string): number | null {
  const value = raw.replace(/\s|\$/g, '');
  if (value === '') return null;
  let normalized = value;
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? value.replace(/\./g, '').replace(',', '.')
        : value.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = (value.match(/,/g)?.length ?? 0) > 1 ? value.replace(/,/g, '') : value.replace(',', '.');
  } else if ((value.match(/\./g)?.length ?? 0) > 1) {
    normalized = value.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** Acepta 2026-03-15, 15/03/2026 o 15-03-2026. Devuelve AAAA-MM-DD o null si no es una fecha real. */
export function parseDate(raw: string): string | null {
  const value = raw.trim();
  let y: number, m: number, d: number;
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Fecha de hoy en Colombia (AAAA-MM-DD), para no aceptar fechas futuras por la diferencia horaria. */
export function todayInBogota(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
}

/** Escapa un valor para escribirlo en un CSV separado por comas. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
