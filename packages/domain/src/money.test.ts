import { describe, expect, it } from 'vitest';
import { Money, neutralizeCsvCell } from './money.js';
import { computeAuditHash, GENESIS_HASH } from './audit-hash.js';
import { isCopilotLevel3Action } from './types.js';

describe('Money', () => {
  it('adds with exact decimals', () => {
    const a = Money.fromString('10.105');
    const b = Money.fromString('0.005');
    expect(a.add(b).round(2).toFixed(2)).toBe('10.11');
  });

  it('rejects float-like construction via string path', () => {
    expect(Money.fromString('1.10').toString()).toBe('1.1');
  });
});

describe('audit hash chain', () => {
  it('is deterministic', () => {
    const input = {
      tenantId: 't1',
      action: 'create',
      entity: 'product',
      entityId: 'p1',
      beforeJson: null,
      afterJson: '{"sku":"A"}',
      authorId: 'u1',
      deviceId: null,
      prevHash: GENESIS_HASH,
      createdAtIso: '2026-01-01T00:00:00.000Z',
    };
    expect(computeAuditHash(input)).toBe(computeAuditHash(input));
    expect(computeAuditHash(input)).toHaveLength(64);
  });
});

describe('csv formula injection', () => {
  it('neutralizes leading formula chars', () => {
    expect(neutralizeCsvCell('=1+1')).toBe("'=1+1");
    expect(neutralizeCsvCell('+cmd')).toBe("'+cmd");
    expect(neutralizeCsvCell('ok')).toBe('ok');
  });
});

describe('copilot level 3', () => {
  it('flags forbidden actions', () => {
    expect(isCopilotLevel3Action('move_money')).toBe(true);
    expect(isCopilotLevel3Action('read_sales')).toBe(false);
  });
});
