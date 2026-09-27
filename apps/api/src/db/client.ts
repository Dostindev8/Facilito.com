import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { getEnv } from '../config/env.js';

export type Row = Record<string, unknown>;

export interface QueryResult<R extends Row = Row> {
  rows: R[];
  rowCount: number;
}

/** Minimal query surface shared by node-postgres and PGlite. Always parameterized. */
export interface Queryable {
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

interface TxOptions {
  tenantId?: string;
  personaId?: string;
  authBootstrap?: boolean;
}

export interface Driver {
  tx<T>(options: TxOptions, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Privileged connection for migrations/bootstrap only. */
  admin(): Promise<Queryable & { exec(sql: string): Promise<void>; release(): Promise<void> }>;
  kind: 'pg' | 'pglite';
  close(): Promise<void>;
}

async function applySession(q: Queryable, options: TxOptions): Promise<void> {
  await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [options.tenantId ?? '']);
  await q.query(`SELECT set_config('app.persona_id', $1, true)`, [options.personaId ?? '']);
  await q.query(`SELECT set_config('app.auth_bootstrap', $1, true)`, [
    options.authBootstrap ? '1' : '',
  ]);
}

function pgDriver(connectionString: string): Driver {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    async tx(options, fn) {
      const client = await pool.connect();
      const q: Queryable = {
        async query<R extends Row>(text: string, params?: unknown[]) {
          const res = await client.query(text, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
      };
      try {
        await client.query('BEGIN');
        await applySession(q, options);
        const result = await fn(q);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    kind: 'pg',
    async admin() {
      const adminUrl = getEnv().DATABASE_ADMIN_URL;
      if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required for migrations');
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      return {
        async query<R extends Row>(text: string, params?: unknown[]) {
          const res = await client.query(text, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
        async exec(sql: string) {
          await client.query(sql);
        },
        async release() {
          await client.end();
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
}

type PgliteInstance = {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: PgliteInstance) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  waitReady: Promise<void>;
};

async function pgliteDriver(dataDir: string | undefined): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  const inMemory = !dataDir || dataDir === 'memory://';
  const db = (await PGlite.create(
    inMemory ? { extensions: { vector } } : { dataDir, extensions: { vector } },
  )) as unknown as PgliteInstance;
  // PGlite serializes transactions; chain them so concurrent requests queue instead of interleaving.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    tx(options, fn) {
      const run = chain.then(() =>
        db.transaction(async (tx) => {
          const q: Queryable = {
            async query<R extends Row>(text: string, params?: unknown[]) {
              const res = await tx.query<R>(text, params);
              return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
            },
          };
          // PGlite runs as superuser; drop to the app role so RLS applies exactly as in production.
          await q.query('SET LOCAL ROLE facilito_app');
          await applySession(q, options);
          return fn(q);
        }),
      );
      chain = run.catch(() => undefined);
      return run;
    },
    kind: 'pglite',
    async admin() {
      await chain;
      return {
        async query<R extends Row>(text: string, params?: unknown[]) {
          const res = await db.query<R>(text, params);
          return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
        },
        async exec(sql: string) {
          await db.exec(sql);
        },
        async release() {
          /* shared embedded instance */
        },
      };
    },
    async close() {
      await db.close();
    },
  };
}

/** A transaction opened inside another breaks atomicity (and deadlocks the serialized embedded driver). */
const inTx = new AsyncLocalStorage<true>();

async function runTx<T>(options: TxOptions, fn: (q: Queryable) => Promise<T>): Promise<T> {
  if (inTx.getStore()) throw new Error('Nested database transaction: pass the Queryable down instead');
  const driver = await getDriver();
  return inTx.run(true, () => driver.tx(options, fn));
}

let driverPromise: Promise<Driver> | null = null;

export function getDriver(): Promise<Driver> {
  if (!driverPromise) {
    const env = getEnv();
    driverPromise =
      env.DATABASE_DRIVER === 'pglite'
        ? pgliteDriver(env.PGLITE_DATA_DIR || undefined)
        : Promise.resolve(pgDriver(env.DATABASE_URL));
  }
  return driverPromise;
}

/** Test hook: install a fresh driver (e.g. in-memory PGlite). */
export async function resetDriverForTests(): Promise<void> {
  if (driverPromise) {
    const d = await driverPromise;
    await d.close();
  }
  driverPromise = null;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (q: Queryable) => Promise<T>,
  options?: { personaId?: string },
): Promise<T> {
  return runTx({ tenantId, personaId: options?.personaId }, fn);
}

export async function withPersona<T>(
  personaId: string,
  fn: (q: Queryable) => Promise<T>,
  options?: { authBootstrap?: boolean; tenantId?: string },
): Promise<T> {
  return runTx({ personaId, authBootstrap: options?.authBootstrap, tenantId: options?.tenantId }, fn);
}

/** Only for the auth service: login/refresh/reset need to look up identities before a persona is known. */
export async function withAuthBootstrap<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  return runTx({ authBootstrap: true }, fn);
}

export function pgErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
