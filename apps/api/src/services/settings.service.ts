import { z } from 'zod';
import { instagramUrl, resolveBusinessType, rncPlainSchema, type RoleCode } from '@facilito/domain';
import { withTenant, type Queryable } from '../db/client.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';
import { businessTypeField, instagramField, optionalEmail, optionalPhone, optionalText, safeText } from '../http/validators.js';
import { decryptFieldSafe, encryptField, hashRnc } from '../utils/crypto.js';

export interface InstagramProfile {
  handle: string;
  url: string;
  /** True only once the business authorizes Meta OAuth (not implemented yet — see getInstagramBusinessProfile). */
  connected: boolean;
  lastSyncedAt: string | null;
}

export interface BusinessSettings {
  id: string;
  razonSocial: string;
  nombreComercial: string;
  rnc: string | null;
  direccion: string | null;
  ubicacion: string;
  telefono: string | null;
  email: string | null;
  estado: string;
  itbisModo: 'linea' | 'global';
  itbisTasa: string;
  ncfTipoDefault: string | null;
  sujetoDgii: boolean;
  permiteStockNegativo: boolean;
  verticales: string[];
  tipoNegocio: string;
  instagram: InstagramProfile | null;
}

export function formatRnc(rnc: string | null): string | null {
  if (!rnc) return null;
  if (rnc.length === 9) return `${rnc.slice(0, 1)}-${rnc.slice(1, 3)}-${rnc.slice(3, 8)}-${rnc.slice(8)}`;
  if (rnc.length === 11) return `${rnc.slice(0, 3)}-${rnc.slice(3, 10)}-${rnc.slice(10)}`;
  return rnc;
}

export async function loadBusiness(q: Queryable, tenantId: string): Promise<BusinessSettings> {
  const r = await q.query<{
    id: string;
    razon_social: string;
    nombre_comercial: string | null;
    rnc_enc: string;
    direccion: string | null;
    ubicacion: string;
    telefono: string | null;
    email: string | null;
    estado: string;
    itbis_modo: 'linea' | 'global';
    itbis_tasa: string;
    ncf_tipo_default: string | null;
    sujeto_dgii: boolean;
    allow_negative_stock: boolean;
    verticales: string[];
    tipo_negocio: string | null;
    instagram_handle: string | null;
    instagram_connected: boolean;
    instagram_last_synced_at: Date | string | null;
  }>(
    `SELECT id, razon_social, nombre_comercial, rnc_enc, direccion, ubicacion, telefono, email, estado,
            itbis_modo, trim_scale(itbis_tasa)::text AS itbis_tasa, ncf_tipo_default, sujeto_dgii,
            allow_negative_stock, verticales, tipo_negocio, instagram_handle, instagram_connected,
            instagram_last_synced_at
       FROM app.negocio WHERE id = $1`,
    [tenantId],
  );
  const n = r.rows[0];
  if (!n) throw new AppError(404, 'Negocio no encontrado', 'No se encontró el negocio activo.', 'not_found');
  return {
    id: n.id,
    razonSocial: n.razon_social,
    nombreComercial: n.nombre_comercial ?? n.razon_social,
    rnc: decryptFieldSafe(n.rnc_enc),
    direccion: n.direccion,
    ubicacion: n.ubicacion,
    telefono: n.telefono,
    email: n.email,
    estado: n.estado,
    itbisModo: n.itbis_modo,
    itbisTasa: n.itbis_tasa,
    ncfTipoDefault: n.ncf_tipo_default,
    sujetoDgii: n.sujeto_dgii,
    permiteStockNegativo: n.allow_negative_stock,
    verticales: Array.isArray(n.verticales) ? n.verticales : [],
    tipoNegocio: n.tipo_negocio ?? resolveBusinessType(undefined, n.verticales?.[0]).tipoNegocio,
    instagram: n.instagram_handle
      ? {
          handle: n.instagram_handle,
          url: instagramUrl(n.instagram_handle),
          connected: n.instagram_connected,
          lastSyncedAt: n.instagram_last_synced_at ? new Date(n.instagram_last_synced_at).toISOString() : null,
        }
      : null,
  };
}

/** Owners and managers see the full RNC; other roles see it masked. */
export function presentBusiness(b: BusinessSettings, rol: RoleCode) {
  const full = rol === 'owner' || rol === 'manager' || rol === 'accountant';
  return {
    ...b,
    rnc: full ? formatRnc(b.rnc) : b.rnc ? `•••••${b.rnc.slice(-4)}` : null,
  };
}

