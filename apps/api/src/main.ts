import { getEnv } from './config/env.js';
import { buildApp } from './app.js';
import { ensureSchema } from './db/schema.js';
import { getDriver } from './db/client.js';
import { provisionPlatformAdmin } from './db/platform-admin.js';

export { buildApp };

/**
 * The end-to-end suite authorizes subscriptions as a platform admin. With the embedded database no second process can
 * open the data directory, so the account is provisioned here. It starts without 2FA every run so the suite can enrol
 * a fresh authenticator; production refuses the variables outright.
 */
async function provisionE2eAdmin(nodeEnv: string): Promise<void> {
  const email = process.env.E2E_PLATFORM_ADMIN_EMAIL;
  const password = process.env.E2E_PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (nodeEnv === 'production') throw new Error('E2E_PLATFORM_ADMIN_* must not be set in production');
  await provisionPlatformAdmin({ email, password, nombre: 'Administración E2E', resetTotp: true });
  console.info('[e2e] platform admin provisioned');
}

async function main(): Promise<void> {
  const env = getEnv();
  if (env.DATABASE_DRIVER === 'pglite' && env.AUTO_MIGRATE) {
    await ensureSchema((m) => console.info(`[migrate] ${m}`));
  }
  await provisionE2eAdmin(env.NODE_ENV);
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
