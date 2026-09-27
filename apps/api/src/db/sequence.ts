import type { Queryable } from './client.js';

/**
 * Next value of a per-business counter. The upsert takes a row lock, so concurrent callers
 * serialize; if the surrounding transaction rolls back, the number is not consumed.
 */
export async function nextSequence(q: Queryable, tenantId: string, clave: string): Promise<number> {
  const res = await q.query<{ n: string }>(
    `INSERT INTO app.secuencia (tenant_id, clave, siguiente) VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, clave) DO UPDATE SET siguiente = app.secuencia.siguiente + 1
     RETURNING (siguiente - 1)::text AS n`,
    [tenantId, clave],
  );
  return Number(res.rows[0]!.n);
}
