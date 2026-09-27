import type { FastifyInstance } from 'fastify';
import type { RoleCode } from '@facilito/domain';
import { requireAuth, requireRole, ROLES_ADMIN } from '../http/auth-guard.js';
import { uuidParam } from '../http/validators.js';
import * as dashboard from '../services/dashboard.service.js';
import * as parties from '../services/parties.service.js';
import * as settings from '../services/settings.service.js';

const ROLES_CUSTOMERS: readonly RoleCode[] = ['owner', 'manager', 'cashier'];
const ROLES_SUPPLIERS: readonly RoleCode[] = ['owner', 'manager', 'warehouse'];

export async function businessRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/dashboard', async (req) => {
    const a = await requireAuth(req);
    return dashboard.dashboard(a.tenantId, a.rol, req.query);
  });
  app.get('/v1/notifications', async (req) => dashboard.notifications((await requireAuth(req)).tenantId));
  app.get('/v1/search', async (req) => dashboard.globalSearch((await requireAuth(req)).tenantId, req.query));

  for (const [kind, path, writeRoles] of [
    ['cliente', 'customers', ROLES_CUSTOMERS],
    ['proveedor', 'suppliers', ROLES_SUPPLIERS],
  ] as const) {
    app.get(`/v1/${path}`, async (req) => parties.listParties(kind, (await requireAuth(req)).tenantId, req.query));
    app.get(`/v1/${path}/:id`, async (req) => {
      const a = await requireRole(req, writeRoles);
      return parties.getParty(kind, a.tenantId, uuidParam.parse(req.params).id);
    });
    app.post(`/v1/${path}`, async (req, reply) => {
      const a = await requireRole(req, writeRoles);
      reply.status(201);
      return parties.createParty(kind, a.tenantId, a.sub, req.body);
    });
    app.patch(`/v1/${path}/:id`, async (req) => {
      const a = await requireRole(req, writeRoles);
      return parties.updateParty(kind, a.tenantId, a.sub, uuidParam.parse(req.params).id, req.body);
    });
  }

  app.get('/v1/settings', async (req) => {
    const a = await requireAuth(req);
    return settings.getSettings(a.tenantId, a.rol);
  });
  app.patch('/v1/settings', async (req) => {
    const a = await requireRole(req, ROLES_ADMIN);
    return settings.updateSettings(a.tenantId, a.sub, a.rol, req.body);
  });
  app.get('/v1/settings/ncf', async (req) => {
    const a = await requireAuth(req);
    return { tipos: settings.NCF_TIPOS, secuencias: await settings.listNcf(a.tenantId) };
  });
  app.put('/v1/settings/ncf', async (req) => {
    const a = await requireRole(req, ROLES_ADMIN);
    return settings.upsertNcf(a.tenantId, a.sub, req.body);
  });
}
