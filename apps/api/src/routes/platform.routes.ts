import type { FastifyInstance } from 'fastify';
import { requirePlatformAdmin } from '../http/auth-guard.js';
import * as platform from '../services/platform.service.js';

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/v1/platform/stats', async (req) => platform.stats((await requirePlatformAdmin(req)).sub));

  app.get('/v1/platform/users', async (req) => platform.listUsers((await requirePlatformAdmin(req)).sub, req.query));
  app.post('/v1/platform/users/:id/block', async (req) =>
    platform.blockUser((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/users/:id/unblock', async (req) => platform.unblockUser((await requirePlatformAdmin(req)).sub, req.params, req.ip));

  app.get('/v1/platform/businesses', async (req) => platform.listBusinesses((await requirePlatformAdmin(req)).sub, req.query));
  app.post('/v1/platform/businesses/:id/suspend', async (req) =>
    platform.suspendBusiness((await requirePlatformAdmin(req)).sub, req.params, req.body, req.ip),
  );
  app.post('/v1/platform/businesses/:id/reactivate', async (req) =>
    platform.reactivateBusiness((await requirePlatformAdmin(req)).sub, req.params, req.ip),
  );

  app.get('/v1/platform/activity', async (req) => platform.activity((await requirePlatformAdmin(req)).sub));
}
