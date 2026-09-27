import { createRequire } from 'node:module';
import { getEnv } from '../config/env.js';

type RedisClient = {
  status: string;
  connect: () => Promise<void>;
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ex: 'EX', ttl: number) => Promise<unknown>;
  del: (k: string) => Promise<number>;
  incr: (k: string) => Promise<number>;
  expire: (k: string, ttl: number) => Promise<number>;
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
};

const require = createRequire(import.meta.url);
let redis: RedisClient | null | undefined;
const memory = new Map<string, { value: string; expiresAt: number }>();

async function getRedis(): Promise<RedisClient | null> {
  if (redis !== undefined) return redis;
  const url = getEnv().REDIS_URL;
  if (!url) {
    redis = null;
    return redis;
  }
  const Redis = require('ioredis') as new (url: string, opts: object) => RedisClient;
  const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
  client.on('error', () => undefined);
  try {
    await client.connect();
    redis = client;
  } catch {
    redis = null;
  }
  return redis;
}

function memGet(key: string): string | null {
  const m = memory.get(key);
  if (!m) return null;
  if (Date.now() > m.expiresAt) {
    memory.delete(key);
    return null;
  }
  return m.value;
}

/** Cache keys are ALWAYS namespaced by tenant. */
export function tenantCacheKey(tenantId: string, key: string): string {
  return `t:${tenantId}:${key}`;
}

async function rawGet(key: string): Promise<string | null> {
  const r = await getRedis();
  if (r) {
    try {
      return await r.get(key);
    } catch {
      /* memory fallback */
    }
  }
  return memGet(key);
}

async function rawSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const r = await getRedis();
  if (r) {
    try {
      await r.set(key, value, 'EX', ttlSeconds);
      return;
    } catch {
      /* memory fallback */
    }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function rawDel(key: string): Promise<void> {
  const r = await getRedis();
  if (r) {
    try {
      await r.del(key);
    } catch {
      /* memory fallback */
    }
  }
  memory.delete(key);
}

export async function cacheGet(tenantId: string, key: string): Promise<string | null> {
  return rawGet(tenantCacheKey(tenantId, key));
}

export async function cacheSet(tenantId: string, key: string, value: string, ttlSeconds = 60): Promise<void> {
  await rawSet(tenantCacheKey(tenantId, key), value, ttlSeconds);
}

export async function cacheDel(tenantId: string, key: string): Promise<void> {
  await rawDel(tenantCacheKey(tenantId, key));
}

/** Global (non-tenant) counters, used only for login brute-force protection. */
export async function counterIncr(key: string, ttlSeconds: number): Promise<number> {
  const full = `g:${key}`;
  const r = await getRedis();
  if (r) {
    try {
      const n = await r.incr(full);
      if (n === 1) await r.expire(full, ttlSeconds);
      return n;
    } catch {
      /* memory fallback */
    }
  }
  const current = Number(memGet(full) ?? '0') + 1;
  const existing = memory.get(full);
  memory.set(full, {
    value: String(current),
    expiresAt: existing && Date.now() < existing.expiresAt ? existing.expiresAt : Date.now() + ttlSeconds * 1000,
  });
  return current;
}

export async function counterGet(key: string): Promise<number> {
  return Number((await rawGet(`g:${key}`)) ?? '0');
}

export async function counterReset(key: string): Promise<void> {
  await rawDel(`g:${key}`);
}

export function __resetMemoryCacheForTests(): void {
  memory.clear();
}
