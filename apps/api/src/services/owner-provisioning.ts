import { newUuidsV7, resolveBusinessType } from '@facilito/domain';
import type { Queryable } from '../db/client.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';
import { encryptField, hashRnc } from '../utils/crypto.js';

export interface OwnerAccountInput {
  personaId: string;
  tenantId: string;
  nombre: string;
  email: string;
  /** Argon2id hash. Accounts created by an admin get an unusable hash until the invitation sets a real password. */
  passwordHash: string;
  razonSocial: string;
  rnc: string;
  tipoNegocio?: string | null;
  vertical?: string | null;
  instagram?: string | null;
}

/**
 * Creates the person, the business and the owner membership. The caller's transaction must run in the system
 * context with app.persona_id = personaId and app.tenant_id = tenantId (RLS only lets a new identity insert itself).
 * There is no public entry point: accounts exist only after a paid subscription is authorized.
 */
export async function provisionOwnerAccount(q: Queryable, input: OwnerAccountInput): Promise<{ accesoId: string }> {
  const email = input.email.trim().toLowerCase();
  const rncHash = hashRnc(input.rnc);
  const exists = await q.query('SELECT 1 FROM identity.persona WHERE lower(email) = $1', [email]);
  if (exists.rows.length) {
    throw new AppError(409, 'Email en uso', 'Ya existe una cuenta con ese email.', 'email_taken');
  }
  const rncTaken = await q.query('SELECT 1 FROM app.negocio WHERE rnc_hash = $1', [rncHash]);
  if (rncTaken.rows.length) {
    throw new AppError(409, 'RNC registrado', 'Ese RNC ya tiene un negocio en Facilito.', 'rnc_taken');
  }
  const tipo = resolveBusinessType(input.tipoNegocio ?? undefined, input.vertical ?? undefined);
  const accesoId = newUuidsV7();
  await q.query(`INSERT INTO identity.persona (id, email, password_hash, nombre) VALUES ($1,$2,$3,$4)`, [
    input.personaId,
    email,
    input.passwordHash,
    input.nombre,
  ]);
  await q.query(
    `INSERT INTO app.negocio (id, razon_social, nombre_comercial, rnc_enc, rnc_hash, verticales, created_by,
                              tipo_negocio, tipo_negocio_source, instagram_handle)
     VALUES ($1,$2,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
    [
      input.tenantId,
      input.razonSocial,
      encryptField(input.rnc),
      rncHash,
      JSON.stringify([tipo.vertical]),
      input.personaId,
      tipo.tipoNegocio,
      tipo.source,
      input.instagram ?? null,
    ],
  );
  await q.query(
    `INSERT INTO app.acceso (id, tenant_id, persona_id, rol, estado, display_name)
     VALUES ($1,$2,$3,'owner','active',$4)`,
    [accesoId, input.tenantId, input.personaId, input.nombre],
  );
  await appendAudit(q, {
    tenantId: input.tenantId,
    action: 'create',
    entity: 'negocio',
    entityId: input.tenantId,
    before: null,
    after: { razonSocial: input.razonSocial, vertical: tipo.vertical, tipoNegocio: tipo.tipoNegocio, instagram: input.instagram ?? null },
    authorId: input.personaId,
  });
  return { accesoId };
}