export async function getSettings(tenantId: string, rol: RoleCode) {
  return withTenant(tenantId, async (q) => presentBusiness(await loadBusiness(q, tenantId), rol));
}

export const updateSettingsSchema = z
  .object({
    razonSocial: safeText(2, 200).optional(),
    nombreComercial: safeText(2, 200).optional(),
    tipoNegocio: businessTypeField.optional(),
    instagram: instagramField,
    rnc: rncPlainSchema.optional(),
    /** Required when the business already issued comprobantes with its current RNC. */
    confirmRncChange: z.boolean().optional(),
    direccion: optionalText(300),
    ubicacion: safeText(2, 120).optional(),
    telefono: optionalPhone,
    email: optionalEmail,
    itbisModo: z.enum(['linea', 'global']).optional(),
    // TODO: VERIFICAR EN VIVO — tasa general de ITBIS vigente.
    itbisTasa: z.enum(['0.18', '0.16', '0']).optional(),
    ncfTipoDefault: z
      .union([z.string().regex(/^[BE]\d{2}$/, 'Tipo NCF inválido'), z.null()])
      .optional(),
    sujetoDgii: z.boolean().optional(),
    permiteStockNegativo: z.boolean().optional(),
  })
  .strict();

function rncTaken(): AppError {
  return new AppError(409, 'RNC registrado', 'Ese RNC ya tiene un negocio en Facilito.', 'rnc_taken', {
    errors: [{ field: 'rnc', message: 'Ese RNC ya tiene un negocio en Facilito' }],
  });
}

export async function updateSettings(tenantId: string, authorId: string, rol: RoleCode, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const d = updateSettingsSchema.parse(input);
  return withTenant(tenantId, async (q) => {
    const before = await loadBusiness(q, tenantId);
    const sets: string[] = [];
    const params: unknown[] = [tenantId];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col}=$${params.length}`);
    };
    const audited: Record<string, unknown> = { ...d };
    delete audited.rnc;
    delete audited.confirmRncChange;
    if (!('instagram' in raw)) delete audited.instagram;
    if (d.rnc !== undefined && d.rnc !== before.rnc) {
      if (rol !== 'owner') throw new AppError(403, 'Sin permiso', 'Solo el dueño puede cambiar el RNC o la cédula.', 'forbidden');
      const issued = await q.query(
        `SELECT 1 FROM app.factura WHERE tenant_id = $1 AND ncf IS NOT NULL
         UNION ALL
         SELECT 1 FROM app.comprobante_fiscal WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId],
      );
      if (issued.rows.length && d.confirmRncChange !== true) {
        throw new AppError(
          409,
          'Confirma el cambio de RNC',
          'Este negocio ya emitió comprobantes fiscales con el RNC actual. El nuevo RNC se usará en los comprobantes futuros; los ya emitidos no cambian.',
          'rnc_confirm_required',
        );
      }
      // Other businesses are invisible under RLS; the UNIQUE (rnc_hash) constraint rejects duplicates below.
      set('rnc_enc', encryptField(d.rnc));
      set('rnc_hash', hashRnc(d.rnc));
      audited.rncChanged = true;
    }
    if (d.razonSocial !== undefined) set('razon_social', d.razonSocial);
    if (d.tipoNegocio !== undefined) {
      const tipo = resolveBusinessType(d.tipoNegocio);
      set('tipo_negocio', tipo.tipoNegocio);
      set('tipo_negocio_source', tipo.source);
      audited.tipoNegocio = tipo.tipoNegocio;
    }
    if ('instagram' in raw && d.instagram !== (before.instagram?.handle ?? null)) {
      set('instagram_handle', d.instagram);
      set('instagram_connected', false);
      set('instagram_last_synced_at', null);
    }
    if (d.nombreComercial !== undefined) set('nombre_comercial', d.nombreComercial);
    if ('direccion' in raw) set('direccion', d.direccion);
    if (d.ubicacion !== undefined) set('ubicacion', d.ubicacion);
    if ('telefono' in raw) set('telefono', d.telefono);
    if ('email' in raw) set('email', d.email);
    if (d.itbisModo !== undefined) set('itbis_modo', d.itbisModo);
    if (d.itbisTasa !== undefined) set('itbis_tasa', d.itbisTasa);
    if (d.ncfTipoDefault !== undefined) set('ncf_tipo_default', d.ncfTipoDefault);
    if (d.sujetoDgii !== undefined) set('sujeto_dgii', d.sujetoDgii);
    if (d.permiteStockNegativo !== undefined) set('allow_negative_stock', d.permiteStockNegativo);
    if (sets.length) {
      sets.push('updated_at=now()');
      try {
        await q.query(`UPDATE app.negocio SET ${sets.join(',')} WHERE id=$1`, params);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw rncTaken();
        throw e;
      }
      const prev = before as unknown as Record<string, unknown>;
      await appendAudit(q, {
        tenantId,
        action: 'update',
        entity: 'negocio',
        entityId: tenantId,
        before: Object.fromEntries(
          Object.keys(audited).map((k) => [k, k === 'instagram' ? (before.instagram?.handle ?? null) : k === 'rncChanged' ? false : (prev[k] ?? null)]),
        ),
        after: audited,
        authorId,
      });
    }
    return presentBusiness(await loadBusiness(q, tenantId), rol);
  });
}

