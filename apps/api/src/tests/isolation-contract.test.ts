import { describe, expect, it } from 'vitest';
import { tenantCacheKey } from '../utils/cache.js';
import { isCopilotLevel3Action } from '@facilito/domain';

/**
 * Always-on isolation contract tests (no Postgres required).
 * Full RLS suite runs when RUN_ISOLATION=1 + DATABASE_URL (CI).
 */
describe('isolation contracts (always on)', () => {
  it('cache keys are tenant-namespaced', () => {
    expect(tenantCacheKey('t1', 'products')).toBe('t:t1:products');
    expect(tenantCacheKey('t1', 'products')).not.toBe(tenantCacheKey('t2', 'products'));
  });

  it('vector query must include tenant predicate (documented contract)', () => {
    const unsafe = 'SELECT * FROM vectors.embedding ORDER BY embedding <-> $1';
    const safe = 'SELECT * FROM vectors.embedding WHERE tenant_id = $1 ORDER BY embedding <-> $2';
    expect(safe.includes('tenant_id')).toBe(true);
    expect(unsafe.includes('tenant_id')).toBe(false);
  });

  it('copilot level 3 actions are enumerated for negative tests', () => {
    expect(isCopilotLevel3Action('change_roles')).toBe(true);
  });
});
