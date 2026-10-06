import { withTenant } from '../db/client.js';
import type { AccessClaims } from './tokens.js';

const TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

/** key → expiry of the last "still active" answer. Per instance, so a block reaches other instances within TTL_MS. */
const active = new Map<string, number>();

const keyOf = (c: Pick<AccessClaims, 'sub' | 'tenantId' | 'accesoId'>) => `${c.sub}|${c.tenantId}|${c.accesoId}`;

export type SessionStatus = 'active' | 'blocked' | 'revoked';

/** Access tokens live up to JWT_ACCESS_TTL_SECONDS; this closes that window for blocked people and suspended businesses. */
export async function sessionStatus(claims: AccessClaims): Promise<SessionStatus> {
  const key = keyOf(claims);
  const until = active.get(key);
  if (until && until > Date.now()) return 'active';

  const row = await withTenant(
    claims.tenantId,
    async (q) =>
      (
        await q.query<{ blocked: boolean; negocio_ok: boolean; acceso_ok: boolean }>(
          `SELECT p.bloqueado_at IS NOT NULL AS blocked,
                  EXISTS (SELECT 1 FROM app.negocio n WHERE n.id = $2 AND n.estado = 'activo') AS negocio_ok,
                  EXISTS (SELECT 1 FROM app.acceso a WHERE a.id = $3 AND a.persona_id = $1 AND a.estado = 'active') AS acceso_ok
             FROM identity.persona p WHERE p.id = $1`,
          [claims.sub, claims.tenantId, claims.accesoId],
        )
      ).rows[0],
    { personaId: claims.sub },
  );
  if (!row) return 'revoked';
  if (row.blocked) return 'blocked';
  if (!row.negocio_ok || !row.acceso_ok) return 'revoked';

  if (active.size >= MAX_ENTRIES) active.clear();
  active.set(key, Date.now() + TTL_MS);
  return 'active';
}

export function forgetSessionsOf(match: { personaId?: string; tenantId?: string }): void {
  for (const key of active.keys()) {
    const [sub, tenantId] = key.split('|');
    if ((match.personaId && sub === match.personaId) || (match.tenantId && tenantId === match.tenantId)) active.delete(key);
  }
}

export function __resetSessionStatusForTests(): void {
  active.clear();
}
