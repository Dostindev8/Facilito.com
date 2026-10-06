import { z } from 'zod';
import { newUuidsV7, resolveBusinessType, rncPlainSchema, type RoleCode } from '@facilito/domain';
import { listVerticals } from '@facilito/verticals';
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
import { encryptField, hashRnc, randomToken, sha256 } from '../utils/crypto.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';
import { businessTypeField, instagramField, safeText } from '../http/validators.js';
import { getEnv } from '../config/env.js';
import { counterGet, counterIncr, counterReset } from '../utils/cache.js';
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

export const registerSchema = z
  .object({
    nombre: safeText(2, 120),
    email: emailField,
    password: passwordSchema,
    razonSocial: safeText(2, 200),
    rnc: z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ''))
      .pipe(rncPlainSchema),
    /** Legacy catalog id; clients now send `tipoNegocio` (free text). */
    vertical: z.string().max(40).optional(),
    tipoNegocio: businessTypeField.optional(),
    instagram: instagramField,
    recordarme: z.boolean().default(false),
  })
  .strict();

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

export interface SessionResult {
  accessToken: string;
  refresh: { raw: string; maxAgeSeconds: number | null };
  user: SessionUser;
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

export const ACCOUNT_BLOCKED = () =>
  new AppError(403, 'Cuenta suspendida', 'Tu cuenta está suspendida. Escríbenos a soporte si crees que es un error.', 'account_blocked');

async function issueSession(
  q: Queryable,
  persona: { id: string; email: string; nombre: string | null },
  accesos: AccesoRow[],
  chosen: AccesoRow,
  remember: boolean,
  familyId?: string,
): Promise<SessionResult> {
  const env = getEnv();
  const ttl = remember ? env.JWT_REFRESH_TTL_SECONDS : SHORT_SESSION_SECONDS;
  const refresh = newRefreshTokenValue();
  await q.query(
    `INSERT INTO identity.refresh_token (id, persona_id, family_id, token_hash, expires_at, tenant_id, remember)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      refresh.id,
      persona.id,
      familyId ?? refresh.familyId,
      refresh.hash,
      new Date(Date.now() + ttl * 1000).toISOString(),
      chosen.tenant_id,
      remember,
    ],
  );
  const platformAdmin = await isPlatformAdmin(q, persona.id);
  const accessToken = await signAccessToken({
    sub: persona.id,
    tenantId: chosen.tenant_id,
    accesoId: chosen.id,
    rol: chosen.rol,
    platformAdmin,
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
    },
  };
}

export async function registerOwner(input: unknown): Promise<SessionResult> {
  const data = registerSchema.parse(input);
  if (data.vertical !== undefined && !listVerticals().some((v) => v.id === data.vertical)) {
    throw new AppError(400, 'Rubro inválido', 'Selecciona un tipo de negocio válido.', 'validation');
  }
  const tipo = resolveBusinessType(data.tipoNegocio, data.vertical);
  const personaId = newUuidsV7();
  const tenantId = newUuidsV7();
  const accesoId = newUuidsV7();
  const passwordHash = await hashPassword(data.password);
  const rncHash = hashRnc(data.rnc);

  return withPersona(
    personaId,
    async (q) => {
      const exists = await q.query('SELECT 1 FROM identity.persona WHERE lower(email) = $1', [data.email]);
      if (exists.rows.length) {
        throw new AppError(409, 'Email en uso', 'Ya existe una cuenta con ese email. Inicia sesión.', 'email_taken');
      }
      const rncTaken = await q.query('SELECT 1 FROM app.negocio WHERE rnc_hash = $1', [rncHash]);
      if (rncTaken.rows.length) {
        throw new AppError(409, 'RNC registrado', 'Ese RNC ya tiene un negocio en Facilito. Pide acceso al dueño.', 'rnc_taken');
      }
      await q.query(`INSERT INTO identity.persona (id, email, password_hash, nombre) VALUES ($1,$2,$3,$4)`, [
        personaId,
        data.email,
        passwordHash,
        data.nombre,
      ]);
      await q.query(
        `INSERT INTO app.negocio (id, razon_social, nombre_comercial, rnc_enc, rnc_hash, verticales, created_by,
                                  tipo_negocio, tipo_negocio_source, instagram_handle)
         VALUES ($1,$2,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
        [
          tenantId,
          data.razonSocial,
          encryptField(data.rnc),
          rncHash,
          JSON.stringify([tipo.vertical]),
          personaId,
          tipo.tipoNegocio,
          tipo.source,
          data.instagram ?? null,
        ],
      );
      await q.query(
        `INSERT INTO app.acceso (id, tenant_id, persona_id, rol, estado, display_name)
         VALUES ($1,$2,$3,'owner','active',$4)`,
        [accesoId, tenantId, personaId, data.nombre],
      );
      await appendAudit(q, {
        tenantId,
        action: 'create',
        entity: 'negocio',
        entityId: tenantId,
        before: null,
        after: { razonSocial: data.razonSocial, vertical: tipo.vertical, tipoNegocio: tipo.tipoNegocio, instagram: data.instagram ?? null },
        authorId: personaId,
      });
      const accesos = await loadAccesos(q, personaId);
      return issueSession(q, { id: personaId, email: data.email, nombre: data.nombre }, accesos, accesos[0]!, data.recordarme);
    },
    { authBootstrap: true, tenantId },
  );
}