/* ───────────── NCF sequences ───────────── */

// TODO: VERIFICAR EN VIVO — catálogo oficial de tipos de NCF DGII y su vigencia.
export const NCF_TIPOS: Record<string, string> = {
  B01: 'Crédito fiscal',
  B02: 'Consumidor final',
  B14: 'Régimen especial',
  B15: 'Gubernamental',
};

export const ncfSchema = z
  .object({
    tipo: z.string().regex(/^[BE]\d{2}$/, 'Tipo NCF inválido'),
    descripcion: safeText(2, 80).optional(),
    desde: z.coerce.number().int().min(1).max(99_999_999),
    hasta: z.coerce.number().int().min(1).max(99_999_999),
    vence: z.string().date().nullable().optional(),
    activo: z.boolean().default(true),
  })
  .strict()
  .refine((d) => d.hasta >= d.desde, { message: '"Hasta" debe ser mayor o igual a "desde"', path: ['hasta'] });

export async function listNcf(tenantId: string) {
  return withTenant(tenantId, async (q) => {
    const r = await q.query<{
      tipo: string;
      descripcion: string;
      siguiente: string;
      hasta: string;
      vence: string | Date | null;
      activo: boolean;
    }>(
      `SELECT tipo, descripcion, siguiente::text, hasta::text, vence, activo FROM app.ncf_secuencia WHERE tenant_id=$1 ORDER BY tipo`,
      [tenantId],
    );
    return r.rows.map((x) => ({
      tipo: x.tipo,
      descripcion: x.descripcion,
      siguiente: Number(x.siguiente),
      hasta: Number(x.hasta),
      disponibles: Math.max(Number(x.hasta) - Number(x.siguiente) + 1, 0),
      vence: x.vence ? new Date(x.vence).toISOString().slice(0, 10) : null,
      activo: x.activo,
    }));
  });
}

export async function upsertNcf(tenantId: string, authorId: string, input: unknown) {
  const d = ncfSchema.parse(input);
  return withTenant(tenantId, async (q) => {
    const cur = await q.query<{ siguiente: string }>(
      `SELECT siguiente::text FROM app.ncf_secuencia WHERE tenant_id=$1 AND tipo=$2 FOR UPDATE`,
      [tenantId, d.tipo],
    );
    const used = cur.rows[0] ? Number(cur.rows[0].siguiente) : null;
    if (used !== null && d.desde < used) {
      throw new AppError(
        409,
        'Secuencia ya usada',
        `Ya se emitieron comprobantes hasta ${used - 1}. "Desde" debe ser ${used} o mayor.`,
        'ncf_reuse',
      );
    }
    await q.query(
      `INSERT INTO app.ncf_secuencia (tenant_id, tipo, descripcion, siguiente, hasta, vence, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, tipo) DO UPDATE
         SET descripcion=EXCLUDED.descripcion, siguiente=EXCLUDED.siguiente, hasta=EXCLUDED.hasta,
             vence=EXCLUDED.vence, activo=EXCLUDED.activo`,
      [tenantId, d.tipo, d.descripcion ?? NCF_TIPOS[d.tipo] ?? d.tipo, d.desde, d.hasta, d.vence ?? null, d.activo],
    );
    if (d.activo) {
      await q.query(`UPDATE app.negocio SET ncf_tipo_default=$2 WHERE id=$1 AND ncf_tipo_default IS NULL`, [tenantId, d.tipo]);
    }
    await appendAudit(q, {
      tenantId,
      action: 'upsert',
      entity: 'ncf_secuencia',
      entityId: d.tipo,
      before: used === null ? null : { siguiente: used },
      after: d,
      authorId,
    });
    return { ok: true };
  });
}
