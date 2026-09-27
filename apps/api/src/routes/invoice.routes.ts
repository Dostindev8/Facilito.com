import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleCode } from '@facilito/domain';
import { AppError } from '../http/errors.js';
import { requireAuth, requireRole, ROLES_SELL, ROLES_VOID } from '../http/auth-guard.js';
import { uuidParam } from '../http/validators.js';
import { sendFile } from '../http/files.js';
import * as invoices from '../services/invoice.service.js';
import { renderInvoicePdf, renderReportPdf } from '../services/invoice-pdf.js';

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
    return invoices.getInvoice(a.tenantId, uuidParam.parse(req.params).id);
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

  app.post('/v1/invoices/:id/email', async (req) => {
    await requireRole(req, ROLES_SELL);
    throw new AppError(
      501,
      'Email no configurado',
      'El envío por email se habilitará cuando se configure un proveedor de correo. Descarga el PDF o envíalo por WhatsApp.',
      'email_provider_not_configured',
    );
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
