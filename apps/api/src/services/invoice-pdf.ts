import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { withTenant } from '../db/client.js';
import { getInvoice, invoiceReport } from './invoice.service.js';
import { formatRnc, loadBusiness, NCF_TIPOS } from './settings.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.resolve(__dirname, '../../assets/facilito-mark.png');

const GREEN = '#0E8A5F';
const ORANGE = '#F5871F';
const INK = '#1B2838';
const MUTED = '#6B7785';
const LINE = '#E3E8EE';

const money = (v: string) =>
  `RD$ ${Number(v).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) =>
  new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'PENDIENTE',
  pagada: 'PAGADA',
  anulada: 'ANULADA',
  vencida: 'VENCIDA',
};
const METODO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
};

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, negocio: Awaited<ReturnType<typeof loadBusiness>>, title: string, subtitle: string[]) {
  if (existsSync(LOGO)) doc.image(LOGO, 48, 40, { fit: [52, 52] });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(negocio.nombreComercial, 110, 42, { width: 250 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  const lines = [
    negocio.razonSocial !== negocio.nombreComercial ? negocio.razonSocial : null,
    negocio.rnc ? `RNC: ${formatRnc(negocio.rnc)}` : null,
    negocio.direccion ?? negocio.ubicacion,
    [negocio.telefono, negocio.email].filter(Boolean).join(' · ') || null,
  ].filter(Boolean) as string[];
  doc.text(lines.join('\n'), 110, 62, { width: 250 });

  doc.font('Helvetica-Bold').fontSize(18).fillColor(GREEN).text(title, 330, 40, { width: 217, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(subtitle.join('\n'), 330, 64, { width: 217, align: 'right' });
  doc.moveTo(48, 122).lineTo(547, 122).lineWidth(2).strokeColor(GREEN).stroke();
}

export async function renderInvoicePdf(tenantId: string, id: string): Promise<{ bytes: Buffer; filename: string }> {
  const inv = await getInvoice(tenantId, id);
  const negocio = await withTenant(tenantId, (q) => loadBusiness(q, tenantId));
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Factura ${inv.numeroLabel}`, Author: negocio.nombreComercial, Producer: 'Facilito by Logic Code Spot' } });

  const sub = [
    inv.numeroLabel,
    inv.ncf ? `NCF: ${inv.ncf}` : 'Sin comprobante fiscal',
    inv.ncfTipo ? (NCF_TIPOS[inv.ncfTipo] ?? inv.ncfTipo) : '',
    `Emisión: ${fecha(inv.fechaEmision)}`,
    inv.fechaVencimiento ? `Vence: ${inv.fechaVencimiento}` : '',
  ].filter(Boolean);
  header(doc, negocio, 'FACTURA', sub);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('CLIENTE', 48, 136);
  doc.font('Helvetica').fontSize(11).fillColor(INK).text(inv.clienteNombre, 48, 149, { width: 300 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('PAGO', 360, 136, { width: 187, align: 'right' });
  doc.font('Helvetica').fontSize(11).fillColor(INK).text(METODO_LABEL[inv.metodoPago] ?? inv.metodoPago, 360, 149, { width: 187, align: 'right' });

  const cols = { desc: 48, qty: 290, price: 340, disc: 405, itbis: 455, total: 497 };
  let y = 184;
  doc.rect(48, y, 499, 20).fill('#F4FBFA');
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5);
  doc.text('DESCRIPCIÓN', cols.desc + 6, y + 6);
  doc.text('CANT.', cols.qty, y + 6, { width: 45, align: 'right' });
  doc.text('PRECIO', cols.price, y + 6, { width: 60, align: 'right' });
  doc.text('DESC.', cols.disc, y + 6, { width: 45, align: 'right' });
  doc.text('ITBIS', cols.itbis, y + 6, { width: 40, align: 'right' });
  doc.text('TOTAL', cols.total, y + 6, { width: 50, align: 'right' });
  y += 26;

  doc.font('Helvetica').fontSize(8.5);
  for (const l of inv.lineas) {
    const h = Math.max(doc.heightOfString(l.descripcion, { width: 236 }), 11);
    if (y + h > 640) {
      doc.addPage();
      y = 60;
    }
    doc.fillColor(INK).text(l.descripcion, cols.desc + 6, y, { width: 236 });
    if (l.sku) doc.fillColor(MUTED).fontSize(7).text(l.sku, cols.desc + 6, y + h, { width: 236 }).fontSize(8.5);
    doc.fillColor(INK);
    doc.text(`${l.cantidad}`, cols.qty, y, { width: 45, align: 'right' });
    doc.text(Number(l.precioUnitario).toFixed(2), cols.price, y, { width: 60, align: 'right' });
    doc.text(Number(l.descuento).toFixed(2), cols.disc, y, { width: 45, align: 'right' });
    doc.text(Number(l.itbis).toFixed(2), cols.itbis, y, { width: 40, align: 'right' });
    doc.text(Number(l.total).toFixed(2), cols.total, y, { width: 50, align: 'right' });
    y += h + (l.sku ? 14 : 8);
    doc.moveTo(48, y - 4).lineTo(547, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  if (y > 600) {
    doc.addPage();
    y = 60;
  }
  y += 8;
  const totalsTop = y;
  const row = (label: string, value: string, bold = false, color = INK) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9.5).fillColor(color);
    doc.text(label, 330, y, { width: 110, align: 'right' });
    doc.text(value, 440, y, { width: 107, align: 'right' });
    y += bold ? 20 : 15;
  };
  row('Subtotal', money(inv.subtotal));
  if (Number(inv.descuentoTotal) > 0) row('Descuentos', `- ${money(inv.descuentoTotal)}`);
  row(`ITBIS (${inv.itbisModo === 'linea' ? 'por línea' : 'global'})`, money(inv.itbisTotal));
  doc.moveTo(330, y).lineTo(547, y).lineWidth(1).strokeColor(GREEN).stroke();
  y += 6;
  row('TOTAL', money(inv.total), true, GREEN);

  const byRate = new Map<string, { base: number; itbis: number }>();
  for (const l of inv.lineas) {
    const k = `${(Number(l.itbisTasa) * 100).toFixed(0)}%`;
    const cur = byRate.get(k) ?? { base: 0, itbis: 0 };
    cur.base += Number(l.subtotal);
    cur.itbis += Number(l.itbis);
    byRate.set(k, cur);
  }
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('DESGLOSE DE ITBIS', 48, totalsTop);
  let by = totalsTop + 14;
  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  for (const [rate, v] of byRate) {
    doc.text(`Tasa ${rate}: base ${money(v.base.toFixed(2))} · ITBIS ${money(v.itbis.toFixed(2))}`, 48, by, { width: 270 });
    by += 13;
  }

  if (inv.estado !== 'pagada') {
    const color = inv.estado === 'anulada' ? '#C0392B' : ORANGE;
    doc.save().rotate(-20, { origin: [300, 400] }).fontSize(64).font('Helvetica-Bold').fillColor(color).opacity(0.12).text(ESTADO_LABEL[inv.estado] ?? '', 90, 380, { width: 420, align: 'center' }).restore();
    doc.opacity(1);
  }
  if (inv.estado === 'anulada' && inv.motivoAnulacion) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#C0392B').text(`ANULADA: ${inv.motivoAnulacion}`, 48, Math.max(y, by) + 10, { width: 499 });
  }
  if (inv.notas) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`Notas: ${inv.notas}`, 48, Math.max(y, by) + 28, { width: 499 });
  }

  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
    'Documento generado por Facilito by Logic Code Spot · Santo Domingo, República Dominicana',
    48,
    730,
    { width: 499, align: 'center' },
  );
  // TODO: VERIFICAR EN VIVO — campos obligatorios de representación impresa DGII (e-CF/QR, código de seguridad).

  return { bytes: await toBuffer(doc), filename: `${inv.numeroLabel}.pdf` };
}

