import { z } from 'zod';
import { newUuidsV7 } from '@facilito/domain';
import { withTenant } from '../db/client.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';
import { documentoDo, likePattern, optionalEmail, optionalPhone, pagination, safeText } from '../http/validators.js';
import { decryptFieldSafe, encryptField } from '../utils/crypto.js';

type Kind = 'cliente' | 'proveedor';

const TABLE: Record<Kind, { table: string; docCol: string }> = {
  cliente: { table: 'app.cliente', docCol: 'documento_enc' },
  proveedor: { table: 'app.proveedor', docCol: 'rnc_enc' },
};

export const partySchema = z
  .object({
    nombre: safeText(1, 200),
    documento: documentoDo,
    telefono: optionalPhone,
    email: optionalEmail,
    estado: z.enum(['activo', 'inactivo']).optional(),
  })
  .strict();

const listQuery = pagination.extend({ q: z.string().trim().max(100).optional() });

function maskDoc(doc: string | null): string | null {
  if (!doc) return null;
  return `${'•'.repeat(Math.max(doc.length - 4, 0))}${doc.slice(-4)}`;
}

interface PartyRow {
  id: string;
  nombre: string;
  doc_enc: string | null;
  telefono: string | null;
  email: string | null;
  estado?: string;
  created_at: Date | string;
}

function toDto(r: PartyRow, reveal: boolean) {
  const doc = decryptFieldSafe(r.doc_enc);
  return {
    id: r.id,
    nombre: r.nombre,
    documento: reveal ? doc : maskDoc(doc),
    telefono: r.telefono,
    email: r.email,
    estado: r.estado ?? 'activo',
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listParties(kind: Kind, tenantId: string, query: unknown) {
  const f = listQuery.parse(query ?? {});
  const t = TABLE[kind];
  const estadoCol = kind === 'proveedor' ? 'estado' : `'activo'::text AS estado`;
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = $1';
  if (f.q) {
    params.push(likePattern(f.q));
    where += ` AND (nombre ILIKE $2 OR coalesce(email,'') ILIKE $2 OR coalesce(telefono,'') ILIKE $2)`;
  }
  return withTenant(tenantId, async (q) => {
    const total = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t.table} WHERE ${where}`, params);
    const rows = await q.query<PartyRow & Record<string, unknown>>(
      `SELECT id, nombre, ${t.docCol} AS doc_enc, telefono, email, ${estadoCol}, created_at
         FROM ${t.table} WHERE ${where}
        ORDER BY nombre, id LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
    );
    return { items: rows.rows.map((r) => toDto(r, false)), total: Number(total.rows[0]?.n ?? 0), page: f.page, pageSize: f.pageSize };
  });
}

export async function getParty(kind: Kind, tenantId: string, id: string) {
  const t = TABLE[kind];
  const estadoCol = kind === 'proveedor' ? 'estado' : `'activo'::text AS estado`;
  return withTenant(tenantId, async (q) => {
    const r = await q.query<PartyRow & Record<string, unknown>>(
      `SELECT id, nombre, ${t.docCol} AS doc_enc, telefono, email, ${estadoCol}, created_at FROM ${t.table} WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id],
    );
    if (!r.rows[0]) throw new AppError(404, 'No encontrado', `El ${kind} no existe en este negocio.`, 'not_found');
    return toDto(r.rows[0], true);
  });
}

export async function createParty(kind: Kind, tenantId: string, authorId: string, input: unknown) {
  const d = partySchema.parse(input);
  const t = TABLE[kind];
  const id = newUuidsV7();
  return withTenant(tenantId, async (q) => {
    const cols = ['tenant_id', 'id', 'nombre', t.docCol, 'telefono', 'email', 'created_by'];
    const vals: unknown[] = [tenantId, id, d.nombre, d.documento ? encryptField(d.documento) : null, d.telefono, d.email, authorId];
    if (kind === 'proveedor') {
      cols.push('estado');
      vals.push(d.estado ?? 'activo');
    }
    await q.query(
      `INSERT INTO ${t.table} (${cols.join(',')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(',')})`,
      vals,
    );
    await appendAudit(q, {
      tenantId,
      action: 'create',
      entity: kind,
      entityId: id,
      before: null,
      after: { nombre: d.nombre, documento: maskDoc(d.documento) },
      authorId,
    });
    return { id, nombre: d.nombre, documento: maskDoc(d.documento), telefono: d.telefono, email: d.email, estado: d.estado ?? 'activo' };
  });
}

export async function updateParty(kind: Kind, tenantId: string, authorId: string, id: string, input: unknown) {
  const d = partySchema.partial().parse(input);
  const t = TABLE[kind];
  return withTenant(tenantId, async (q) => {
    const exists = await q.query(`SELECT 1 FROM ${t.table} WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    if (!exists.rows.length) throw new AppError(404, 'No encontrado', `El ${kind} no existe en este negocio.`, 'not_found');
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col}=$${params.length}`);
    };
    if (d.nombre !== undefined) set('nombre', d.nombre);
    if (d.documento !== undefined) set(t.docCol, d.documento ? encryptField(d.documento) : null);
    if (d.telefono !== undefined) set('telefono', d.telefono);
    if (d.email !== undefined) set('email', d.email);
    if (d.estado !== undefined && kind === 'proveedor') set('estado', d.estado);
    if (sets.length) {
      sets.push('updated_at=now()');
      await q.query(`UPDATE ${t.table} SET ${sets.join(',')} WHERE tenant_id=$1 AND id=$2`, params);
      await appendAudit(q, {
        tenantId,
        action: 'update',
        entity: kind,
        entityId: id,
        before: null,
        after: { ...d, documento: d.documento === undefined ? undefined : maskDoc(d.documento) },
        authorId,
      });
    }
    return { id, ok: true };
  });
}
