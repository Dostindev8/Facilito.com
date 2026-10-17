import { z } from 'zod';
import { effectiveSubscriptionState, newUuidsV7, type RoleCode, type SubscriptionState } from '@facilito/domain';
import { withAuthBootstrap, withPersona, type Queryable } from '../db/client.js';
import {
  hashPassword,
  verifyPassword,
  verifyAgainstDummy,
  signAccessToken,
  newRefreshTokenValue,
  hashRefresh,
  verifyTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
} from '../auth/tokens.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { AppError } from '../http/errors.js';
import { getEnv } from '../config/env.js';
import { counterGet, counterIncr, counterReset } from '../utils/cache.js';
import { forgetSessionsOf } from '../auth/session-status.js';
import { emailProviderConfigured, MailDeliveryError, sendPasswordResetEmail } from './mailer.js';

const SHORT_SESSION_SECONDS = 12 * 60 * 60;

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128, 'Máximo 128 caracteres')
  .refine((p) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(p) && /\d/.test(p), 'Usa letras y números');

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email inválido')
  .max(320);

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string().min(1, 'Ingresa tu contraseña').max(128),
    totp: z
      .string()
      .regex(/^\d{6}$/, 'Código de 6 dígitos')
      .optional(),
    tenantId: z.string().uuid().optional(),
    recordarme: z.boolean().default(false),
  })
  .strict();

/** Where the session was opened from, for the "active sessions" list. Never used for authorization. */
export interface DeviceHint {
  userAgent?: string | null;
  ip?: string | null;
}

export interface SessionResult {
  accessToken: string;
  refresh: { raw: string; maxAgeSeconds: number | null };
  user: SessionUser;
}

export interface SubscriptionSummary {
  estado: SubscriptionState;
  plan: string;
  periodoFin: string | null;
  cancelarAlFinal: boolean;
  soloLectura: boolean;
}

export interface SessionUser {
  personaId: string;
  nombre: string;
  email: string;
  tenantId: string;
  accesoId: string;
  rol: RoleCode;
  negocio: string;
  businesses: Array<{ tenantId: string; rol: RoleCode; razonSocial: string }>;
  platformAdmin: boolean;
  mfa: boolean;
  suscripcion: SubscriptionSummary | null;
}

interface AccesoRow {
  id: string;
  tenant_id: string;
  rol: RoleCode;
  razon_social: string;
  nombre_comercial: string | null;
  display_name: string | null;
}

async function loadAccesos(q: Queryable, personaId: string): Promise<AccesoRow[]> {
  const r = await q.query<AccesoRow & Record<string, unknown>>(
    `SELECT a.id, a.tenant_id, a.rol, n.razon_social, n.nombre_comercial, a.display_name
       FROM app.acceso a
       JOIN app.negocio n ON n.id = a.tenant_id
       JOIN identity.persona p ON p.id = a.persona_id
      WHERE a.persona_id = $1 AND a.estado = 'active' AND n.estado = 'activo' AND p.bloqueado_at IS NULL
      ORDER BY n.es_plataforma DESC, a.created_at`,
    [personaId],
  );
  return r.rows;
}

/** Needs app.persona_id set to `personaId` (the membership table is readable only by its own row). */
async function isPlatformAdmin(q: Queryable, personaId: string): Promise<boolean> {
  const r = await q.query('SELECT 1 FROM identity.platform_admin WHERE persona_id = $1', [personaId]);
  return r.rows.length > 0;
}

/** Readable in the system context and by the business itself (RLS). Businesses from before paid plans have none. */
export async function loadSubscriptionSummary(q: Queryable, tenantId: string): Promise<SubscriptionSummary | null> {
  const r = await q.query<{ estado: SubscriptionState; plan: string; periodo_fin: Date | string | null; cancelar_al_final: boolean }>(
    `SELECT s.estado, p.nombre AS plan, s.periodo_fin, s.cancelar_al_final
       FROM billing.suscripcion s JOIN billing.plan p ON p.id = s.plan_id
      WHERE s.tenant_id = $1`,
    [tenantId],
  );
  const s = r.rows[0];
  if (!s) return null;
  const fin = s.periodo_fin ? new Date(s.periodo_fin) : null;
  const estado = effectiveSubscriptionState(s.estado, fin, s.cancelar_al_final);
  return {
    estado,
    plan: s.plan,
    periodoFin: fin?.toISOString() ?? null,
    cancelarAlFinal: s.cancelar_al_final,
    soloLectura: estado === 'SUSPENDIDA' || estado === 'CANCELADA',
  };
}