export async function renderReportPdf(tenantId: string, query: unknown): Promise<{ bytes: Buffer; filename: string }> {
  const rep = await invoiceReport(tenantId, query);
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, layout: 'portrait', info: { Title: `Reporte de facturación ${rep.desde} a ${rep.hasta}`, Producer: 'Facilito by Logic Code Spot' } });
  header(doc, rep.negocio, 'REPORTE', ['Facturación', `${rep.desde} → ${rep.hasta}`, `Generado: ${fecha(new Date().toISOString())}`]);

  let y = 136;
  const kpi = (label: string, value: string, x: number) => {
    doc.roundedRect(x, y, 118, 44, 6).fill('#F4FBFA');
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(label, x + 8, y + 8, { width: 104 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(value, x + 8, y + 22, { width: 104 });
  };
  kpi('Facturas válidas', String(rep.resumen.facturas), 48);
  kpi('Subtotal', money(rep.resumen.subtotal), 175);
  kpi('ITBIS', money(rep.resumen.itbis), 302);
  kpi('Total', money(rep.resumen.total), 429);
  y += 60;

  const cols: Array<[string, number, number, 'left' | 'right']> = [
    ['NÚMERO', 48, 62, 'left'],
    ['NCF', 112, 80, 'left'],
    ['FECHA', 194, 70, 'left'],
    ['CLIENTE', 266, 110, 'left'],
    ['ESTADO', 378, 55, 'left'],
    ['ITBIS', 435, 50, 'right'],
    ['TOTAL', 487, 60, 'right'],
  ];
  const head = () => {
    doc.rect(48, y, 499, 18).fill('#F4FBFA');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
    for (const [t, x, w, a] of cols) doc.text(t, x + 2, y + 5, { width: w - 4, align: a });
    y += 22;
  };
  head();
  doc.font('Helvetica').fontSize(7.5);
  for (const i of rep.items) {
    if (y > 720) {
      doc.addPage();
      y = 48;
      head();
      doc.font('Helvetica').fontSize(7.5);
    }
    const vals = [
      i.numeroLabel,
      i.ncf ?? '—',
      new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short' }).format(new Date(i.fechaEmision)),
      i.clienteNombre,
      ESTADO_LABEL[i.estado] ?? i.estado,
      Number(i.itbisTotal).toFixed(2),
      Number(i.total).toFixed(2),
    ];
    doc.fillColor(i.estado === 'anulada' ? MUTED : INK);
    cols.forEach(([, x, w, a], idx) => doc.text(vals[idx]!, x + 2, y, { width: w - 4, align: a, lineBreak: false, ellipsis: true }));
    y += 14;
  }
  if (!rep.items.length) doc.fillColor(MUTED).text('No hay facturas en el rango seleccionado.', 48, y);
  return { bytes: await toBuffer(doc), filename: `reporte-facturacion-${rep.desde}-${rep.hasta}.pdf` };
}
