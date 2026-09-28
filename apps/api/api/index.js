// Vercel serverless entry: one warm Fastify instance per function container, fed raw Node requests.
import { buildApp } from '../dist/app.js';

let ready;

export default async function handler(req, res) {
  ready ??= buildApp().then(async (app) => {
    await app.ready();
    return app;
  });
  const app = await ready.catch((err) => {
    ready = undefined;
    throw err;
  });
  app.server.emit('request', req, res);
}
