import ExcelJS from 'exceljs';
import { fmtDateTime, ReportColumn, ReportMeta, ReportResult } from './report-types';

const GREEN = 'FF24473B';
const MINT = 'FFDCEFE8';
const MUTED = 'FF5F6660';

const NUM_FMT: Partial<Record<ReportColumn['type'], string>> = {
  qty: '#,##0.###',
  number: '#,##0.##',
  money: '"$" #,##0',
  pct: '0.0%',
  datetime: 'yyyy-mm-dd hh:mm',
};

/**
 * T-28.2: Excel con encabezado (título, fecha, quién lo generó, filtros), tabla con filtros
 * automáticos, cifras como números (no texto) para poder sumarlas y la fila de títulos fija.
 */
export async function renderReportXlsx(report: ReportResult, meta: ReportMeta): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = `StockSense · ${meta.generatedBy.fullName}`;
  book.created = meta.generatedAt;
  const sheet = book.addWorksheet(report.title.slice(0, 31), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const last = report.columns.length;
  const line = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => {
    const row = sheet.addRow([text]);
    row.getCell(1).font = { bold: opts.bold, size: opts.size ?? 10, color: { argb: opts.color ?? 'FF1F2B26' } };
    if (last > 1) sheet.mergeCells(row.number, 1, row.number, last);
    return row;
  };

  line(`StockSense · ${report.title}`, { bold: true, size: 14, color: GREEN });
  line(report.subtitle, { color: MUTED });
  line(`Generado el ${fmtDateTime(meta.generatedAt)} por ${meta.generatedBy.fullName} (${meta.generatedBy.email})`, { color: MUTED });
  line(
    report.filtersApplied.length
      ? `Filtros: ${report.filtersApplied.map((f) => `${f.label}: ${f.value}`).join(' · ')}`
      : 'Filtros: ninguno (todo el inventario)',
    { color: MUTED },
  );
  for (const note of report.notes) line(note, { color: MUTED });
  sheet.addRow([]);

  const header = sheet.addRow(report.columns.map((c) => c.label));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  header.height = 30;
  const headerRow = header.number;

  for (const r of report.rows) {
    sheet.addRow(
      report.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return null;
        if (c.type === 'datetime') return excelDate(String(v));
        if (c.type === 'bool') return v ? 'Sí' : 'No';
        return v;
      }),
    );
  }

  report.columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = Math.max(c.width, Math.min(40, c.label.length + 2));
    const fmt = NUM_FMT[c.type];
    if (fmt) col.numFmt = fmt;
  });

  if (report.totals) {
    const totals = sheet.addRow(report.columns.map((c, i) => (i === 0 ? null : (report.totals?.[c.key] ?? null))));
    if (report.totals.name !== undefined) {
      const nameIndex = report.columns.findIndex((c) => c.key === 'name');
      if (nameIndex >= 0) totals.getCell(nameIndex + 1).value = String(report.totals.name);
    }
    totals.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MINT } };
    });
  }

  if (report.rows.length) {
    sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + report.rows.length, column: last } };
  }
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];

  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * Excel no tiene zona horaria: se guarda la hora de Bogotá como fecha "local" para que se
 * vea igual que en la aplicación.
 */
function excelDate(iso: string): Date {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
  return new Date(`${local.replace(' ', 'T')}Z`);
}
