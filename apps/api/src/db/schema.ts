import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriver } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/** Roles are created without passwords here; production sets them from the vault (see .env.example). */
const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_migrator') THEN
    CREATE ROLE facilito_migrator NOSUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_app') THEN
    CREATE ROLE facilito_app NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_master') THEN
    CREATE ROLE facilito_master NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE facilito_app NOBYPASSRLS;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS vectors;
CREATE TABLE IF NOT EXISTS app.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function ensureSchema(log: (msg: string) => void = () => undefined): Promise<string[]> {
  const driver = await getDriver();
  const admin = await driver.admin();
  const applied: string[] = [];
  try {
    await admin.exec(BOOTSTRAP_SQL);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const done = await admin.query('SELECT 1 FROM app.schema_migrations WHERE id = $1', [file]);
      if (done.rows.length) continue;
      log(`Applying ${file}`);
      await admin.exec(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await admin.query('INSERT INTO app.schema_migrations (id) VALUES ($1)', [file]);
      applied.push(file);
    }
  } finally {
    await admin.release();
  }
  return applied;
}