export const ACCOUNT_BLOCKED = () =>
  new AppError(403, 'Cuenta suspendida', 'Tu cuenta está suspendida. Escríbenos a soporte si crees que es un error.', 'account_blocked');

interface IssueOptions {
  familyId?: string;
  mfa: boolean;
  device?: DeviceHint;
}

const clip = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : null);

async function issueSession(
  q: Queryable,
  persona: { id: string; email: string; nombre: string | null },
  accesos: AccesoRow[],
  chosen: AccesoRow,
  remember: boolean,
  opts: IssueOptions,
): Promise<SessionResult> {
  const env = getEnv();
  const ttl = remember ? env.JWT_REFRESH_TTL_SECONDS : SHORT_SESSION_SECONDS;
  const refresh = newRefreshTokenValue();
  const familyId = opts.familyId ?? refresh.familyId;
  await q.query(
    `INSERT INTO identity.refresh_token (id, persona_id, family_id, token_hash, expires_at, tenant_id, remember, mfa, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      refresh.id,
      persona.id,
      familyId,
      refresh.hash,
      new Date(Date.now() + ttl * 1000).toISOString(),
      chosen.tenant_id,
      remember,
      opts.mfa,
      clip(opts.device?.userAgent, 300),
      clip(opts.device?.ip, 64),
    ],
  );
  const platformAdmin = await isPlatformAdmin(q, persona.id);
  const accessToken = await signAccessToken({
    sub: persona.id,
    tenantId: chosen.tenant_id,
    accesoId: chosen.id,
    rol: chosen.rol,
    platformAdmin,
    mfa: opts.mfa,
    sid: familyId,
  });
  return {
    accessToken,
    refresh: { raw: refresh.raw, maxAgeSeconds: remember ? ttl : null },
    user: {
      personaId: persona.id,
      nombre: chosen.display_name ?? persona.nombre ?? persona.email.split('@')[0]!,
      email: persona.email,
      tenantId: chosen.tenant_id,
      accesoId: chosen.id,
      rol: chosen.rol,
      negocio: chosen.nombre_comercial ?? chosen.razon_social,
      businesses: accesos.map((a) => ({
        tenantId: a.tenant_id,
        rol: a.rol,
        razonSocial: a.nombre_comercial ?? a.razon_social,
      })),
      platformAdmin,
      mfa: opts.mfa,
      suscripcion: await loadSubscriptionSummary(q, chosen.tenant_id),
    },
  };
}

/* ───────────── Login with progressive lockout ───────────── */

const MAX_LOCK_SECONDS = 24 * 60 * 60;
/** Covers the ±1 step verification window (3 × 30 s) with margin. */
const TOTP_REPLAY_TTL_SECONDS = 120;

function lockKeys(email: string, ip: string) {
  const h = sha256(email);
  return { emailKey: `login:e:${h}`, lockKey: `login:lock:${h}`, levelKey: `login:lvl:${h}`, ipKey: `login:ip:${ip}` };
}

/** Each lock within 24 h doubles the previous one: 15 min, 30 min, 1 h … capped at 24 h. */
function lockSecondsFor(level: number): number {
  const base = getEnv().LOGIN_LOCK_SECONDS;
  return Math.min(base * 2 ** Math.max(level - 1, 0), MAX_LOCK_SECONDS);
}

function lockedError(seconds: number): AppError {
  const minutes = Math.ceil(seconds / 60);
  const when = minutes >= 120 ? `${Math.ceil(minutes / 60)} horas` : `${minutes} minutos`;
  return new AppError(429, 'Cuenta bloqueada temporalmente', `Demasiados intentos fallidos. Intenta de nuevo en ${when}.`, 'locked', {
    retryAfterSeconds: seconds,
  });
}

export async function login(input: unknown, ip: string, device: DeviceHint = {}): Promise<SessionResult> {
  const data = loginSchema.parse(input);
  const env = getEnv();
  const keys = lockKeys(data.email, ip);
  const [locked, ipFails, level] = await Promise.all([counterGet(keys.lockKey), counterGet(keys.ipKey), counterGet(keys.levelKey)]);
  if (locked > 0) throw lockedError(lockSecondsFor(level));
  if (ipFails >= env.LOGIN_MAX_FAILURES * 4) throw lockedError(env.LOGIN_LOCK_SECONDS);

  const fail = async (): Promise<never> => {
    const [fails] = await Promise.all([counterIncr(keys.emailKey, env.LOGIN_LOCK_SECONDS), counterIncr(keys.ipKey, env.LOGIN_LOCK_SECONDS)]);
    if (fails >= env.LOGIN_MAX_FAILURES) {
      const lvl = await counterIncr(keys.levelKey, MAX_LOCK_SECONDS);
      await counterIncr(keys.lockKey, lockSecondsFor(lvl));
      await counterReset(keys.emailKey);
    }
    throw new AppError(401, 'Credenciales inválidas', 'Email o contraseña incorrectos.', 'auth');
  };

  const persona = await withAuthBootstrap(async (q) => {
    const r = await q.query<{
      id: string;
      email: string;
      nombre: string | null;
      password_hash: string;
      totp_enabled: boolean;
      totp_secret_enc: string | null;
      bloqueado_at: Date | string | null;
    }>(
      `SELECT id, email, nombre, password_hash, totp_enabled, totp_secret_enc, bloqueado_at
         FROM identity.persona WHERE lower(email) = $1`,
      [data.email],
    );
    return r.rows[0] ?? null;
  });
  if (!persona) {
    await verifyAgainstDummy(data.password);
    return fail();
  }
  if (!(await verifyPassword(persona.password_hash, data.password))) return fail();
  let mfa = false;
  if (persona.totp_enabled) {
    if (!data.totp || !persona.totp_secret_enc) {
      throw new AppError(401, '2FA requerido', 'Ingresa el código de tu app de autenticación.', 'totp_required');
    }
    if (!verifyTotp(decryptTotpSecret(persona.totp_secret_enc), data.totp)) return fail();
    // A code stays valid for the whole verification window; once used it must not open a second session.
    if ((await counterIncr(`totp:used:${persona.id}:${data.totp}`, TOTP_REPLAY_TTL_SECONDS)) > 1) return fail();
    mfa = true;
  }
  // Only revealed after the password proved ownership, so it cannot be used to probe accounts.
  if (persona.bloqueado_at) throw ACCOUNT_BLOCKED();
  await counterReset(keys.emailKey);

  return withPersona(
    persona.id,
    async (q) => {
      const accesos = await loadAccesos(q, persona.id);
      if (!accesos.length) throw new AppError(403, 'Sin negocios', 'No tienes acceso activo a ningún negocio.', 'no_tenant');
      const chosen = data.tenantId ? accesos.find((a) => a.tenant_id === data.tenantId) : accesos[0];
      if (!chosen) throw new AppError(403, 'Sin acceso', 'No tienes acceso a ese negocio.', 'forbidden');
      return issueSession(q, persona, accesos, chosen, data.recordarme, { mfa, device: { ...device, ip } });
    },
    { authBootstrap: true },
  );
}

/** Rotates the refresh token. Reuse of a revoked token revokes the whole family (theft signal). */
export async function refreshSession(rawRefresh: string | undefined): Promise<SessionResult> {
  if (!rawRefresh || rawRefresh.length > 200) {
    throw new AppError(401, 'Sesión inválida', 'Inicia sesión de nuevo.', 'refresh');
  }
  const hash = hashRefresh(rawRefresh);
  const outcome = await withAuthBootstrap(async (q) => {
    const r = await q.query<{
      id: string;
      persona_id: string;
      family_id: string;
      expires_at: Date | string;
      revoked_at: Date | string | null;
      tenant_id: string | null;
      remember: boolean;
      mfa: boolean;
      user_agent: string | null;
      ip: string | null;
    }>(
      `SELECT id, persona_id, family_id, expires_at, revoked_at, tenant_id, remember, mfa, user_agent, ip
         FROM identity.refresh_token WHERE token_hash = $1 FOR UPDATE`,
      [hash],
    );
    const tok = r.rows[0];
    if (!tok) return { kind: 'invalid' as const };
    if (tok.revoked_at) {
      await q.query(
        `UPDATE identity.refresh_token SET revoked_at = coalesce(revoked_at, now()), reused_at = now() WHERE family_id = $1`,
        [tok.family_id],
      );
      return { kind: 'reuse' as const };
    }
    if (new Date(tok.expires_at).getTime() < Date.now()) return { kind: 'expired' as const };
    await q.query(`UPDATE identity.refresh_token SET revoked_at = now() WHERE id = $1`, [tok.id]);
    const p = await q.query<{ id: string; email: string; nombre: string | null; bloqueado_at: Date | string | null }>(
      `SELECT id, email, nombre, bloqueado_at FROM identity.persona WHERE id = $1`,
      [tok.persona_id],
    );
    if (p.rows[0]?.bloqueado_at) return { kind: 'blocked' as const };
    await q.query(`SELECT set_config('app.persona_id', $1, true)`, [tok.persona_id]);
    const accesos = await loadAccesos(q, tok.persona_id);
    const chosen = accesos.find((a) => a.tenant_id === tok.tenant_id) ?? accesos[0];
    if (!chosen || !p.rows[0]) return { kind: 'no_tenant' as const };
    return {
      kind: 'ok' as const,
      session: await issueSession(q, p.rows[0], accesos, chosen, tok.remember, {
        familyId: tok.family_id,
        mfa: tok.mfa,
        device: { userAgent: tok.user_agent, ip: tok.ip },
      }),
    };
  });
  switch (outcome.kind) {
    case 'ok':
      return outcome.session;
    case 'reuse':
      throw new AppError(401, 'Sesión cerrada por seguridad', 'Detectamos un uso repetido de tu sesión. Inicia sesión de nuevo.', 'refresh_reuse');
    case 'expired':
      throw new AppError(401, 'Sesión expirada', 'Inicia sesión de nuevo.', 'refresh');
    case 'blocked':
      throw ACCOUNT_BLOCKED();
    case 'no_tenant':
      throw new AppError(403, 'Sin negocios', 'No tienes acceso activo a ningún negocio.', 'no_tenant');
    default:
      throw new AppError(401, 'Sesión inválida', 'Inicia sesión de nuevo.', 'refresh');
  }
}

export async function logout(rawRefresh: string | undefined): Promise<void> {
  if (!rawRefresh || rawRefresh.length > 200) return;
  const hash = hashRefresh(rawRefresh);
  await withAuthBootstrap(async (q) => {
    await q.query(
      `UPDATE identity.refresh_token SET revoked_at = coalesce(revoked_at, now())
        WHERE family_id = (SELECT family_id FROM identity.refresh_token WHERE token_hash = $1)`,
      [hash],
    );
  });
}

export async function switchTenant(personaId: string, tenantId: string, rawRefresh: string | undefined): Promise<SessionResult> {
  if (!z.string().uuid().safeParse(tenantId).success) {
    throw new AppError(400, 'Negocio inválido', 'Identificador de negocio inválido.', 'validation');
  }
  return withPersona(
    personaId,
    async (q) => {
      const accesos = await loadAccesos(q, personaId);
      const chosen = accesos.find((a) => a.tenant_id === tenantId);
      if (!chosen) throw new AppError(403, 'Sin acceso', 'No tienes acceso a ese negocio.', 'forbidden');
      const p = await q.query<{ id: string; email: string; nombre: string | null }>(
        `SELECT id, email, nombre FROM identity.persona WHERE id = $1`,
        [personaId],
      );
      let remember = false;
      let familyId: string | undefined;
      let mfa = false;
      let device: DeviceHint = {};
      if (rawRefresh) {
        const cur = await q.query<{ id: string; family_id: string; remember: boolean; mfa: boolean; user_agent: string | null; ip: string | null }>(
          `SELECT id, family_id, remember, mfa, user_agent, ip FROM identity.refresh_token
            WHERE token_hash = $1 AND persona_id = $2 AND revoked_at IS NULL`,
          [hashRefresh(rawRefresh), personaId],
        );
        if (cur.rows[0]) {
          remember = cur.rows[0].remember;
          familyId = cur.rows[0].family_id;
          mfa = cur.rows[0].mfa;
          device = { userAgent: cur.rows[0].user_agent, ip: cur.rows[0].ip };
          await q.query(`UPDATE identity.refresh_token SET revoked_at = now() WHERE id = $1`, [cur.rows[0].id]);
        }
      }
      return issueSession(q, p.rows[0]!, accesos, chosen, remember, { familyId, mfa, device });
    },
    { tenantId },
  );
}

export async function me(personaId: string, tenantId: string, mfa = false) {
  return withPersona(
    personaId,
    async (q) => {
      const p = await q.query<{ email: string; nombre: string | null; totp_enabled: boolean }>(
        `SELECT email, nombre, totp_enabled FROM identity.persona WHERE id = $1`,
        [personaId],
      );
      const accesos = await loadAccesos(q, personaId);
      const current = accesos.find((a) => a.tenant_id === tenantId);
      if (!p.rows[0] || !current) throw new AppError(401, 'No autorizado', 'Inicia sesión de nuevo.', 'unauthorized');
      const pending = await q.query<{ new_email: string }>(
        `SELECT new_email FROM identity.email_change
          WHERE persona_id = $1 AND used_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1`,
        [personaId],
      );
      return {
        personaId,
        nombre: current.display_name ?? p.rows[0].nombre ?? p.rows[0].email.split('@')[0],
        email: p.rows[0].email,
        pendingEmail: pending.rows[0]?.new_email ?? null,
        totpEnabled: p.rows[0].totp_enabled,
        tenantId,
        accesoId: current.id,
        rol: current.rol,
        negocio: current.nombre_comercial ?? current.razon_social,
        businesses: accesos.map((a) => ({ tenantId: a.tenant_id, rol: a.rol, razonSocial: a.nombre_comercial ?? a.razon_social })),
        platformAdmin: await isPlatformAdmin(q, personaId),
        mfa,
        suscripcion: await loadSubscriptionSummary(q, tenantId),
      };
    },
    { tenantId },
  );
}

/* ───────────── Active sessions ───────────── */

export async function listSessions(personaId: string, rawRefresh: string | undefined) {
  const currentHash = rawRefresh && rawRefresh.length <= 200 ? hashRefresh(rawRefresh) : '';
  return withPersona(personaId, async (q) => {
    const r = await q.query<{
      family_id: string;
      started_at: Date | string;
      last_seen: Date | string;
      expires_at: Date | string;
      user_agent: string | null;
      ip: string | null;
      current: boolean;
    }>(
      `SELECT family_id, min(created_at) AS started_at, max(created_at) AS last_seen, max(expires_at) AS expires_at,
              (array_agg(user_agent ORDER BY created_at DESC))[1] AS user_agent,
              (array_agg(ip ORDER BY created_at DESC))[1] AS ip,
              bool_or(token_hash = $2 AND revoked_at IS NULL) AS current
         FROM identity.refresh_token
        WHERE persona_id = $1
        GROUP BY family_id
       HAVING bool_or(revoked_at IS NULL AND expires_at > now())
        ORDER BY max(created_at) DESC
        LIMIT 50`,
      [personaId, currentHash],
    );
    return {
      items: r.rows.map((s) => ({
        id: s.family_id,
        inicio: new Date(s.started_at).toISOString(),
        ultimaActividad: new Date(s.last_seen).toISOString(),
        vence: new Date(s.expires_at).toISOString(),
        dispositivo: s.user_agent,
        ip: s.ip,
        actual: s.current,
      })),
    };
  });
}

export async function revokeSession(personaId: string, params: unknown): Promise<void> {
  const { id } = z.object({ id: z.string().uuid('Identificador inválido') }).parse(params);
  const n = await withPersona(personaId, async (q) => {
    const r = await q.query(
      `UPDATE identity.refresh_token SET revoked_at = now() WHERE persona_id = $1 AND family_id = $2 AND revoked_at IS NULL`,
      [personaId, id],
    );
    return r.rowCount;
  });
  if (!n) throw new AppError(404, 'No encontrada', 'La sesión no existe o ya estaba cerrada.', 'not_found');
  forgetSessionsOf({ personaId });
}

/** Signs out every other device; the current family keeps working. */
export async function revokeOtherSessions(personaId: string, rawRefresh: string | undefined): Promise<{ cerradas: number }> {
  const currentHash = rawRefresh && rawRefresh.length <= 200 ? hashRefresh(rawRefresh) : '';
  const cerradas = await withPersona(personaId, async (q) => {
    const r = await q.query(
      `UPDATE identity.refresh_token SET revoked_at = now()
        WHERE persona_id = $1 AND revoked_at IS NULL
          AND family_id IS DISTINCT FROM (SELECT family_id FROM identity.refresh_token WHERE token_hash = $2 AND persona_id = $1)`,
      [personaId, currentHash],
    );
    return r.rowCount;
  });
  forgetSessionsOf({ personaId });
  return { cerradas };
}

/* ───────────── Invitation acceptance (the only way an account gets a password) ───────────── */

const invitationToken = z.object({ token: z.string().min(20).max(200) }).strict();

const INVITATION_INVALID = () =>
  new AppError(400, 'Invitación inválida', 'El enlace expiró, ya se usó o fue reemplazado. Pide al equipo de Facilito que te reenvíe la invitación.', 'invitation_invalid');

export async function inspectInvitation(input: unknown) {
  const { token } = invitationToken.parse(input);
  const row = await withAuthBootstrap(async (q) => {
    const r = await q.query<{ email: string; nombre: string | null; negocio: string; plan: string; expires_at: Date | string }>(
      `SELECT p.email, p.nombre, s.razon_social AS negocio, pl.nombre AS plan, i.expires_at
         FROM billing.invitacion i
         JOIN identity.persona p ON p.id = i.persona_id
         JOIN billing.suscripcion s ON s.id = i.suscripcion_id
         JOIN billing.plan pl ON pl.id = s.plan_id
        WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
      [sha256(token)],
    );
    return r.rows[0] ?? null;
  });
  if (!row) throw INVITATION_INVALID();
  return { email: row.email, nombre: row.nombre, negocio: row.negocio, plan: row.plan, vence: new Date(row.expires_at).toISOString() };
}

