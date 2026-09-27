import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUuidsV7 } from '@facilito/domain';
import { ensureSchema } from '../db/schema.js';
import { resetDriverForTests, withAuthBootstrap, withTenant } from '../db/client.js';

const tenantA = newUuidsV7();
const tenantB = newUuidsV7();
const productA = newUuidsV7();

async function seedTenant(id: string, rncHash: string): Promise<void> {
  await withAuthBootstrap((q) =>
    q.query(`INSERT INTO app.negocio (id, razon_social, rnc_enc, rnc_hash) VALUES ($1, $2, 'enc', $3)`, [
      id,
      `Negocio ${rncHash}`,
      rncHash,
    ]),
  );
}

beforeAll(async () => {
  await resetDriverForTests();
  await ensureSchema();
  await seedTenant(tenantA, 'hash-a');
  await seedTenant(tenantB, 'hash-b');
  await withTenant(tenantA, (q) =>
    q.query(
      `INSERT INTO app.producto (tenant_id, id, sku, nombre, uom, precio_venta, costo) VALUES ($1,$2,'A-1','Arroz','lb','50','30')`,
      [tenantA, productA],
    ),
  );
});

afterAll(async () => {
  await resetDriverForTests();
});

describe('schema on embedded Postgres with app role', () => {
  it('runs as the non-bypass role', async () => {
    const r = await withTenant(tenantA, (q) =>
      q.query<{ u: string; bypass: boolean }>(
        `SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
      ),
    );
    expect(r.rows[0]).toEqual({ u: 'facilito_app', bypass: false });
  });

  it('RLS hides other tenants rows', async () => {
    const own = await withTenant(tenantA, (q) => q.query('SELECT id FROM app.producto'));
    const other = await withTenant(tenantB, (q) => q.query('SELECT id FROM app.producto'));
    expect(own.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
  });

  it('RLS blocks writing into another tenant', async () => {
    await expect(
      withTenant(tenantB, (q) =>
        q.query(
          `INSERT INTO app.producto (tenant_id, id, sku, nombre) VALUES ($1,$2,'X','X')`,
          [tenantA, newUuidsV7()],
        ),
      ),
    ).rejects.toThrow();
  });

  it('no tenant context sees nothing', async () => {
    const driverRows = await withAuthBootstrap((q) => q.query('SELECT id FROM app.producto'));
    expect(driverRows.rows).toHaveLength(0);
  });

  it('stock trigger maintains stock and rejects negatives', async () => {
    await withTenant(tenantA, (q) =>
      q.query(
        `INSERT INTO app.movimiento_inventario (tenant_id, id, producto_id, tipo, cantidad, motivo_codigo, author_id, client_uuid)
         VALUES ($1,$2,$3,'in','10','inicial',$4,$5)`,
        [tenantA, newUuidsV7(), productA, newUuidsV7(), newUuidsV7()],
      ),
    );
    const s = await withTenant(tenantA, (q) =>
      q.query<{ stock_actual: string; margen: string }>('SELECT stock_actual, margen FROM app.producto WHERE id = $1', [productA]),
    );
    expect(Number(s.rows[0]!.stock_actual)).toBe(10);
    expect(Number(s.rows[0]!.margen)).toBe(40);
    await expect(
      withTenant(tenantA, (q) =>
        q.query(
          `INSERT INTO app.movimiento_inventario (tenant_id, id, producto_id, tipo, cantidad, motivo_codigo, author_id, client_uuid)
           VALUES ($1,$2,$3,'out','11','merma',$4,$5)`,
          [tenantA, newUuidsV7(), productA, newUuidsV7(), newUuidsV7()],
        ),
      ),
    ).rejects.toThrow(/NEGATIVE_STOCK/);
  });

  it('audit log rejects updates', async () => {
    await withTenant(tenantA, (q) =>
      q.query(
        `INSERT INTO audit.bitacora (tenant_id, id, action, entity, entity_id, author_id, prev_hash, hash)
         VALUES ($1,$2,'t','t','t',$3,'0','1')`,
        [tenantA, newUuidsV7(), newUuidsV7()],
      ),
    );
    await expect(
      withTenant(tenantA, (q) => q.query(`UPDATE audit.bitacora SET action = 'x' WHERE tenant_id = $1`, [tenantA])),
    ).rejects.toThrow();
  });

  it('timezone data is available for business-day boundaries', async () => {
    const r = await withTenant(tenantA, (q) =>
      q.query<{ d: string }>(`SELECT to_char(timezone('America/Santo_Domingo', now()), 'YYYY') AS d`),
    );
    expect(r.rows[0]!.d).toMatch(/^\d{4}$/);
  });
});
