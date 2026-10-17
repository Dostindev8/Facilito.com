/** In-memory limiter. One Node process only — see docs/DECISIONS.md. Not a global lock on serverless. */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export const CONTACT_LIMIT = 5;
export const CONTACT_WINDOW_MS = 10 * 60 * 1000;

export function resetRateLimit(): void {
  buckets.clear();
}

export function hitRateLimit(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + CONTACT_WINDOW_MS });
    return { ok: true };
  }
  if (current.count >= CONTACT_LIMIT) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { ok: true };
}
