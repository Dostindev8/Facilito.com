import type { FastifyRequest } from 'fastify';
import type { RoleCode } from '@facilito/domain';
import { verifyAccessToken, type AccessClaims } from '../auth/tokens.js';
import { sessionStatus } from '../auth/session-status.js';
import { AppError } from './errors.js';

export async function requireAuth(request: FastifyRequest): Promise<AccessClaims> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'No autorizado', 'Inicia sesión para continuar.', 'unauthorized');
  }
  let claims: AccessClaims;
  try {
    claims = await verifyAccessToken(header.slice(7));
  } catch {
    throw new AppError(401, 'No autorizado', 'Tu sesión expiró. Vuelve a iniciar sesión.', 'unauthorized');
  }
  const status = await sessionStatus(claims);
  if (status === 'blocked') {
    throw new AppError(403, 'Cuenta suspendida', 'Tu cuenta está suspendida. Escríbenos a soporte si crees que es un error.', 'account_blocked');
  }
  if (status === 'revoked') {
    throw new AppError(401, 'No autorizado', 'Tu acceso a este negocio ya no está activo. Vuelve a iniciar sesión.', 'unauthorized');
  }
  if (status === 'readonly' && !READ_METHODS.has(request.method) && !WRITE_EXEMPT.some((p) => request.url.startsWith(p))) {
    throw new AppError(
      402,
      'Suscripción vencida',
      'Tu suscripción está suspendida o cancelada. Puedes consultar y exportar tus datos; renueva para volver a registrar operaciones.',
      'subscription_readonly',
    );
  }
  return claims;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Account, session and billing actions stay available so a lapsed business can pay, export and sign out. */
const WRITE_EXEMPT = ['/v1/auth/', '/v1/me', '/v1/billing/'];

/** Tenant and role ALWAYS come from the verified token — never from the request body. */
export async function requireRole(request: FastifyRequest, roles: readonly RoleCode[]): Promise<AccessClaims> {
  const auth = await requireAuth(request);
  if (!roles.includes(auth.rol)) {
    throw new AppError(403, 'Sin permiso', 'Tu rol no permite esta operación.', 'forbidden');
  }
  return auth;
}

/** The token claim is only a fast reject; the platform service re-checks membership inside its transaction. */
export async function requirePlatformAdmin(request: FastifyRequest): Promise<AccessClaims> {
  const auth = await requireAuth(request);
  if (!auth.platformAdmin) {
    throw new AppError(403, 'Sin permiso', 'Esta sección es solo para administradores de Facilito.', 'forbidden');
  }
  if (!auth.mfa) {
    throw new AppError(
      403,
      'Verificación en dos pasos requerida',
      'Activa la verificación en dos pasos y vuelve a iniciar sesión con tu código para usar el panel.',
      'mfa_required',
    );
  }
  return auth;
}

export const ROLES_INVENTORY_WRITE: readonly RoleCode[] = ['owner', 'manager', 'warehouse'];
export const ROLES_SELL: readonly RoleCode[] = ['owner', 'manager', 'cashier'];
export const ROLES_VOID: readonly RoleCode[] = ['owner', 'manager'];
export const ROLES_ADMIN: readonly RoleCode[] = ['owner', 'manager'];
export const ROLES_OWNER: readonly RoleCode[] = ['owner'];
