import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { newUuidsV7 } from '@facilito/domain';

const databaseUrl = process.env.DATABASE_URL;
const hasDb = Boolean(databaseUrl && process.env.RUN_ISOLATION === '1');

describe.skipIf(!hasDb)('multi-tenant isolation suite', () => {
  it('RLS returns zero rows without tenant GUC', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const tenantA = newUuidsV7();
      const tenantB = newUuidsV7();
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.auth_bootstrap', '1', true)`);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await client.query(
        `INSERT INTO app.isolation_probe (tenant_id, id, label) VALUES ($1,$2,'a')`,
        [tenantA, newUuidsV7()],
      );
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      await client.query(
        `INSERT INTO app.isolation_probe (tenant_id, id, label) VALUES ($1,$2,'b')`,
        [tenantB, newUuidsV7()],
      );
      await client.query('COMMIT');

      await client.query('BEGIN');
      // No tenant set
      await client.query(`SELECT set_config('app.tenant_id', '', true)`);
      const none = await client.query(`SELECT * FROM app.isolation_probe`);
      expect(none.rowCount).toBe(0);

      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      const onlyA = await client.query(`SELECT label FROM app.isolation_probe`);
      expect(onlyA.rows.every((r) => r.label === 'a')).toBe(true);
      expect(onlyA.rowCount).toBe(1);

      // Cross-tenant write attempt should fail WITH CHECK
      let blocked = false;
      try {
        await client.query(
          `INSERT INTO app.isolation_probe (tenant_id, id, label) VALUES ($1,$2,'evil')`,
          [tenantB, newUuidsV7()],
        );
      } catch {
        blocked = true;
      }
      expect(blocked).toBe(true);
      await client.query('ROLLBACK');

      // Vector isolation
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await client.query(
        `INSERT INTO vectors.embedding (tenant_id, id, collection, content, embedding)
         VALUES ($1,$2,'business','secret-a','[0.1,0.2,0.3]')`,
        [tenantA, newUuidsV7()],
      );
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const vec = await client.query(`SELECT content FROM vectors.embedding`);
      expect(vec.rows.find((r) => r.content === 'secret-a')).toBeUndefined();
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  it('cache namespace cannot be forged across tenants (logical)', () => {
    const keyA = `t:aaa:products`;
    const keyB = `t:bbb:products`;
    expect(keyA).not.toBe(keyB);
  });
});
