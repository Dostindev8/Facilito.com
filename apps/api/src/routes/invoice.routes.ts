import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleCode } from '@facilito/domain';
import { AppError } from '../http/errors.js';
import { requireAuth, requireRole, ROLES_SELL, ROLES_VOID } from '../http/auth-guard.js';
import { uuidParam } from '../http/validators.js';
import { sendFile } from '../http/files.js';
import * as invoices from '../services/invoice.service.js';
import { renderInvoicePdf, renderReportPdf } from '../services/invoice-pdf.js';
import { emailProviderConfigured, MailDeliveryError, sendInvoiceEmail } from '../services/mailer.js';
import { emailField } from '../services/auth.service.js';
import { getEnv } from '../config/env.js';

const ROLES_REPORTS: readonly RoleCode[] = ['owner', 'manager', 'accountant'];

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/invoices', async (req) => invoices.listInvoices((await requireAuth(req)).tenantId, req.query));

  app.post('/v1/invoices', async (req, reply) => {
    const a = await requireRole(req, ROLES_SELL);
    const result = await invoices.createInvoice(a.tenantId, a.sub, a.rol, req.body);
    reply.status(result.duplicate ? 200 : 201);
    return result;
  });

  app.get('/v1/invoices/:id', async (req) => {
    const a = await requireAuth(req);
    return { ...(await invoices.getInvoice(a.tenantId, uuidParam.parse(req.params).id)), emailDisponible: emailProviderConfigured() };
  });

  app.post('/v1/invoices/:id/void', async (req) => {
    const a = await requireRole(req, ROLES_VOID);
    return invoices.voidInvoice(a.tenantId, a.sub, uuidParam.parse(req.params).id, req.body);
  });

  app.post('/v1/invoices/:id/pay', async (req) => {
    const a = await requireRole(req, ROLES_SELL);
    return invoices.markPaid(a.tenantId, a.sub, uuidParam.parse(req.params).id, req.body);
  });

  app.get('/v1/invoices/:id/pdf', async (req, reply) => {
    const a = await requireAuth(req);
    const pdf = await renderInvoicePdf(a.tenantId, uuidParam.parse(req.params).id);
    const { download } = z.object({ download: z.enum(['0', '1']).default('0') }).parse(req.query ?? {});
    return sendFile(reply, pdf.bytes, 'application/pdf', pdf.filename, download === '1' ? 'attachment' : 'inline');
  });

  app.post('/v1/invoices/:id/whatsapp', async (req) => {
    const a = await requireRole(req, ROLES_SELL);
    return invoices.whatsappLink(a.tenantId, uuidParam.parse(req.params).id, req.body);
  });

  app.post('/v1/invoices/:id/email', { config: { rateLimit: { max: 10, timeWindow: getEnv().RATE_LIMIT_WINDOW_MS } } }, async (req) => {
    const a = await requireRole(req, ROLES_SELL);
    if (!emailProviderConfigured()) {
      throw new AppError(
        503,
        'Correo no disponible',
        'El envío por correo no está activo todavía. Descarga el PDF o envíalo por WhatsApp.',
        'email_provider_not_configured',
      );
    }
    const id = uuidParam.parse(req.params).id;
    const { email } = z.object({ email: emailField }).strict().parse(req.body ?? {});
    const inv = await invoices.getInvoice(a.tenantId, id);
    if (inv.estado === 'anulada') throw new AppError(409, 'Factura anulada', 'Una factura anulada no se envía al cliente.', 'invoice_voided');
    const [pdf, negocio] = await Promise.all([renderInvoicePdf(a.tenantId, id), invoices.businessName(a.tenantId)]);
    const total = `RD$ ${Number(inv.total).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    try {
      await sendInvoiceEmail(email, negocio, inv.numeroLabel, total, pdf);
    } catch (err) {
      if (!(err instanceof MailDeliveryError)) throw err;
      throw new AppError(502, 'No se pudo enviar', 'El servidor de correo no respondió. Intenta de nuevo en unos minutos.', 'email_delivery_failed');
    }
    return { enviado: true, email };
  });

  app.get('/v1/reports/invoices', async (req, reply) => {
    const a = await requireRole(req, ROLES_REPORTS);
    const { format } = z.object({ format: z.enum(['json', 'csv', 'pdf']).default('json') }).passthrough().parse(req.query ?? {});
    if (format === 'pdf') {
      const pdf = await renderReportPdf(a.tenantId, req.query);
      return sendFile(reply, pdf.bytes, 'application/pdf', pdf.filename);
    }
    const report = await invoices.invoiceReport(a.tenantId, req.query);
    if (format === 'csv') {
      return sendFile(reply, invoices.invoiceReportCsv(report), 'text/csv; charset=utf-8', `reporte-facturacion-${report.desde}-${report.hasta}.csv`);
    }
    const { negocio: _negocio, ...rest } = report;
    return rest;
  });
}
