import PDFDocument from 'pdfkit';
import { fmtDateTime, formatCell, ReportColumn, ReportMeta, ReportResult } from './report-types';

const GREEN = '#24473b';
const MINT = '#7cc3b1';
const MINT_SOFT = '#eef6f3';
const INK = '#1f2b26';
const MUTED = '#5b6b64';
const LINE = '#e2ddd1';

const ROW_H = 15;
const HEAD_H = 26;
const NUMERIC = new Set<ReportColumn['type']>(['qty', 'money', 'pct', 'number']);

/**
 * T-28.2: PDF horizontal tamaño carta. Encabezado con fecha, autor y filtros; la fila de
 * títulos se repite en cada página y el pie dice «Página X de Y».
 */
export function renderReportPdf(report: ReportResult, meta: ReportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 40, left: 36, right: 36 },
      bufferPages: true,
      info: { Title: `StockSense · ${report.title}`, Author: meta.generatedBy.fullName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const totalWidth = report.columns.reduce((s, c) => s + c.width, 0);
    const widths = report.columns.map((c) => (c.width / totalWidth) * width);
    const generated = `Generado el ${fmtDateTime(meta.generatedAt)} por ${meta.generatedBy.fullName} (${meta.generatedBy.email})`;

    // Encabezado de la primera página
    doc.rect(0, 0, doc.page.width, 5).fill(MINT);
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(17).text(report.title, left, 24, { width });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
    doc.text(report.subtitle, { width });
    doc.text(generated, { width });
    doc.text(
      report.filtersApplied.length
        ? `Filtros: ${report.filtersApplied.map((f) => `${f.label}: ${f.value}`).join(' · ')}`
        : 'Filtros: ninguno (todo el inventario)',
      { width },
    );
    for (const note of report.notes) doc.text(note, { width });
    doc.text(`${report.rows.length.toLocaleString('es-CO')} filas`, { width });
    let y = doc.y + 8;

    const header = () => {
      doc.rect(left, y, width, HEAD_H).fill(GREEN);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
      let x = left;
      report.columns.forEach((c, i) => {
        doc.text(c.label, x + 4, y + 4, {
          width: widths[i] - 8,
          height: HEAD_H - 6,
          align: NUMERIC.has(c.type) ? 'right' : 'left',
          ellipsis: true,
        });
        x += widths[i];
      });
      y += HEAD_H;
      doc.font('Helvetica').fontSize(7.5);
    };

    const row = (values: Record<string, unknown>, opts: { zebra?: boolean; bold?: boolean } = {}) => {
      if (y + ROW_H > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        header();
      }
      if (opts.zebra) doc.rect(left, y, width, ROW_H).fill(MINT_SOFT);
      if (opts.bold) {
        doc.rect(left, y, width, ROW_H).fill('#dcefe8');
        doc.font('Helvetica-Bold');
      }
      doc.fillColor(INK);
      let x = left;
      report.columns.forEach((c, i) => {
        const value = values[c.key] as string | number | boolean | null | undefined;
        const text = value === undefined ? '' : formatCell(value ?? null, c.type);
        doc.font(c.type === 'code' && !opts.bold ? 'Courier' : opts.bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(text, x + 4, y + 4, {
          width: widths[i] - 8,
          height: ROW_H - 4,
          align: NUMERIC.has(c.type) ? 'right' : 'left',
          ellipsis: true,
          lineBreak: false,
        });
        x += widths[i];
      });
      doc.font('Helvetica');
      y += ROW_H;
    };

    header();
    if (!report.rows.length) {
      doc.fillColor(MUTED).fontSize(9).text('No hay datos con estos filtros.', left, y + 10, { width });
    }
    report.rows.forEach((r, i) => row(r, { zebra: i % 2 === 1 }));
    if (report.totals) row(report.totals, { bold: true });
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor(LINE).lineWidth(0.5).stroke();

    // Pie de página en todas las páginas
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Escribir dentro del margen inferior sin que pdfkit cree otra página.
      doc.page.margins.bottom = 0;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
      const footY = doc.page.height - 28;
      doc.text(`StockSense · ${report.title} · ${generated}`, left, footY, { width: width - 90, lineBreak: false, ellipsis: true, height: 10 });
      doc.text(`Página ${i + 1} de ${range.count}`, left + width - 90, footY, { width: 90, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