export async function acceptInvitation(input: unknown, device: DeviceHint = {}): Promise<SessionResult> {
  const d = z
    .object({ token: z.string().min(20).max(200), password: passwordSchema, recordarme: z.boolean().default(false) })
    .strict()
    .parse(input);
  const passwordHash = await hashPassword(d.password);
  const result = await withAuthBootstrap(async (q) => {
    const used = await q.query<{ persona_id: string; suscripcion_id: string }>(
      `UPDATE billing.invitacion SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING persona_id, suscripcion_id`,
      [sha256(d.token)],
    );
    const inv = used.rows[0];
    if (!inv) return null;
    await q.query(`UPDATE identity.persona SET password_hash = $2, updated_at = now() WHERE id = $1`, [inv.persona_id, passwordHash]);
    await q.query(
      `INSERT INTO billing.evento (id, suscripcion_id, evento, de, a, actor_id, detalle)
       SELECT $1, s.id, 'invitacion_aceptada', s.estado, s.estado, $2, '{}'::jsonb FROM billing.suscripcion s WHERE s.id = $3`,
      [newUuidsV7(), inv.persona_id, inv.suscripcion_id],
    );
    const p = await q.query<{ id: string; email: string; nombre: string | null; bloqueado_at: Date | string | null }>(
      `SELECT id, email, nombre, bloqueado_at FROM identity.persona WHERE id = $1`,
      [inv.persona_id],
    );
    const persona = p.rows[0]!;
    if (persona.bloqueado_at) throw ACCOUNT_BLOCKED();
    await q.query(`SELECT set_config('app.persona_id', $1, true)`, [persona.id]);
    const accesos = await loadAccesos(q, persona.id);
    if (!accesos.length) throw new AppError(403, 'Sin negocios', 'Tu negocio no está activo. Escríbenos a soporte.', 'no_tenant');
    return issueSession(q, persona, accesos, accesos[0]!, d.recordarme, { mfa: false, device });
  });
  if (!result) throw INVITATION_INVALID();
  return result;
}

