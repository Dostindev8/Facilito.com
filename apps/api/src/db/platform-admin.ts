import { newUuidsV7 } from '@facilito/domain';
import { getDriver } from './client.js';
import { hashPassword } from '../auth/tokens.js';
import { sha256 } from '../utils/crypto.js';
import { emailField, passwordSchema } from '../services/auth.service.js';

const PLATFORM_TENANT_NAME = 'Facilito · Administración';
const PLATFORM_RNC_SENTINEL = 'platform:none';

/**
 * Creates (or repairs) a platform administrator on the privileged connection. Idempotent: an existing account with
 * the same email keeps its data, gets the new password, is unblocked and gains platform membership. The admin also
 * owns the internal platform workspace so the regular session machinery (tenant-scoped tokens) works unchanged.
 */
export async function provisionPlatformAdmin(input: { email: string; password: string; nombre: string; resetTotp?: boolean }) {
  const email = emailField.parse(input.email);
  const password = passwordSchema.parse(input.password);
  const nombre = input.nombre.trim().slice(0, 120) || 'Administrador';
  const passwordHash = await hashPassword(password);

  const admin = await (await getDriver()).admin();
  try {
    await admin.query('BEGIN');
    // The privileged role may still be subject to FORCE ROW LEVEL SECURITY; open the same bypass registration uses.
    await admin.query(`SELECT set_config('app.auth_bootstrap', '1', true)`);

    let tenantId = (await admin.query<{ id: string }>(`SELECT id FROM app.negocio WHERE es_plataforma`)).rows[0]?.id;
    let personaId = (await admin.query<{ id: string }>(`SELECT id FROM identity.persona WHERE lower(email) = $1`, [email])).rows[0]?.id;
    const created = !personaId;

    if (personaId) {
      await admin.query(
        `UPDATE identity.persona
            SET password_hash = $2, nombre = coalesce(nombre, $3), bloqueado_at = NULL, bloqueado_motivo = NULL, updated_at = now()
          WHERE id = $1`,
        [personaId, passwordHash, nombre],
      );
      // Lost-device recovery: only reachable with the privileged database credentials, never over HTTP.
      if (input.resetTotp) {
        await admin.query(`UPDATE identity.persona SET totp_enabled = false, totp_secret_enc = NULL WHERE id = $1`, [personaId]);
      }
      await admin.query(`UPDATE identity.refresh_token SET revoked_at = now() WHERE persona_id = $1 AND revoked_at IS NULL`, [personaId]);
    } else {
      personaId = newUuidsV7();
      await admin.query(`INSERT INTO identity.persona (id, email, password_hash, nombre) VALUES ($1,$2,$3,$4)`, [
        personaId,
        email,
        passwordHash,
        nombre,
      ]);
    }

    if (!tenantId) {
      tenantId = newUuidsV7();
      await admin.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await admin.query(
        `INSERT INTO app.negocio (id, razon_social, nombre_comercial, rnc_enc, rnc_hash, verticales, created_by,
                                  tipo_negocio, tipo_negocio_source, sujeto_dgii, es_plataforma)
         VALUES ($1, $2, $2, $3, $4, '["colmado"]'::jsonb, $5, 'Administración', 'custom', false, true)`,
        // No real RNC: the sentinel never decrypts (settings shows it empty) and the hash input can never collide with
        // a 9/11-digit document, so provisioning does not need the production FIELD_ENCRYPTION_KEY.
        [tenantId, PLATFORM_TENANT_NAME, PLATFORM_RNC_SENTINEL, sha256('facilito:platform-tenant'), personaId],
      );
    } else {
      await admin.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }

    await admin.query(
      `INSERT INTO app.acceso (id, tenant_id, persona_id, rol, estado, display_name)
       VALUES ($1, $2, $3, 'owner', 'active', $4)
       ON CONFLICT (persona_id, tenant_id) DO UPDATE SET rol = 'owner', estado = 'active', updated_at = now()`,
      [newUuidsV7(), tenantId, personaId, nombre],
    );
    await admin.query(`INSERT INTO identity.platform_admin (persona_id) VALUES ($1) ON CONFLICT DO NOTHING`, [personaId]);
    await admin.query('COMMIT');
    return { personaId, tenantId, created };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await admin.release();
  }
}
