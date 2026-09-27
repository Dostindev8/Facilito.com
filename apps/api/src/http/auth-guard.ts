import type { FastifyRequest } from 'fastify';
import type { RoleCode } from '@facilito/domain';
import { verifyAccessToken, type AccessClaims } from '../auth/tokens.js';
import { AppError } from './errors.js';

export async function requireAuth(request: FastifyRequest): Promise<AccessClaims> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'No autorizado', 'Inicia sesión para continuar.', 'unauthorized');
  }
  try {
    return await verifyAccessToken(header.slice(7));
  } catch {
    throw new AppError(401, 'No autorizado', 'Tu sesión expiró. Vuelve a iniciar sesión.', 'unauthorized');
  }
}

/** Tenant and role ALWAYS come from the verified token — never from the request body. */
export async function requireRole(request: FastifyRequest, roles: readonly RoleCode[]): Promise<AccessClaims> {
  const auth = await requireAuth(request);
  if (!roles.includes(auth.rol)) {
    throw new AppError(403, 'Sin permiso', 'Tu rol no permite esta operación.', 'forbidden');
  }
  return auth;
}

export const ROLES_INVENTORY_WRITE: readonly RoleCode[] = ['owner', 'manager', 'warehouse'];
export const ROLES_SELL: readonly RoleCode[] = ['owner', 'manager', 'cashier'];
export const ROLES_VOID: readonly RoleCode[] = ['owner', 'manager'];
export const ROLES_ADMIN: readonly RoleCode[] = ['owner', 'manager'];
export const ROLES_OWNER: readonly RoleCode[] = ['owner'];
