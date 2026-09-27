import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { requireAuth, requireRole, ROLES_INVENTORY_WRITE } from '../http/auth-guard.js';
import { uuidParam } from '../http/validators.js';
import { sendFile } from '../http/files.js';
import * as inv from '../services/inventory.service.js';

async function readUpload(req: FastifyRequest, allowed: RegExp, maxBytes: number): Promise<Buffer> {
  if (!req.isMultipart()) throw new AppError(400, 'Archivo requerido', 'Envía el archivo como formulario (multipart).', 'upload');
  const file = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 0 } });
  if (!file) throw new AppError(400, 'Archivo requerido', 'No se recibió ningún archivo.', 'upload');
  if (!allowed.test(file.filename)) {
    file.file.resume();
    throw new AppError(400, 'Tipo no permitido', 'El tipo de archivo no está permitido.', 'upload');
  }
  const buf = await file.toBuffer();
  if (file.file.truncated) throw new AppError(413, 'Archivo muy grande', 'El archivo supera el tamaño permitido.', 'upload_size');
  return buf;
}

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  const env = getEnv();

  app.get('/v1/products', async (req) => inv.listProducts((await requireAuth(req)).tenantId, req.query));
  app.get('/v1/products/categories', async (req) => inv.listCategories((await requireAuth(req)).tenantId));
  app.get('/v1/products/low-stock', async (req) => inv.lowStock((await requireAuth(req)).tenantId));

  app.post('/v1/products', async (req, reply) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    reply.status(201);
    return inv.createProduct(a.tenantId, a.sub, req.body);
  });

  app.get('/v1/products/:id', async (req) => {
    const a = await requireAuth(req);
    return inv.getProduct(a.tenantId, uuidParam.parse(req.params).id);
  });

  app.patch('/v1/products/:id', async (req) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    return inv.updateProduct(a.tenantId, a.sub, uuidParam.parse(req.params).id, req.body);
  });

  app.post('/v1/products/:id/adjust', async (req) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    return inv.adjustStock(a.tenantId, a.sub, uuidParam.parse(req.params).id, req.body);
  });

  app.get('/v1/products/:id/kardex', async (req) => {
    const a = await requireAuth(req);
    return inv.kardex(a.tenantId, uuidParam.parse(req.params).id, req.query);
  });

  app.post('/v1/products/:id/image', async (req) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    const { id } = uuidParam.parse(req.params);
    const buf = await readUpload(req, /\.(png|jpe?g|webp)$/i, env.UPLOAD_MAX_BYTES);
    return inv.setProductImage(a.tenantId, a.sub, id, buf);
  });

  app.get('/v1/products/:id/image', async (req, reply) => {
    const a = await requireAuth(req);
    const img = await inv.getProductImage(a.tenantId, uuidParam.parse(req.params).id);
    if (!img) throw new AppError(404, 'Sin imagen', 'El producto no tiene imagen.', 'not_found');
    return sendFile(reply, img.bytes, img.mime, 'producto.webp', 'inline');
  });

  app.post('/v1/products/import', async (req) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    const buf = await readUpload(req, /\.(csv|txt)$/i, 2 * 1024 * 1024);
    return inv.importProductsCsv(a.tenantId, a.sub, buf.toString('utf8'));
  });

  app.get('/v1/products/import/template', async (req, reply) => {
    await requireAuth(req);
    return sendFile(reply, inv.importTemplateCsv(), 'text/csv; charset=utf-8', 'plantilla-productos.csv');
  });

  app.get('/v1/exports/products.csv', async (req, reply) => {
    const a = await requireAuth(req);
    return sendFile(reply, await inv.exportProductsCsv(a.tenantId), 'text/csv; charset=utf-8', 'productos.csv');
  });

  // Legacy endpoints used by the offline mobile client.
  app.post('/v1/inventory/movements', async (req) => {
    const a = await requireRole(req, ROLES_INVENTORY_WRITE);
    return inv.appendMovement(a.tenantId, a.sub, req.body);
  });

  app.get('/v1/inventory/stock/:id', async (req) => {
    const a = await requireAuth(req);
    const { id } = uuidParam.parse(req.params);
    return { productoId: id, stock: (await inv.stockOf(a.tenantId, id)).toString() };
  });
}
