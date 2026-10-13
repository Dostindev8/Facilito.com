import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { requireRole, ROLES_ADMIN, ROLES_OWNER } from '../http/auth-guard.js';
import { sendFile } from '../http/files.js';
import * as billing from '../services/billing.service.js';

async function readReceipt(req: FastifyRequest, maxBytes: number): Promise<Buffer> {
  if (!req.isMultipart()) throw new AppError(400, 'Archivo requerido', 'Envía el comprobante como formulario (multipart).', 'upload');
  const file = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 0 } });
  if (!file) throw new AppError(400, 'Archivo requerido', 'No se recibió ningún archivo.', 'upload');
  if (!/\.(png|jpe?g|webp|pdf)$/i.test(file.filename)) {
    file.file.resume();
    throw new AppError(400, 'Tipo no permitido', 'Sube una foto (JPG, PNG o WebP) o el PDF del banco.', 'upload');
  }
  const buf = await file.toBuffer();
  if (file.file.truncated) throw new AppError(413, 'Archivo muy grande', 'El comprobante supera el tamaño permitido.', 'upload_size');
  return buf;
}

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

function cronAuthorized(req: FastifyRequest): boolean {
  const secret = getEnv().CRON_SECRET;
  const given = header(req, 'authorization') ?? '';
  if (!secret || !given.startsWith('Bearer ')) return false;
  const a = Buffer.from(given.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  const strict = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS } };

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  /* Public: no account exists before payment and authorization. */
  app.get('/v1/billing/plans', async () => billing.listPlans());

  app.post('/v1/billing/checkout', { config: strict }, async (req, reply) => {
    reply.status(201);
    return billing.startCheckout(req.body, req.ip);
  });

  app.post<{ Params: { id: string } }>('/v1/billing/checkout/:id/comprobante', { config: strict }, async (req) =>
    billing.uploadCheckoutReceipt({ id: req.params.id, token: header(req, 'x-solicitud-token') }, await readReceipt(req, env.UPLOAD_MAX_BYTES), req.ip),
  );

  app.get<{ Params: { id: string } }>('/v1/billing/checkout/:id', { config: strict }, async (req) =>
    billing.checkoutStatus({ id: req.params.id, token: header(req, 'x-solicitud-token') }),
  );

  /* Card gateway relay. The signature covers the exact bytes, so this scope keeps the body raw. */
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 65_536 }, (_req, body, done) => done(null, body));
    scope.post<{ Params: { proveedor: string } }>('/v1/billing/webhooks/:proveedor', { config: strict }, async (req) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'Payload inválido', 'Se esperaba JSON.', 'webhook_payload');
      return billing.handleWebhook(req.params.proveedor, req.body, req.headers);
    });
  });

  /* Daily renewal sweep (Vercel Cron uses GET with the bearer secret). */
  const runSweep = async (req: FastifyRequest) => {
    if (!cronAuthorized(req)) throw new AppError(404, 'No encontrado', 'La ruta solicitada no existe.', 'route_not_found');
    return billing.sweep();
  };
  app.get('/v1/billing/cron/sweep', { config: strict }, runSweep);
  app.post('/v1/billing/cron/sweep', { config: strict }, runSweep);

  /* The business's own subscription: owners and managers see it and can report a renewal payment. */
  app.get('/v1/billing/mi-suscripcion', async (req) => billing.mySubscription((await requireRole(req, ROLES_ADMIN)).tenantId));

  app.post('/v1/billing/mi-suscripcion/comprobante', { config: strict }, async (req, reply) => {
    const a = await requireRole(req, ROLES_ADMIN);
    reply.status(201);
    return billing.uploadRenewalReceipt(a.tenantId, await readReceipt(req, env.UPLOAD_MAX_BYTES));
  });

  app.post('/v1/billing/mi-suscripcion/cancelacion', async (req) => {
    const a = await requireRole(req, ROLES_OWNER);
    return billing.setCancelAtPeriodEnd(a.tenantId, a.sub, req.body, req.ip);
  });

  app.get<{ Params: { id: string } }>('/v1/billing/recibos/:id', async (req, reply) => {
    const a = await requireRole(req, ROLES_ADMIN);
    const pdf = await billing.tenantReceiptPdf(a.tenantId, req.params);
    return sendFile(reply, pdf.bytes, 'application/pdf', pdf.filename);
  });
}
