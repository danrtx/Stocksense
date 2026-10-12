import PDFDocument from 'pdfkit';
import { ORDER_STATUS_LABELS, OrderDetail } from './purchases.service';

const GREEN = '#24473b';
const MINT = '#7cc3b1';
const INK = '#1f2b26';
const MUTED = '#5b6b64';

const money = (value: number) =>
  `$ ${value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const qty = (value: number) => value.toLocaleString('es-CO', { maximumFractionDigits: 3 });
const date = (value: string | Date | null) =>
  value
    ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(
        typeof value === 'string' && value.length === 10 ? new Date(`${value}T12:00:00-05:00`) : new Date(value),
      )
    : '—';

/** T-11.3: PDF de la orden para enviarla al proveedor. Devuelve el archivo completo en memoria. */
export function renderOrderPdf(order: OrderDetail, company = 'StockSense'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Orden de compra ${order.code}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Encabezado
    doc.rect(0, 0, doc.page.width, 6).fill(MINT);
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(20).text(company, left, 34);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Predictive Inventory Management', left, 58);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('Orden de compra', left, 34, { width, align: 'right' });
    doc.font('Helvetica').fontSize(11).fillColor(GREEN).text(order.code, left, 54, { width, align: 'right' });
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(`Estado: ${ORDER_STATUS_LABELS[order.status]}`, left, 70, { width, align: 'right' });

    // Bloques de proveedor y entrega
    const top = 100;
    const half = width / 2 - 8;
    block(doc, 'Proveedor', left, top, half, [
      order.supplier.name,
      order.supplier.taxId ? `NIT ${order.supplier.taxId}` : null,
      order.supplier.contactName ? `Contacto: ${order.supplier.contactName}` : null,
      order.supplier.email,
      order.supplier.phone,
    ]);
    block(doc, 'Entregar en', left + half + 16, top, half, [
      order.warehouse.name,
      order.warehouse.address,
      `Fecha de la orden: ${date(order.sentAt ?? order.createdAt)}`,
      `Entrega esperada: ${date(order.expectedAt)}`,
    ]);

    // Tabla de líneas
    let y = top + 104;
    const cols = [
      { label: 'SKU', w: 0.16, align: 'left' as const },
      { label: 'Producto', w: 0.38, align: 'left' as const },
      { label: 'Cantidad', w: 0.13, align: 'right' as const },
      { label: 'Costo unit.', w: 0.15, align: 'right' as const },
      { label: 'Subtotal', w: 0.18, align: 'right' as const },
    ];
    const header = () => {
      doc.rect(left, y, width, 22).fill(GREEN);
      let x = left;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      for (const c of cols) {
        doc.text(c.label, x + 6, y + 7, { width: c.w * width - 12, align: c.align });
        x += c.w * width;
      }
      y += 22;
    };
    header();

    doc.font('Helvetica').fontSize(9).fillColor(INK);
    order.lines.forEach((line, i) => {
      const name = line.supplierSku ? `${line.product.name} (ref. ${line.supplierSku})` : line.product.name;
      const height = Math.max(20, doc.heightOfString(name, { width: cols[1].w * width - 12 }) + 10);
      if (y + height > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
        header();
        doc.font('Helvetica').fontSize(9).fillColor(INK);
      }
      if (i % 2 === 1) doc.rect(left, y, width, height).fill('#f5f2eb').fillColor(INK);
      const values = [
        line.product.sku,
        name,
        `${qty(line.quantity)} ${line.product.unit}`,
        money(line.unitCost ?? 0),
        money(line.subtotal ?? 0),
      ];
      let x = left;
      cols.forEach((c, idx) => {
        doc.fillColor(INK).text(values[idx], x + 6, y + 5, { width: c.w * width - 12, align: c.align });
        x += c.w * width;
      });
      y += height;
    });

    doc.moveTo(left, y + 4).lineTo(left + width, y + 4).strokeColor(MINT).lineWidth(1).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(GREEN)
      .text(`Total: ${money(order.total ?? 0)}`, left, y + 14, { width, align: 'right' });
    y += 44;

    if (order.notes) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Observaciones', left, y);
      doc.font('Helvetica').fillColor(MUTED).text(order.notes, left, y + 14, { width });
    }

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Generado por ${company} · ${order.lines.length} producto(s) · Por favor confirme la recepción de esta orden respondiendo al remitente.`,
        left,
        doc.page.height - 70,
        { width, align: 'center' },
      );
    doc.end();
  });
}

function block(doc: PDFKit.PDFDocument, title: string, x: number, y: number, w: number, lines: (string | null)[]) {
  doc.roundedRect(x, y, w, 92, 6).strokeColor('#d9d3c4').lineWidth(1).stroke();
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), x + 12, y + 10);
  doc.fillColor(INK).font('Helvetica').fontSize(10);
  let line = y + 26;
  for (const text of lines.filter(Boolean) as string[]) {
    doc.text(text, x + 12, line, { width: w - 24, ellipsis: true, lineBreak: false });
    line += 14;
  }
}
