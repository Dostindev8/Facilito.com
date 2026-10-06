import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { getEnv } from './config/env.js';
import { AppError, problemHandler, sendProblem } from './http/errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { inventoryRoutes } from './routes/inventory.routes.js';
import { invoiceRoutes } from './routes/invoice.routes.js';
import { businessRoutes } from './routes/business.routes.js';
import { legacyRoutes } from './routes/legacy.routes.js';
import { platformRoutes } from './routes/platform.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          },
    // Trust exactly the configured number of reverse-proxy hops; req.ip is then the real client.
    trustProxy: env.TRUST_PROXY > 0 ? (_addr: string, hop: number) => hop < env.TRUST_PROXY : false,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  const allowed = new Set(env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean));
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowed.has(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-facilito-csrf'],
    maxAge: 600,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 5 } });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError(429, 'Demasiadas solicitudes', 'Espera un momento e intenta de nuevo.', 'rate_limit', {
        retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
      });
      return Object.assign(err, { statusCode: 429 });
    },
  });

  app.setErrorHandler(problemHandler);
  app.setNotFoundHandler((_req, reply) => {
    sendProblem(reply, new AppError(404, 'No encontrado', 'La ruta solicitada no existe.', 'route_not_found'));
  });

  app.get('/health', async () => ({ status: 'ok', service: 'facilito-api' }));

  await app.register(authRoutes);
  await app.register(inventoryRoutes);
  await app.register(invoiceRoutes);
  await app.register(businessRoutes);
  await app.register(legacyRoutes);
  await app.register(platformRoutes);

  return app;
}