function lockKeys(email: string, ip: string): { emailKey: string; ipKey: string } {
  return { emailKey: `login:e:${sha256(email)}`, ipKey: `login:ip:${ip}` };
}

export async function login(input: unknown, ip: string): Promise<SessionResult> {
  const data = loginSchema.parse(input);
  const env = getEnv();
  const { emailKey, ipKey } = lockKeys(data.email, ip);
  const [emailFails, ipFails] = await Promise.all([counterGet(emailKey), counterGet(ipKey)]);
  if (emailFails >= env.LOGIN_MAX_FAILURES || ipFails >= env.LOGIN_MAX_FAILURES * 4) {
    throw new AppError(
      429,
      'Cuenta bloqueada temporalmente',
      `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(env.LOGIN_LOCK_SECONDS / 60)} minutos.`,
      'locked',
      { retryAfterSeconds: env.LOGIN_LOCK_SECONDS },
    );
  }
  const fail = async (): Promise<never> => {
    await Promise.all([counterIncr(emailKey, env.LOGIN_LOCK_SECONDS), counterIncr(ipKey, env.LOGIN_LOCK_SECONDS)]);
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
  if (persona.totp_enabled) {
    if (!data.totp || !persona.totp_secret_enc) {
      throw new AppError(401, '2FA requerido', 'Ingresa el código de tu app de autenticación.', 'totp_required');
    }
    if (!verifyTotp(decryptTotpSecret(persona.totp_secret_enc), data.totp)) return fail();
  }
  // Only revealed after the password proved ownership, so it cannot be used to probe accounts.
  if (persona.bloqueado_at) throw ACCOUNT_BLOCKED();
  await counterReset(emailKey);

  return withPersona(
    persona.id,
    async (q) => {
      const accesos = await loadAccesos(q, persona.id);
      if (!accesos.length) throw new AppError(403, 'Sin negocios', 'No tienes acceso activo a ningún negocio.', 'no_tenant');
      const chosen = data.tenantId ? accesos.find((a) => a.tenant_id === data.tenantId) : accesos[0];
      if (!chosen) throw new AppError(403, 'Sin acceso', 'No tienes acceso a ese negocio.', 'forbidden');
      return issueSession(q, persona, accesos, chosen, data.recordarme);
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
    }>(
      `SELECT id, persona_id, family_id, expires_at, revoked_at, tenant_id, remember
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
    return { kind: 'ok' as const, session: await issueSession(q, p.rows[0], accesos, chosen, tok.remember, tok.family_id) };
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
      if (rawRefresh) {
        const cur = await q.query<{ id: string; family_id: string; remember: boolean }>(
          `SELECT id, family_id, remember FROM identity.refresh_token
            WHERE token_hash = $1 AND persona_id = $2 AND revoked_at IS NULL`,
          [hashRefresh(rawRefresh), personaId],
        );
        if (cur.rows[0]) {
          remember = cur.rows[0].remember;
          familyId = cur.rows[0].family_id;
          await q.query(`UPDATE identity.refresh_token SET revoked_at = now() WHERE id = $1`, [cur.rows[0].id]);
        }
      }
      return issueSession(q, p.rows[0]!, accesos, chosen, remember, familyId);
    },
    { tenantId },
  );
}

export async function me(personaId: string, tenantId: string) {
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
      };
    },
    { tenantId },
  );
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

export async function verifyTotpSetup(personaId: string, input: unknown) {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos') }).strict().parse(input);
  await withPersona(personaId, async (q) => {
    const r = await q.query<{ totp_secret_enc: string | null }>(`SELECT totp_secret_enc FROM identity.persona WHERE id = $1`, [personaId]);
    const enc = r.rows[0]?.totp_secret_enc;
    if (!enc || !verifyTotp(decryptTotpSecret(enc), code)) {
      throw new AppError(400, 'Código inválido', 'El código no coincide. Revisa la hora de tu teléfono.', 'totp');
    }
    await q.query(`UPDATE identity.persona SET totp_enabled = true, updated_at = now() WHERE id = $1`, [personaId]);
  });
  return { enabled: true };
}
