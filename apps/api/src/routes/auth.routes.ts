import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { requireAuth } from '../http/auth-guard.js';
import { assertCsrfHeader, clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../http/session-cookie.js';
import * as auth from '../services/auth.service.js';

function respondSession(reply: FastifyReply, s: auth.SessionResult) {
  setRefreshCookie(reply, s.refresh.raw, s.refresh.maxAgeSeconds);
  reply.header('cache-control', 'no-store');
  return { accessToken: s.accessToken, user: s.user };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  const strict = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS } };
  // Refresh runs on every page load from every device behind the shop's IP; it needs a possessed 256-bit token, not a guessable secret.
  const refreshLimit = { rateLimit: { max: env.AUTH_REFRESH_RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS } };

  app.post('/v1/auth/register', { config: strict }, async (req, reply) => {
    const s = await auth.registerOwner(req.body);
    reply.status(201);
    return respondSession(reply, s);
  });

  app.post('/v1/auth/login', { config: strict }, async (req, reply) => respondSession(reply, await auth.login(req.body, req.ip)));

  app.post('/v1/auth/refresh', { config: refreshLimit }, async (req, reply) => {
    assertCsrfHeader(req);
    try {
      return respondSession(reply, await auth.refreshSession(readRefreshCookie(req)));
    } catch (e) {
      clearRefreshCookie(reply);
      throw e;
    }
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    assertCsrfHeader(req);
    await auth.logout(readRefreshCookie(req));
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  app.post('/v1/auth/switch-tenant', async (req, reply) => {
    assertCsrfHeader(req);
    const a = await requireAuth(req);
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).strict().parse(req.body);
    return respondSession(reply, await auth.switchTenant(a.sub, tenantId, readRefreshCookie(req)));
  });

  app.post('/v1/auth/forgot-password', { config: strict }, async (req, reply) => {
    await auth.requestPasswordReset(req.body);
    return reply.status(202).send({
      ok: true,
      message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.',
    });
  });

  app.post('/v1/auth/reset-password', { config: strict }, async (req, reply) => {
    await auth.resetPassword(req.body);
    clearRefreshCookie(reply);
    return { ok: true };
  });

  app.get('/v1/auth/google', async () => {
    throw new AppError(
      501,
      'Google no disponible',
      'El inicio de sesión con Google estará disponible cuando se configure la cuenta de Google Cloud del negocio.',
      'oauth_not_configured',
    );
  });

  app.post('/v1/auth/totp/setup', async (req) => auth.setupTotp((await requireAuth(req)).sub));
  app.post('/v1/auth/totp/verify', async (req) => auth.verifyTotpSetup((await requireAuth(req)).sub, req.body));

  app.get('/v1/me', async (req, reply) => {
    const a = await requireAuth(req);
    reply.header('cache-control', 'no-store');
    return auth.me(a.sub, a.tenantId);
  });
}
