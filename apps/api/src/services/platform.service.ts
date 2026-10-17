import { z } from 'zod';
import { newUuidsV7 } from '@facilito/domain';
import { withPlatformAdmin, type Queryable } from '../db/client.js';
import { forgetSessionsOf } from '../auth/session-status.js';
import { AppError } from '../http/errors.js';
import { likePattern, pagination, safeText, uuidParam } from '../http/validators.js';

export type PlatformAction =
  | 'persona.block'
  | 'persona.unblock'
  | 'negocio.suspend'
  | 'negocio.reactivate'
  | 'suscripcion.autorizar'
  | 'suscripcion.rechazar'
  | 'suscripcion.reenviar'
  | 'suscripcion.pago'
  | 'suscripcion.reembolso'
  | 'suscripcion.plan'
  | 'suscripcion.suspender'
  | 'suscripcion.reactivar'
  | 'suscripcion.cancelar'
  | 'suscripcion.asignar'
  | 'suscripcion.comprobante'
  | 'suscripcion.barrido'
  | 'billing.planes_seed';

const FORBIDDEN = () => new AppError(403, 'Sin permiso', 'Esta sección es solo para administradores de Facilito.', 'forbidden');

/** The database is the authority: a stale token claim cannot outlive removal from identity.platform_admin. */
export async function asPlatformAdmin<T>(actorId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatformAdmin(actorId, async (q) => {
    const r = await q.query<{ ok: boolean }>('SELECT app.is_platform_admin() AS ok');
    if (!r.rows[0]?.ok) throw FORBIDDEN();
    return fn(q);
  });
}

