import { getEnv } from './config/env.js';
import { buildApp } from './app.js';
import { ensureSchema } from './db/schema.js';
import { getDriver } from './db/client.js';

export { buildApp };

async function main(): Promise<void> {
  const env = getEnv();
  if (env.DATABASE_DRIVER === 'pglite' && env.AUTO_MIGRATE) {
    await ensureSchema((m) => console.info(`[migrate] ${m}`));
  }
  const app = await buildApp();
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY === 0) {
    app.log.warn('TRUST_PROXY=0: every client behind the proxy shares one rate-limit bucket. Set it once an edge proxy overwrites X-Forwarded-For.');
  }
  const shutdown = async () => {
    await app.close();
    await (await getDriver()).close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

if (process.env.VITEST !== 'true') {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
