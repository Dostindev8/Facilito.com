import { createHash } from 'node:crypto';

export interface AuditChainInput {
  tenantId: string;
  action: string;
  entity: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  authorId: string;
  deviceId: string | null;
  prevHash: string;
  createdAtIso: string;
}

/** Canonical payload for hash chain — order is stable and intentional. */
export function canonicalizeAuditPayload(input: AuditChainInput): string {
  return [
    input.tenantId,
    input.action,
    input.entity,
    input.entityId,
    input.beforeJson ?? '',
    input.afterJson ?? '',
    input.authorId,
    input.deviceId ?? '',
    input.prevHash,
    input.createdAtIso,
  ].join('|');
}

export function computeAuditHash(input: AuditChainInput): string {
  const canonical = canonicalizeAuditPayload(input);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export const GENESIS_HASH = '0'.repeat(64);
