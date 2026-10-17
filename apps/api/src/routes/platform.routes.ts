import type { FastifyInstance } from 'fastify';
import { requirePlatformAdmin } from '../http/auth-guard.js';
import { sendFile } from '../http/files.js';
import * as platform from '../services/platform.service.js';
import * as billing from '../services/billing.service.js';

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/v1/platform/stats', async (req) => platform.stats((await requirePlatformAdmin(req)).sub));

  app.get('/v1/platform/users', async (req) => platform.listUsers((await requirePlatformAdmin(req)).sub, req.query));
  app.post('/v1/platform/users/:id/block', async (req) =>
    platform.blockUser((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/users/:id/unblock', async (req) => platform.unblockUser((await requirePlatformAdmin(req)).sub, req.params, req.ip));

  app.get('/v1/platform/businesses', async (req) => platform.listBusinesses((await requirePlatformAdmin(req)).sub, req.query));
  app.post('/v1/platform/businesses/:id/suspend', async (req) =>
    platform.suspendBusiness((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/businesses/:id/reactivate', async (req) =>
    platform.reactivateBusiness((await requirePlatformAdmin(req)).sub, req.params, req.ip),
  );

  app.get('/v1/platform/activity', async (req) => platform.activity((await requirePlatformAdmin(req)).sub));

  /* Subscriptions: authorization queue, lifecycle, payments. Every mutation demands an explicit confirmation. */
  app.get('/v1/platform/subscriptions', async (req) => billing.listSubscriptions((await requirePlatformAdmin(req)).sub, req.query));
  app.post('/v1/platform/subscriptions/assign', async (req) => billing.assignToExisting((await requirePlatformAdmin(req)).sub, req.body, req.ip));
  app.get('/v1/platform/subscriptions/:id', async (req) => billing.subscriptionDetail((await requirePlatformAdmin(req)).sub, req.params));
  app.post('/v1/platform/subscriptions/:id/authorize', async (req) =>
    billing.authorize((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/subscriptions/:id/reject', async (req) => billing.reject((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip));
  app.post('/v1/platform/subscriptions/:id/resend-invitation', async (req) =>
    billing.resendInvitation((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/subscriptions/:id/payments', async (req) =>
    billing.registerPayment((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/subscriptions/:id/refunds', async (req) => billing.refund((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip));
  app.post('/v1/platform/subscriptions/:id/plan', async (req) => billing.changePlan((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip));
  app.post('/v1/platform/subscriptions/:id/suspend', async (req) =>
    billing.changeState((await requirePlatformAdmin(req)).sub, 'suspender', req.params, req.body, req.ip),
  );
  app.post('/v1/platform/subscriptions/:id/reactivate', async (req) =>
    billing.changeState((await requirePlatformAdmin(req)).sub, 'reactivar', req.params, req.body, req.ip),
  );
  app.post('/v1/platform/subscriptions/:id/cancel', async (req) =>
    billing.changeState((await requirePlatformAdmin(req)).sub, 'cancelar', req.params, req.body, req.ip),
  );

  app.get('/v1/platform/receipts/:id', async (req, reply) => {
    const f = await billing.receiptFile((await requirePlatformAdmin(req)).sub, req.params);
    // Inline so the admin can look at it; CSP default-src 'none' and nosniff keep a crafted file inert.
    return sendFile(reply, f.bytes, f.mime, `comprobante.${f.mime === 'application/pdf' ? 'pdf' : 'webp'}`, 'inline');
  });
  app.post('/v1/platform/receipts/:id/reject', async (req) => billing.rejectReceipt((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip));

  app.get('/v1/platform/payments/:id/receipt', async (req, reply) => {
    const pdf = await billing.adminReceiptPdf((await requirePlatformAdmin(req)).sub, req.params);
    return sendFile(reply, pdf.bytes, 'application/pdf', pdf.filename);
  });

  app.get('/v1/platform/finance', async (req) => billing.finance((await requirePlatformAdmin(req)).sub, req.query));
  app.get('/v1/platform/health', async (req) => billing.health((await requirePlatformAdmin(req)).sub));
  app.post('/v1/platform/billing/sweep', async (req) => billing.sweepAsAdmin((await requirePlatformAdmin(req)).sub, req.ip));
  app.post('/v1/platform/billing/plans/seed', async (req) => billing.seedDefaultPlans((await requirePlatformAdmin(req)).sub, req.ip));
}