/** Append-only (trigger + RLS). Needs the platform context: app.platform = '1' and app.persona_id = actor. */
export async function log(q: Queryable, actorId: string, action: PlatformAction, targetId: string, detail: Record<string, unknown>, ip: string) {
  await q.query(
    `INSERT INTO audit.platform_log (id, actor_id, action, target_id, detail, ip) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [newUuidsV7(), actorId, action, targetId, JSON.stringify(detail), ip],
  );
}

const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

/* ───────────── Overview ───────────── */

export async function stats(actorId: string) {
  return asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<Record<string, number>>(
      `SELECT
         (SELECT count(*) FROM identity.persona)::int AS usuarios,
         (SELECT count(*) FROM identity.persona WHERE created_at > now() - interval '30 days')::int AS usuarios_nuevos_30d,
         (SELECT count(*) FROM identity.persona WHERE bloqueado_at IS NOT NULL)::int AS usuarios_bloqueados,
         (SELECT count(DISTINCT persona_id) FROM identity.refresh_token WHERE created_at > now() - interval '7 days')::int AS activos_7d,
         (SELECT count(*) FROM app.negocio WHERE NOT es_plataforma)::int AS negocios,
         (SELECT count(*) FROM app.negocio WHERE NOT es_plataforma AND created_at > now() - interval '30 days')::int AS negocios_nuevos_30d,
         (SELECT count(*) FROM app.negocio WHERE NOT es_plataforma AND estado = 'suspendido')::int AS negocios_suspendidos,
         (SELECT count(*) FROM billing.suscripcion WHERE estado = 'PENDIENTE_AUTORIZACION')::int AS solicitudes_pendientes,
         (SELECT count(*) FROM billing.comprobante c
           WHERE NOT EXISTS (SELECT 1 FROM billing.comprobante_revision r WHERE r.comprobante_id = c.id)
             AND EXISTS (SELECT 1 FROM billing.suscripcion s WHERE s.id = c.suscripcion_id AND s.tenant_id IS NOT NULL))::int AS comprobantes_pendientes`,
    );
    const s = r.rows[0]!;
    return {
      usuarios: s.usuarios,
      usuariosNuevos30d: s.usuarios_nuevos_30d,
      usuariosBloqueados: s.usuarios_bloqueados,
      activos7d: s.activos_7d,
      negocios: s.negocios,
      negociosNuevos30d: s.negocios_nuevos_30d,
      negociosSuspendidos: s.negocios_suspendidos,
      solicitudesPendientes: s.solicitudes_pendientes,
      comprobantesPendientes: s.comprobantes_pendientes,
    };
  });
}

/* ───────────── People ───────────── */

const listQuery = pagination.extend({
  q: z.string().max(100).optional().default(''),
  estado: z.enum(['todos', 'activos', 'bloqueados']).default('todos'),
});

interface UserRow {
  id: string;
  email: string;
  nombre: string | null;
  created_at: Date | string;
  bloqueado_at: Date | string | null;
  bloqueado_motivo: string | null;
  totp_enabled: boolean;
  platform_admin: boolean;
  ultima_sesion: Date | string | null;
  negocios: Array<{ tenantId: string; negocio: string; rol: string; estado: string }> | string;
  total: number;
}

export async function listUsers(actorId: string, query: unknown) {
  const { q: search, estado, page, pageSize } = listQuery.parse(query);
  const term = search.trim().toLowerCase();
  return asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<UserRow & Record<string, unknown>>(
      `SELECT p.id, p.email, p.nombre, p.created_at, p.bloqueado_at, p.bloqueado_motivo, p.totp_enabled,
              EXISTS (SELECT 1 FROM identity.platform_admin x WHERE x.persona_id = p.id) AS platform_admin,
              (SELECT max(t.created_at) FROM identity.refresh_token t WHERE t.persona_id = p.id) AS ultima_sesion,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'tenantId', n.id, 'negocio', coalesce(n.nombre_comercial, n.razon_social),
                         'rol', a.rol, 'estado', n.estado) ORDER BY a.created_at)
                  FROM app.acceso a JOIN app.negocio n ON n.id = a.tenant_id
                 WHERE a.persona_id = p.id AND NOT n.es_plataforma
              ), '[]'::json) AS negocios,
              count(*) OVER ()::int AS total
         FROM identity.persona p
        WHERE ($1 = '' OR lower(p.email) LIKE $2 OR lower(coalesce(p.nombre, '')) LIKE $2)
          AND ($3 = 'todos' OR ($3 = 'bloqueados') = (p.bloqueado_at IS NOT NULL))
        ORDER BY p.created_at DESC, p.id
        LIMIT $4 OFFSET $5`,
      [term, likePattern(term), estado, pageSize, (page - 1) * pageSize],
    );
    return {
      items: r.rows.map((u) => ({
        id: u.id,
        email: u.email,
        nombre: u.nombre,
        createdAt: iso(u.created_at),
        bloqueadoAt: iso(u.bloqueado_at),
        bloqueadoMotivo: u.bloqueado_motivo,
        totpEnabled: u.totp_enabled,
        platformAdmin: u.platform_admin,
        ultimaSesion: iso(u.ultima_sesion),
        negocios: typeof u.negocios === 'string' ? JSON.parse(u.negocios) : u.negocios,
      })),
      total: r.rows[0]?.total ?? 0,
      page,
      pageSize,
    };
  });
}

const reasonBody = z.object({ motivo: safeText(3, 500) }).strict();

export async function blockUser(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const { motivo } = reasonBody.parse(body);
  if (id === actorId) throw new AppError(409, 'Acción no permitida', 'No puedes bloquear tu propia cuenta.', 'self_block');
  const result = await asPlatformAdmin(actorId, async (q) => {
    const t = await q.query<{ bloqueado_at: Date | string | null; platform_admin: boolean }>(
      `SELECT bloqueado_at, EXISTS (SELECT 1 FROM identity.platform_admin x WHERE x.persona_id = p.id) AS platform_admin
         FROM identity.persona p WHERE p.id = $1`,
      [id],
    );
    const target = t.rows[0];
    if (!target) throw new AppError(404, 'No encontrado', 'El usuario no existe.', 'not_found');
    if (target.platform_admin) {
      throw new AppError(409, 'Acción no permitida', 'Los administradores de la plataforma no se pueden bloquear desde el panel.', 'protected');
    }
    if (target.bloqueado_at) return { id, bloqueadoAt: iso(target.bloqueado_at) };
    const u = await q.query<{ bloqueado_at: Date | string }>(
      `UPDATE identity.persona SET bloqueado_at = now(), bloqueado_motivo = $2, updated_at = now() WHERE id = $1 RETURNING bloqueado_at`,
      [id, motivo],
    );
    await q.query(`UPDATE identity.refresh_token SET revoked_at = now() WHERE persona_id = $1 AND revoked_at IS NULL`, [id]);
    await log(q, actorId, 'persona.block', id, { motivo }, ip);
    return { id, bloqueadoAt: iso(u.rows[0]!.bloqueado_at) };
  });
  forgetSessionsOf({ personaId: id });
  return result;
}

export async function unblockUser(actorId: string, params: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  return asPlatformAdmin(actorId, async (q) => {
    const u = await q.query<{ id: string; was_blocked: boolean }>(
      `UPDATE identity.persona p SET bloqueado_at = NULL, bloqueado_motivo = NULL, updated_at = now()
         FROM (SELECT id, bloqueado_at IS NOT NULL AS was_blocked FROM identity.persona WHERE id = $1) old
        WHERE p.id = old.id
        RETURNING p.id, old.was_blocked`,
      [id],
    );
    if (!u.rows[0]) throw new AppError(404, 'No encontrado', 'El usuario no existe.', 'not_found');
    if (u.rows[0].was_blocked) await log(q, actorId, 'persona.unblock', id, {}, ip);
    return { id, bloqueadoAt: null };
  });
}

/* ───────────── Businesses ───────────── */

interface BusinessRow {
  id: string;
  razon_social: string;
  nombre_comercial: string | null;
  tipo_negocio: string | null;
  plan: string;
  estado: string;
  suspendido_motivo: string | null;
  created_at: Date | string;
  owner_email: string | null;
  owner_nombre: string | null;
  miembros: number;
  suscripcion_id: string | null;
  suscripcion_estado: string | null;
  total: number;
}

const businessQuery = pagination.extend({
  q: z.string().max(100).optional().default(''),
  estado: z.enum(['todos', 'activo', 'suspendido']).default('todos'),
});

export async function listBusinesses(actorId: string, query: unknown) {
  const { q: search, estado, page, pageSize } = businessQuery.parse(query);
  const term = search.trim().toLowerCase();
  return asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<BusinessRow & Record<string, unknown>>(
      `SELECT n.id, n.razon_social, n.nombre_comercial, n.tipo_negocio, n.plan, n.estado, n.suspendido_motivo, n.created_at,
              o.email AS owner_email, o.nombre AS owner_nombre,
              (SELECT count(*) FROM app.acceso a WHERE a.tenant_id = n.id AND a.estado = 'active')::int AS miembros,
              (SELECT s.id FROM billing.suscripcion s WHERE s.tenant_id = n.id) AS suscripcion_id,
              (SELECT s.estado FROM billing.suscripcion s WHERE s.tenant_id = n.id) AS suscripcion_estado,
              count(*) OVER ()::int AS total
         FROM app.negocio n
         LEFT JOIN LATERAL (
           SELECT p.email, p.nombre FROM app.acceso a JOIN identity.persona p ON p.id = a.persona_id
            WHERE a.tenant_id = n.id AND a.rol = 'owner' ORDER BY a.created_at LIMIT 1
         ) o ON true
        WHERE NOT n.es_plataforma
          AND ($1 = '' OR lower(n.razon_social) LIKE $2 OR lower(coalesce(n.nombre_comercial, '')) LIKE $2
               OR lower(coalesce(o.email, '')) LIKE $2)
          AND ($3 = 'todos' OR n.estado = $3)
        ORDER BY n.created_at DESC, n.id
        LIMIT $4 OFFSET $5`,
      [term, likePattern(term), estado, pageSize, (page - 1) * pageSize],
    );
    return {
      items: r.rows.map((b) => ({
        id: b.id,
        razonSocial: b.razon_social,
        nombreComercial: b.nombre_comercial,
        tipoNegocio: b.tipo_negocio,
        plan: b.plan,
        estado: b.estado,
        suspendidoMotivo: b.suspendido_motivo,
        createdAt: iso(b.created_at),
        ownerEmail: b.owner_email,
        ownerNombre: b.owner_nombre,
        miembros: b.miembros,
        suscripcionId: b.suscripcion_id,
        suscripcionEstado: b.suscripcion_estado,
      })),
      total: r.rows[0]?.total ?? 0,
      page,
      pageSize,
    };
  });
}

async function setBusinessState(
  actorId: string,
  params: unknown,
  next: 'activo' | 'suspendido',
  motivo: string | null,
  ip: string,
) {
  const { id } = uuidParam.parse(params);
  const result = await asPlatformAdmin(actorId, async (q) => {
    const cur = await q.query<{ estado: string; es_plataforma: boolean }>(`SELECT estado, es_plataforma FROM app.negocio WHERE id = $1`, [id]);
    const row = cur.rows[0];
    if (!row) throw new AppError(404, 'No encontrado', 'El negocio no existe.', 'not_found');
    if (row.es_plataforma) throw new AppError(409, 'Acción no permitida', 'El espacio de administración no se puede suspender.', 'protected');
    if (row.estado === next) return { id, estado: next };
    await q.query(`UPDATE app.negocio SET estado = $2, suspendido_motivo = $3, updated_at = now() WHERE id = $1`, [id, next, motivo]);
    await log(q, actorId, next === 'suspendido' ? 'negocio.suspend' : 'negocio.reactivate', id, motivo ? { motivo } : {}, ip);
    return { id, estado: next };
  });
  forgetSessionsOf({ tenantId: id });
  return result;
}

export async function suspendBusiness(actorId: string, params: unknown, body: unknown, ip: string) {
  const { motivo } = reasonBody.parse(body);
  return setBusinessState(actorId, params, 'suspendido', motivo, ip);
}

export async function reactivateBusiness(actorId: string, params: unknown, ip: string) {
  return setBusinessState(actorId, params, 'activo', null, ip);
}

/* ───────────── Activity ───────────── */

export async function activity(actorId: string) {
  return asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<{
      id: string;
      action: PlatformAction;
      target_id: string;
      detail: Record<string, unknown> | string;
      created_at: Date | string;
      actor_email: string;
      target_label: string | null;
    }>(
      `SELECT l.id, l.action, l.target_id, l.detail, l.created_at, a.email AS actor_email,
              coalesce(tp.email, tn.nombre_comercial, tn.razon_social, ts.razon_social) AS target_label
         FROM audit.platform_log l
         JOIN identity.persona a ON a.id = l.actor_id
         LEFT JOIN identity.persona tp ON tp.id = l.target_id
         LEFT JOIN app.negocio tn ON tn.id = l.target_id
         LEFT JOIN billing.suscripcion ts ON ts.id = l.target_id
        ORDER BY l.created_at DESC
        LIMIT 100`,
    );
    return {
      items: r.rows.map((e) => ({
        id: e.id,
        action: e.action,
        targetId: e.target_id,
        targetLabel: e.target_label,
        detail: typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail,
        actorEmail: e.actor_email,
        createdAt: iso(e.created_at),
      })),
    };
  });
}
