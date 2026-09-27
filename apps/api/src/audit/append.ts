import { computeAuditHash, GENESIS_HASH, newUuidsV7 } from '@facilito/domain';
import type { Queryable } from '../db/client.js';

/**
 * Appends one link to the tenant's hash chain. The advisory lock serializes writers per tenant
 * so two concurrent transactions can never fork the chain from the same previous hash.
 */
export async function appendAudit(
  q: Queryable,
  input: {
    tenantId: string;
    action: string;
    entity: string;
    entityId: string;
    before: unknown;
    after: unknown;
    authorId: string;
    deviceId?: string | null;
  },
): Promise<{ id: string; hash: string }> {
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`audit:${input.tenantId}`]);
  const prev = await q.query<{ hash: string }>(
    `SELECT hash FROM audit.bitacora WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [input.tenantId],
  );
  const prevHash = prev.rows[0]?.hash ?? GENESIS_HASH;
  const id = newUuidsV7();
  const createdAt = new Date();
  const beforeJson = input.before == null ? null : JSON.stringify(input.before);
  const afterJson = input.after == null ? null : JSON.stringify(input.after);
  const hash = computeAuditHash({
    tenantId: input.tenantId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    beforeJson,
    afterJson,
    authorId: input.authorId,
    deviceId: input.deviceId ?? null,
    prevHash,
    createdAtIso: createdAt.toISOString(),
  });
  await q.query(
    `INSERT INTO audit.bitacora
      (tenant_id, id, action, entity, entity_id, before_json, after_json, author_id, device_id, prev_hash, hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)`,
    [
      input.tenantId,
      id,
      input.action,
      input.entity,
      input.entityId,
      beforeJson,
      afterJson,
      input.authorId,
      input.deviceId ?? null,
      prevHash,
      hash,
      createdAt.toISOString(),
    ],
  );
  return { id, hash };
}
