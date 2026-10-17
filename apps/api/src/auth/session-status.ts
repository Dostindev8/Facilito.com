import { effectiveSubscriptionState, subscriptionAllowsWrites, type SubscriptionState } from '@facilito/domain';
import { withTenant } from '../db/client.js';
import type { AccessClaims } from './tokens.js';

const TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

/** key → expiry of the last "still active" answer. Per instance, so a block reaches other instances within TTL_MS. */
const active = new Map<string, { until: number; status: 'active' | 'readonly' }>();

const keyOf = (c: Pick<AccessClaims, 'sub' | 'tenantId' | 'accesoId' | 'sid'>) => `${c.sub}|${c.tenantId}|${c.accesoId}|${c.sid ?? ''}`;

/** `readonly`: the subscription lapsed (suspended or cancelled) — the data stays readable and exportable, never writable. */
export type SessionStatus = 'active' | 'readonly' | 'blocked' | 'revoked';

/** Access tokens live up to JWT_ACCESS_TTL_SECONDS; this closes that window for blocked people and suspended businesses. */
export async function sessionStatus(claims: AccessClaims): Promise<SessionStatus> {
  const key = keyOf(claims);
  const hit = active.get(key);
  if (hit && hit.until > Date.now()) return hit.status;

  const row = await withTenant(
    claims.tenantId,
    async (q) =>
      (
        await q.query<{
          blocked: boolean;
          negocio_ok: boolean;
          acceso_ok: boolean;
          sub_estado: SubscriptionState | null;
          sub_fin: Date | string | null;
          sub_cancelar: boolean | null;
          session_ok: boolean;
        }>(
          `SELECT p.bloqueado_at IS NOT NULL AS blocked,
                  EXISTS (SELECT 1 FROM app.negocio n WHERE n.id = $2 AND n.estado = 'activo') AS negocio_ok,
                  EXISTS (SELECT 1 FROM app.acceso a WHERE a.id = $3 AND a.persona_id = $1 AND a.estado = 'active') AS acceso_ok,
                  ($4 = '' OR EXISTS (SELECT 1 FROM identity.refresh_token t
                                       WHERE t.family_id = NULLIF($4, '')::uuid AND t.persona_id = $1
                                         AND t.revoked_at IS NULL AND t.expires_at > now())) AS session_ok,
                  s.estado AS sub_estado, s.periodo_fin AS sub_fin, s.cancelar_al_final AS sub_cancelar
             FROM identity.persona p
             LEFT JOIN billing.suscripcion s ON s.tenant_id = $2
            WHERE p.id = $1`,
          [claims.sub, claims.tenantId, claims.accesoId, claims.sid ?? ''],
        )
      ).rows[0],
    { personaId: claims.sub },
  );
  if (!row) return 'revoked';
  if (row.blocked) return 'blocked';
  if (!row.negocio_ok || !row.acceso_ok || !row.session_ok) return 'revoked';

  // Businesses created before paid plans have no subscription row and keep full access until one is assigned.
  let status: 'active' | 'readonly' = 'active';
  if (row.sub_estado) {
    const estado = effectiveSubscriptionState(row.sub_estado, row.sub_fin ? new Date(row.sub_fin) : null, !!row.sub_cancelar);
    if (!subscriptionAllowsWrites(estado)) status = 'readonly';
  }

  if (active.size >= MAX_ENTRIES) active.clear();
  active.set(key, { until: Date.now() + TTL_MS, status });
  return status;
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