/* ───────────── Password reset ───────────── */

const RESET_TTL_MINUTES = 30;

// SMTP round trips take ~1-3 s; answering every request no sooner than this hides whether the account exists.
const RESET_RESPONSE_FLOOR_MS = 3500;

export async function requestPasswordReset(input: unknown): Promise<void> {
  const { email } = z.object({ email: emailField }).strict().parse(input);
  const startedAt = Date.now();
  try {
    await issuePasswordReset(email);
  } finally {
    if (emailProviderConfigured()) {
      const wait = RESET_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function issuePasswordReset(email: string): Promise<void> {
  const token = randomToken(32);
  const persona = await withAuthBootstrap(async (q) => {
    const r = await q.query<{ id: string }>(`SELECT id FROM identity.persona WHERE lower(email) = $1`, [email]);
    const p = r.rows[0];
    if (!p) return null;
    await q.query(
      `INSERT INTO identity.password_reset (id, persona_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [newUuidsV7(), p.id, sha256(token), new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString()],
    );
    return p;
  });
  if (!persona) {
    await verifyAgainstDummy(token);
    return;
  }
  try {
    await sendPasswordResetEmail(email, token);
  } catch (err) {
    if (!(err instanceof MailDeliveryError)) throw err;
  }
}

export async function resetPassword(input: unknown): Promise<void> {
  const d = z
    .object({ token: z.string().min(20).max(200), password: passwordSchema })
    .strict()
    .parse(input);
  const passwordHash = await hashPassword(d.password);
  const ok = await withAuthBootstrap(async (q) => {
    const r = await q.query<{ id: string; persona_id: string }>(
      `UPDATE identity.password_reset SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING id, persona_id`,
      [sha256(d.token)],
    );
    const row = r.rows[0];
    if (!row) return false;
    await q.query(`UPDATE identity.persona SET password_hash = $2, updated_at = now() WHERE id = $1`, [row.persona_id, passwordHash]);
    await q.query(`UPDATE identity.refresh_token SET revoked_at = coalesce(revoked_at, now()) WHERE persona_id = $1`, [row.persona_id]);
    return true;
  });
  if (!ok) throw new AppError(400, 'Enlace inválido', 'El enlace expiró o ya fue usado. Solicita uno nuevo.', 'reset_invalid');
}

/* ───────────── TOTP (two-step enrollment) ───────────── */

export async function setupTotp(personaId: string) {
  const secret = generateTotpSecret();
  await withPersona(personaId, async (q) => {
    const r = await q.query<{ totp_enabled: boolean; email: string }>(
      `SELECT totp_enabled, email FROM identity.persona WHERE id = $1`,
      [personaId],
    );
    if (r.rows[0]?.totp_enabled) throw new AppError(409, '2FA activo', 'La verificación en dos pasos ya está activa.', 'totp_active');
    await q.query(`UPDATE identity.persona SET totp_secret_enc = $2, updated_at = now() WHERE id = $1`, [personaId, encryptTotpSecret(secret)]);
  });
  return { secret, otpauth: `otpauth://totp/Facilito?secret=${secret}&issuer=Facilito` };
}

/** Enabling 2FA ends every session: the next login proves the second factor and gets an MFA session. */
export async function verifyTotpSetup(personaId: string, input: unknown) {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos') }).strict().parse(input);
  await withPersona(personaId, async (q) => {
    const r = await q.query<{ totp_secret_enc: string | null }>(`SELECT totp_secret_enc FROM identity.persona WHERE id = $1`, [personaId]);
    const enc = r.rows[0]?.totp_secret_enc;
    if (!enc || !verifyTotp(decryptTotpSecret(enc), code)) {
      throw new AppError(400, 'Código inválido', 'El código no coincide. Revisa la hora de tu teléfono.', 'totp');
    }
    await q.query(`UPDATE identity.persona SET totp_enabled = true, updated_at = now() WHERE id = $1`, [personaId]);
    await q.query(`UPDATE identity.refresh_token SET revoked_at = coalesce(revoked_at, now()) WHERE persona_id = $1`, [personaId]);
  });
  forgetSessionsOf({ personaId });
  return { enabled: true, reloginRequired: true };
}
