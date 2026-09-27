import type { FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';
import { AppError } from './errors.js';

export const REFRESH_COOKIE = 'fc_rt';
/** Readable, non-secret flag so the web app only calls /auth/refresh when a session may exist. */
export const SESSION_HINT_COOKIE = 'fc_s';

export function setRefreshCookie(reply: FastifyReply, raw: string, maxAgeSeconds: number | null): void {
  const env = getEnv();
  const lifetime = maxAgeSeconds ? { maxAge: maxAgeSeconds } : {};
  reply.setCookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: env.COOKIE_PATH,
    ...lifetime,
  });
  reply.setCookie(SESSION_HINT_COOKIE, '1', { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/', ...lifetime });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  const env = getEnv();
  reply.clearCookie(REFRESH_COOKIE, { path: env.COOKIE_PATH, httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict' });
  reply.clearCookie(SESSION_HINT_COOKIE, { path: '/', secure: env.COOKIE_SECURE, sameSite: 'strict' });
}

export function readRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies?.[REFRESH_COOKIE];
}

/**
 * Cookie-authenticated endpoints require a custom header. Browsers cannot attach it cross-origin
 * without a CORS preflight, which the allowlist rejects — a CSRF guard on top of SameSite=Strict.
 */
export function assertCsrfHeader(request: FastifyRequest): void {
  if (request.headers['x-facilito-csrf'] !== '1') {
    throw new AppError(403, 'Solicitud rechazada', 'Falta el encabezado de seguridad de la sesión.', 'csrf');
  }
}
