import { z } from 'zod';
import { newUuidsV7 } from '@facilito/domain';
import { withAuthBootstrap, withPersona, type Queryable } from '../db/client.js';
import { hashPassword, hashRefresh, verifyPassword } from '../auth/tokens.js';
import { AppError } from '../http/errors.js';
import { safeText } from '../http/validators.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { MailDeliveryError, sendEmailChangeEmail, sendEmailChangeNoticeEmail } from './mailer.js';
import { emailField, me, passwordSchema } from './auth.service.js';

const EMAIL_CHANGE_TTL_MINUTES = 60;

function wrongPassword(field: string): AppError {
  return new AppError(400, 'Contraseña incorrecta', 'La contraseña actual no es correcta.', 'validation', {
    errors: [{ field, message: 'La contraseña actual no es correcta' }],
  });
}

async function assertPassword(q: Queryable, personaId: string, password: string, field: string) {
  const r = await q.query<{ password_hash: string }>(`SELECT password_hash FROM identity.persona WHERE id = $1`, [personaId]);
  if (!r.rows[0] || !(await verifyPassword(r.rows[0].password_hash, password))) throw wrongPassword(field);
}

export const profileSchema = z.object({ nombre: safeText(2, 120) }).strict();

/** Personal name shown in this business. The persona row always belongs to the token subject. */
export async function updateProfile(personaId: string, tenantId: string, input: unknown) {
  const d = profileSchema.parse(input);
  await withPersona(
    personaId,
    async (q) => {
      await q.query(`UPDATE identity.persona SET nombre = $2, updated_at = now() WHERE id = $1`, [personaId, d.nombre]);
      await q.query(`UPDATE app.acceso SET display_name = $3, updated_at = now() WHERE persona_id = $1 AND tenant_id = $2`, [
        personaId,
        tenantId,
        d.nombre,
      ]);
    },
    { tenantId },
  );
  return me(personaId, tenantId);
}

export const emailChangeSchema = z
  .object({ newEmail: emailField, password: z.string().min(1, 'Ingresa tu contraseña actual').max(128) })
  .strict();

/**
 * Starts an email change. The login email does NOT change until the link sent to the new address is opened,
 * so a stolen session alone cannot take over the account (the current password is also required).
 */
export async function requestEmailChange(personaId: string, input: unknown): Promise<{ pendingEmail: string }> {
  const d = emailChangeSchema.parse(input);
  const token = randomToken(32);
  const currentEmail = await withPersona(
    personaId,
    async (q) => {
      await assertPassword(q, personaId, d.password, 'password');
      const cur = await q.query<{ email: string }>(`SELECT email FROM identity.persona WHERE id = $1`, [personaId]);
      if (cur.rows[0]?.email.toLowerCase() === d.newEmail) {
        throw new AppError(400, 'Mismo correo', 'Ese ya es tu correo actual.', 'validation', {
          errors: [{ field: 'newEmail', message: 'Ese ya es tu correo actual' }],
        });
      }
      const taken = await q.query(`SELECT 1 FROM identity.persona WHERE lower(email) = $1`, [d.newEmail]);
      if (taken.rows.length) {
        throw new AppError(409, 'Correo en uso', 'Ya existe una cuenta con ese correo.', 'email_taken', {
          errors: [{ field: 'newEmail', message: 'Ya existe una cuenta con ese correo' }],
        });
      }
      await q.query(`UPDATE identity.email_change SET used_at = now() WHERE persona_id = $1 AND used_at IS NULL`, [personaId]);
      await q.query(
        `INSERT INTO identity.email_change (id, persona_id, new_email, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5)`,
        [newUuidsV7(), personaId, d.newEmail, sha256(token), new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60_000).toISOString()],
      );
      return cur.rows[0]?.email ?? null;
    },
    { authBootstrap: true },
  );
  try {
    await sendEmailChangeEmail(d.newEmail, token);
  } catch (err) {
    if (!(err instanceof MailDeliveryError)) throw err;
    throw new AppError(502, 'No pudimos enviar el correo', 'Intenta de nuevo en unos minutos.', 'email_delivery_failed');
  }
  if (currentEmail) await sendEmailChangeNoticeEmail(currentEmail, d.newEmail).catch(() => undefined);
  return { pendingEmail: d.newEmail };
}

export async function cancelEmailChange(personaId: string): Promise<void> {
  await withPersona(personaId, async (q) => {
    await q.query(`UPDATE identity.email_change SET used_at = now() WHERE persona_id = $1 AND used_at IS NULL`, [personaId]);
  });
}

/** Opening the link proves ownership of the new address; every session is closed so the next login uses it. */
export async function confirmEmailChange(input: unknown): Promise<{ email: string }> {
  const { token } = z.object({ token: z.string().min(20).max(200) }).strict().parse(input);
  const result = await withAuthBootstrap(async (q) => {
    const r = await q.query<{ persona_id: string; new_email: string }>(
      `UPDATE identity.email_change SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING persona_id, new_email`,
      [sha256(token)],
    );
    const row = r.rows[0];
    if (!row) return null;
    const taken = await q.query(`SELECT 1 FROM identity.persona WHERE lower(email) = $1 AND id <> $2`, [row.new_email, row.persona_id]);
    if (taken.rows.length) return 'taken' as const;
    await q.query(`UPDATE identity.persona SET email = $2, updated_at = now() WHERE id = $1`, [row.persona_id, row.new_email]);
    await q.query(`UPDATE identity.refresh_token SET revoked_at = coalesce(revoked_at, now()) WHERE persona_id = $1`, [row.persona_id]);
    // Reset links mailed to the previous address must not outlive the change.
    await q.query(`UPDATE identity.password_reset SET used_at = now() WHERE persona_id = $1 AND used_at IS NULL`, [row.persona_id]);
    return { email: row.new_email };
  });
  if (result === 'taken') throw new AppError(409, 'Correo en uso', 'Ese correo ya pertenece a otra cuenta.', 'email_taken');
  if (!result) throw new AppError(400, 'Enlace inválido', 'El enlace expiró o ya fue usado. Solicita el cambio de nuevo.', 'email_change_invalid');
  return result;
}

export const passwordChangeSchema = z
  .object({ currentPassword: z.string().min(1, 'Ingresa tu contraseña actual').max(128), newPassword: passwordSchema })
  .strict()
  .refine((d) => d.currentPassword !== d.newPassword, { message: 'La nueva contraseña debe ser distinta', path: ['newPassword'] });

/** Requires the current password; other devices are signed out, this session stays open. */
export async function changePassword(personaId: string, rawRefresh: string | undefined, input: unknown): Promise<void> {
  const d = passwordChangeSchema.parse(input);
  const passwordHash = await hashPassword(d.newPassword);
  await withPersona(
    personaId,
    async (q) => {
      await assertPassword(q, personaId, d.currentPassword, 'currentPassword');
      await q.query(`UPDATE identity.persona SET password_hash = $2, updated_at = now() WHERE id = $1`, [personaId, passwordHash]);
      const keep = rawRefresh && rawRefresh.length <= 200 ? hashRefresh(rawRefresh) : '';
      await q.query(
        `UPDATE identity.refresh_token SET revoked_at = coalesce(revoked_at, now())
          WHERE persona_id = $1
            AND family_id IS DISTINCT FROM (SELECT family_id FROM identity.refresh_token WHERE token_hash = $2 AND persona_id = $1)`,
        [personaId, keep],
      );
      await q.query(`UPDATE identity.password_reset SET used_at = now() WHERE persona_id = $1 AND used_at IS NULL`, [personaId]);
    },
    { authBootstrap: true },
  );
}
