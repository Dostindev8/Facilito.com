import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Money, newUuidsV7, type RoleCode } from '@facilito/domain';
import { listVerticals } from '@facilito/verticals';
import { withTenant } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { requireAuth, requireRole, ROLES_ADMIN, ROLES_INVENTORY_WRITE, ROLES_SELL, ROLES_VOID } from '../http/auth-guard.js';
import { safeText, uuidParam } from '../http/validators.js';
import { appendAudit } from '../audit/append.js';
import { hashPin } from '../auth/tokens.js';
import * as salesService from '../services/sales.service.js';
import * as copilotService from '../services/copilot.service.js';
import { computeRoi } from '../services/roi.service.js';

const ROLES_AUDIT: readonly RoleCode[] = ['owner', 'manager', 'accountant'];
const qty = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/, 'Número inválido');

export async function legacyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/verticals', async () => listVerticals());

  app.post('/v1/sales', async (req) => {
    const a = await requireRole(req, ROLES_SELL);
    const idem = req.headers['idempotency-key'];
    const key = typeof idem === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(idem) ? idem : null;
    if (key) {
      const cached = await withTenant(a.tenantId, async (q) => {
        const r = await q.query<{ response_json: unknown }>(
          `SELECT response_json FROM app.idempotency_key WHERE tenant_id=$1 AND key=$2`,
          [a.tenantId, key],
        );
        return r.rows[0]?.response_json;
      });
      if (cached) return cached;
    }
    const result = await salesService.createSale(a.tenantId, a.sub, a.rol, req.body);
    if (key) {
      await withTenant(a.tenantId, (q) =>
        q.query(
          `INSERT INTO app.idempotency_key (tenant_id, key, response_json) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
          [a.tenantId, key, JSON.stringify(result)],
        ),
      );
    }
    return result;
  });

  app.post('/v1/sales/:id/void', async (req) => {
    const a = await requireRole(req, ROLES_VOID);
    const { reason } = z.object({ reason: safeText(5, 300) }).parse(req.body);
    return salesService.voidSale(a.tenantId, a.sub, uuidParam.parse(req.params).id, reason);
  });

  app.post('/v1/copilot/ask', async (req) => {
    const a = await requireAuth(req);
    const body = z
      .object({ message: safeText(1, 2000), proposedAction: z.string().max(80).optional() })
      .strict()
      .parse(req.body);
    return copilotService.runCopilot(a.tenantId, a.sub, a.rol, body);
  });

  app.get('/v1/audit', async (req) => {
    const a = await requireRole(req, ROLES_AUDIT);
    return withTenant(a.tenantId, async (q) => {
      const r = await q.query(
        `SELECT id, action, entity, entity_id, author_id, hash, prev_hash, created_at
           FROM audit.bitacora WHERE tenant_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100`,
        [a.tenantId],
      );
      return r.rows;
    });
  });

  /** Physical counts: the counter proposes, a different owner/manager approves (segregation in DB). */
  app.post('/v1/counts', async (req, reply) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    const body = z
      .object({ alcance: safeText(1, 120), esperado: qty, contado: qty, motivo: safeText(3, 300).optional() })
      .strict()
      .parse(req.body);
    const id = newUuidsV7();
    const diferencia = Money.fromString(body.contado).sub(Money.fromString(body.esperado)).toString();
    await withTenant(a.tenantId, async (q) => {
      await q.query(
        `INSERT INTO app.conteo (tenant_id, id, alcance, contado_por, esperado, contado, diferencia, motivo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [a.tenantId, id, body.alcance, a.sub, body.esperado, body.contado, diferencia, body.motivo ?? null],
      );
      await appendAudit(q, { tenantId: a.tenantId, action: 'create', entity: 'conteo', entityId: id, before: null, after: { ...body, diferencia }, authorId: a.sub });
    });
    reply.status(201);
    return { id, diferencia, estado: 'pendiente_aprobacion' };
  });

  app.post('/v1/counts/:id/approve', async (req) => {
    const a = await requireRole(req, ROLES_ADMIN);
    const { id } = uuidParam.parse(req.params);
    return withTenant(a.tenantId, async (q) => {
      const r = await q.query<{ contado_por: string; aprobado_por: string | null }>(
        `SELECT contado_por, aprobado_por FROM app.conteo WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [a.tenantId, id],
      );
      const c = r.rows[0];
      if (!c) throw new AppError(404, 'Conteo no encontrado', 'El conteo no existe.', 'not_found');
      if (c.aprobado_por) throw new AppError(409, 'Ya aprobado', 'Este conteo ya fue aprobado.', 'already_approved');
      if (c.contado_por === a.sub) {
        throw new AppError(403, 'Segregación de funciones', 'Quien cuenta no puede aprobar su propio conteo.', 'segregation');
      }
      await q.query(`UPDATE app.conteo SET aprobado_por=$3 WHERE tenant_id=$1 AND id=$2`, [a.tenantId, id, a.sub]);
      await appendAudit(q, { tenantId: a.tenantId, action: 'approve', entity: 'conteo', entityId: id, before: null, after: { aprobadoPor: a.sub }, authorId: a.sub });
      return { id, aprobado: true };
    });
  });

  app.post('/v1/studio/content', async (req, reply) => {
    const a = await requireRole(req, ROLES_ADMIN);
    const body = z
      .object({
        tipo: z.enum(['producto', 'promocion', 'banner', 'catalogo']),
        payload: z.record(z.unknown()).refine((p) => JSON.stringify(p).length <= 20_000, 'Contenido muy grande'),
        fileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .strict()
      .parse(req.body);
    const id = newUuidsV7();
    await withTenant(a.tenantId, (q) =>
      q.query(
        `INSERT INTO app.contenido_studio (tenant_id, id, tipo, estado, author_id, file_hash, payload)
         VALUES ($1,$2,$3,'draft',$4,$5,$6::jsonb)`,
        [a.tenantId, id, body.tipo, a.sub, body.fileHash ?? null, JSON.stringify(body.payload)],
      ),
    );
    reply.status(201);
    return { id, estado: 'draft' };
  });

  /** Public, unauthenticated: only content explicitly published by the business. */
  app.get('/v1/public/catalog/:id', async (req) => {
    const { id: tenantId } = uuidParam.parse(req.params);
    return withTenant(tenantId, async (q) => {
      const r = await q.query(
        `SELECT id, tipo, payload, version FROM app.contenido_studio
          WHERE tenant_id=$1 AND estado='published' ORDER BY updated_at DESC LIMIT 200`,
        [tenantId],
      );
      return r.rows;
    });
  });

  app.get('/v1/investments/roi', async (req) => {
    await requireRole(req, ROLES_ADMIN);
    const q = z.object({ investment: qty.default('0'), profit: qty.default('0') }).parse(req.query ?? {});
    return computeRoi(q.investment, q.profit);
  });

  app.post('/v1/access/pin', async (req) => {
    const a = await requireAuth(req);
    const { pin } = z.object({ pin: z.string().regex(/^\d{4,8}$/, 'El PIN debe tener de 4 a 8 dígitos') }).strict().parse(req.body);
    const pinHash = await hashPin(pin);
    await withTenant(a.tenantId, (q) =>
      q.query(`UPDATE app.acceso SET pin_hash=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [a.accesoId, a.tenantId, pinHash]),
    );
    return { ok: true };
  });

  app.get('/v1/branches', async (req) => {
    const a = await requireAuth(req);
    return withTenant(a.tenantId, async (q) => (await q.query(`SELECT id, nombre FROM app.sucursal WHERE tenant_id=$1 ORDER BY nombre`, [a.tenantId])).rows);
  });

  app.post('/v1/branches', async (req, reply) => {
    const a = await requireRole(req, ROLES_ADMIN);
    const { nombre } = z.object({ nombre: safeText(2, 120) }).strict().parse(req.body);
    const id = newUuidsV7();
    await withTenant(a.tenantId, (q) => q.query(`INSERT INTO app.sucursal (tenant_id, id, nombre) VALUES ($1,$2,$3)`, [a.tenantId, id, nombre]));
    reply.status(201);
    return { id, nombre };
  });

  for (const report of ['606', '607', '608'] as const) {
    app.get(`/v1/reports/${report}`, async (req) => {
      await requireRole(req, ROLES_AUDIT);
      // TODO: VERIFICAR EN VIVO — formato DGII del reporte.
      return { report, status: 'stub', note: 'TODO: VERIFICAR EN VIVO' };
    });
  }
}
