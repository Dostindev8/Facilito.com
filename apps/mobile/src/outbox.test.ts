import { describe, expect, it } from 'vitest';
import { OutboxEngine } from './outbox.js';

describe('OutboxEngine', () => {
  it('dedupes by clientUuid and tracks conflicts', () => {
    const eng = new OutboxEngine();
    eng.enqueue({
      clientUuid: 'u1',
      type: 'sale',
      payload: { total: '10' },
      createdAt: new Date().toISOString(),
    });
    eng.enqueue({
      clientUuid: 'u1',
      type: 'sale',
      payload: { total: '10' },
      createdAt: new Date().toISOString(),
    });
    expect(eng.pendingCount()).toBe(1);
    eng.addConflict({
      clientUuid: 'u1',
      reason: 'insufficient_stock',
      local: {},
      remote: {},
    });
    expect(eng.listConflicts()).toHaveLength(1);
    eng.resolveConflict('u1');
    expect(eng.listConflicts()).toHaveLength(0);
  });
});
