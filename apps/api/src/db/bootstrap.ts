import pg from 'pg';
import { getEnv } from '../config/env.js';

/**
 * Real PostgreSQL only: gives the application role LOGIN with a password from the environment.
 * Run as a superuser (DATABASE_ADMIN_URL). PGlite needs no bootstrap.
 */
async function main(): Promise<void> {
  const adminUrl = getEnv().DATABASE_ADMIN_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL required for bootstrap');
  if (!appPassword || appPassword.length < 12) {
    throw new Error('APP_DB_PASSWORD (>= 12 chars) required for bootstrap');
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_app') THEN
        CREATE ROLE facilito_app NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  const escaped = appPassword.replace(/'/g, "''");
  await client.query(`ALTER ROLE facilito_app WITH LOGIN NOBYPASSRLS PASSWORD '${escaped}'`);
  await client.end();
  console.log('Bootstrap OK: facilito_app LOGIN NOBYPASSRLS');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
