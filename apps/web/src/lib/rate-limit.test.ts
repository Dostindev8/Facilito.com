import { afterEach, describe, expect, it } from 'vitest';
import { CONTACT_LIMIT, hitRateLimit, resetRateLimit } from './rate-limit';

describe('hitRateLimit', () => {
  afterEach(() => resetRateLimit());

  it('permite el cupo y bloquea el siguiente', () => {
    for (let i = 0; i < CONTACT_LIMIT; i += 1) expect(hitRateLimit('ip', 1_000).ok).toBe(true);
    const blocked = hitRateLimit('ip', 1_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('no mezcla claves', () => {
    for (let i = 0; i < CONTACT_LIMIT; i += 1) hitRateLimit('a', 1_000);
    expect(hitRateLimit('b', 1_000).ok).toBe(true);
  });
});
