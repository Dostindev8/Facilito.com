import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Money, newUuidsV7 } from '@facilito/domain';
import { validateProductAttrs } from '@facilito/verticals';
import { withTenant, type Queryable } from '../db/client.js';
import { nextSequence } from '../db/sequence.js';
import { appendAudit } from '../audit/append.js';
import { AppError, mapDbError } from '../http/errors.js';
import { amount, likePattern, optionalText, pagination, safeText } from '../http/validators.js';
import { parseCsv, toCsv } from '../utils/csv.js';
import { getEnv } from '../config/env.js';
import { sanitizeProductImage } from '../studio/upload-guard.js';
import { appendMovementWithClient, type MotivoCodigo } from './inventory-tx.js';

export const UNIDADES = ['unidad', 'lb', 'kg', 'g', 'litro', 'ml', 'galon', 'caja', 'paquete', 'docena', 'metro', 'par'] as const;
export const ESTADOS_PRODUCTO = ['activo', 'inactivo', 'descontinuado'] as const;
// TODO: VERIFICAR EN VIVO — tasas de ITBIS vigentes (18% general, 16% reducida, exento).
export const TASAS_ITBIS = ['0', '0.16', '0.18'] as const;

const skuField = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,40}$/, 'SKU: letras, números, punto, guion (máx. 40)')
  .transform((s) => s.toUpperCase());

const barcodeField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((s) => (s == null || s.trim() === '' ? null : s.trim()))
  .pipe(z.string().regex(/^[0-9A-Za-z-]{4,64}$/, 'Código de barras inválido').nullable());

const productBase = {
  nombre: safeText(1, 200),
  categoria: safeText(1, 80).default('General'),
  descripcion: optionalText(1000),
  unidad: z.enum(UNIDADES).default('unidad'),
  costo: amount('Costo'),
  precioVenta: amount('Precio de venta'),
  stockMin: amount('Stock mínimo').default('0'),
  stockMax: z.union([amount('Stock máximo'), z.null()]).optional().default(null),
  codigoBarras: barcodeField,
  proveedorId: z.string().uuid().nullable().optional().default(null),
  estado: z.enum(ESTADOS_PRODUCTO).default('activo'),
  itbisTasa: z.enum(TASAS_ITBIS).default('0.18'),
  permiteNegativo: z.boolean().default(false),
  vertical: z.string().max(40).optional(),
  verticalAttrs: z.record(z.unknown()).optional(),
  confirmarPrecioBajoCosto: z.boolean().optional(),
};

export const createProductSchema = z
  .object({
    ...productBase,
    sku: z.union([skuField, z.literal(''), z.null()]).optional(),
    stockInicial: amount('Stock inicial').default('0'),
  })
  .strict();

export const updateProductSchema = z
  .object({
    ...Object.fromEntries(Object.entries(productBase).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
    sku: skuField.optional(),
  })
  .strict() as unknown as z.ZodType<Partial<z.infer<typeof createProductSchema>> & { sku?: string }>;

export const listProductsQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  categoria: z.string().trim().max(80).optional(),
  proveedorId: z.string().uuid().optional(),
  stock: z.enum(['bajo', 'agotado', 'disponible']).optional(),
  estado: z.enum(['activo', 'inactivo', 'descontinuado', 'todos']).default('todos'),
  sort: z.enum(['nombre', 'sku', 'stock', 'precio', 'actualizado']).default('nombre'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export const adjustSchema = z
  .object({
    tipo: z.enum(['entrada', 'salida', 'fijar']),
    cantidad: amount('Cantidad'),
    motivo: z.enum(['merma', 'devolucion', 'conteo_fisico', 'ajuste', 'compra']),
    nota: optionalText(300),
    clientUuid: z.string().uuid().optional(),
  })
  .strict()
  .refine((d) => d.tipo === 'fijar' || Number(d.cantidad) > 0, {
    message: 'La cantidad debe ser mayor que cero',
    path: ['cantidad'],
  });

const PRODUCT_COLUMNS = `
  p.id, p.sku, p.nombre, p.categoria, p.descripcion, p.uom AS unidad,
  round(p.costo, 2)::text AS costo, round(p.precio_venta, 2)::text AS precio_venta,
  p.margen::text AS margen, trim_scale(p.stock_actual)::text AS stock_actual,
  trim_scale(p.stock_min)::text AS stock_min, trim_scale(p.stock_max)::text AS stock_max,
  p.barcode, p.proveedor_id, pr.nombre AS proveedor_nombre, p.estado,
  trim_scale(p.tax_rate)::text AS tax_rate, p.allow_negative_stock, p.imagen_hash,
  p.vertical_attrs, p.created_at, p.updated_at`;

interface ProductRow {
  id: string;
  sku: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  unidad: string;
  costo: string;
  precio_venta: string;
  margen: string | null;
  stock_actual: string;
  stock_min: string;
  stock_max: string | null;
  barcode: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  estado: string;
  tax_rate: string;
  allow_negative_stock: boolean;
  imagen_hash: string | null;
  vertical_attrs: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

export type ProductDto = ReturnType<typeof toDto>;

function stockEstado(r: Pick<ProductRow, 'stock_actual' | 'stock_min'>): 'agotado' | 'bajo' | 'ok' {
  const s = Money.fromString(r.stock_actual);
  if (s.cmp(Money.zero()) <= 0) return 'agotado';
  if (s.cmp(Money.fromString(r.stock_min)) <= 0) return 'bajo';
  return 'ok';
}

function iso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function toDto(r: ProductRow) {
  return {
    id: r.id,
    sku: r.sku,
    nombre: r.nombre,
    categoria: r.categoria,
    descripcion: r.descripcion,
    unidad: r.unidad,
    costo: r.costo,
    precioVenta: r.precio_venta,
    margen: r.margen,
    stockActual: r.stock_actual,
    stockMin: r.stock_min,
    stockMax: r.stock_max,
    codigoBarras: r.barcode,
    proveedorId: r.proveedor_id,
    proveedorNombre: r.proveedor_nombre,
    estado: r.estado,
    itbisTasa: r.tax_rate,
    permiteNegativo: r.allow_negative_stock,
    imagenUrl: r.imagen_hash ? `/api/v1/products/${r.id}/image?v=${r.imagen_hash.slice(0, 12)}` : null,
    stockEstado: stockEstado(r),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

async function fetchProduct(q: Queryable, tenantId: string, id: string): Promise<ProductRow> {
  const res = await q.query<ProductRow & Record<string, unknown>>(
    `SELECT ${PRODUCT_COLUMNS}
       FROM app.producto p
       LEFT JOIN app.proveedor pr ON pr.tenant_id = p.tenant_id AND pr.id = p.proveedor_id
      WHERE p.tenant_id = $1 AND p.id = $2`,
    [tenantId, id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(404, 'Producto no encontrado', 'El producto no existe en este negocio.', 'not_found');
  return row;
}

function assertPriceRule(costo: string, precio: string, confirmed?: boolean): void {
  if (Money.fromString(precio).cmp(Money.fromString(costo)) < 0 && !confirmed) {
    throw new AppError(
      409,
      'Precio menor al costo',
      'El precio de venta es menor que el costo. Confirma si deseas continuar.',
      'price_below_cost',
    );
  }
}

function assertStockBounds(min: string, max: string | null | undefined): void {
  if (max != null && Money.fromString(max).cmp(Money.fromString(min)) < 0) {
    throw new AppError(400, 'Stock máximo inválido', 'El stock máximo no puede ser menor que el mínimo.', 'validation');
  }
}

function skuPrefix(categoria: string): string {
  const ascii = categoria
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return (ascii.slice(0, 3) || 'PRD').padEnd(3, 'X');
}

async function generateSku(q: Queryable, tenantId: string, categoria: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const n = await nextSequence(q, tenantId, 'sku');
    const sku = `${skuPrefix(categoria)}-${String(n).padStart(5, '0')}`;
    const taken = await q.query('SELECT 1 FROM app.producto WHERE tenant_id=$1 AND sku=$2', [tenantId, sku]);
    if (!taken.rows.length) return sku;
  }
  throw new AppError(409, 'SKU no disponible', 'No se pudo generar un SKU único. Ingresa uno manual.', 'sku');
}

async function assertSupplier(q: Queryable, tenantId: string, proveedorId: string | null | undefined): Promise<void> {
  if (!proveedorId) return;
  const r = await q.query('SELECT 1 FROM app.proveedor WHERE tenant_id=$1 AND id=$2', [tenantId, proveedorId]);
  if (!r.rows.length) throw new AppError(400, 'Proveedor inválido', 'El proveedor no existe en este negocio.', 'reference');
}

async function assertUnique(q: Queryable, tenantId: string, field: 'sku' | 'barcode', value: string | null | undefined, exceptId?: string): Promise<void> {
  if (!value) return;
  const r = await q.query(
    `SELECT 1 FROM app.producto WHERE tenant_id=$1 AND ${field === 'sku' ? 'sku' : 'barcode'}=$2 AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [tenantId, value, exceptId ?? null],
  );
  if (r.rows.length) {
    throw new AppError(
      409,
      field === 'sku' ? 'SKU duplicado' : 'Código de barras duplicado',
      field === 'sku' ? `Ya existe un producto con el SKU ${value}.` : 'Ya existe un producto con ese código de barras.',
      field === 'sku' ? 'duplicate_sku' : 'duplicate_barcode',
    );
  }
}

function checkVertical(vertical?: string, attrs?: Record<string, unknown>): void {
  if (!vertical) return;
  const r = validateProductAttrs(vertical, attrs ?? {});
  if (!r.ok) throw new AppError(400, 'Atributos inválidos', 'Revisa los datos del producto para este rubro.', 'validation');
}

export async function createProductTx(
  q: Queryable,
  tenantId: string,
  authorId: string,
  data: z.infer<typeof createProductSchema>,
): Promise<ProductDto> {
  assertPriceRule(data.costo, data.precioVenta, data.confirmarPrecioBajoCosto);
  assertStockBounds(data.stockMin, data.stockMax);
  checkVertical(data.vertical, data.verticalAttrs);
  await assertSupplier(q, tenantId, data.proveedorId);
  const sku = data.sku ? data.sku : await generateSku(q, tenantId, data.categoria);
  await assertUnique(q, tenantId, 'sku', sku);
  await assertUnique(q, tenantId, 'barcode', data.codigoBarras);
  const id = newUuidsV7();
  await q.query(
    `INSERT INTO app.producto
      (tenant_id, id, sku, nombre, categoria, descripcion, uom, costo, precio_venta, stock_min, stock_max,
       barcode, proveedor_id, estado, tax_rate, allow_negative_stock, vertical_attrs, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)`,
    [
      tenantId,
      id,
      sku,
      data.nombre,
      data.categoria,
      data.descripcion,
      data.unidad,
      data.costo,
      data.precioVenta,
      data.stockMin,
      data.stockMax,
      data.codigoBarras,
      data.proveedorId,
      data.estado,
      data.itbisTasa,
      data.permiteNegativo,
      JSON.stringify(data.vertical ? { vertical: data.vertical, attrs: data.verticalAttrs ?? {} } : {}),
      authorId,
    ],
  );
  if (Number(data.stockInicial) > 0) {
    await appendMovementWithClient(
      q,
      tenantId,
      authorId,
      {
        tipo: 'in',
        productoId: id,
        cantidad: data.stockInicial,
        costo: data.costo,
        motivoCodigo: 'inicial',
        motivo: 'Stock inicial',
        clientUuid: newUuidsV7(),
      },
      { audit: false },
    );
  }
  const created = await fetchProduct(q, tenantId, id);
  await appendAudit(q, {
    tenantId,
    action: 'create',
    entity: 'producto',
    entityId: id,
    before: null,
    after: { sku, nombre: data.nombre, costo: data.costo, precioVenta: data.precioVenta, stockInicial: data.stockInicial },
    authorId,
  });
  return toDto(created);
}

export async function createProduct(tenantId: string, authorId: string, input: unknown): Promise<ProductDto> {
  const data = createProductSchema.parse(input);
  return withTenant(tenantId, (q) => createProductTx(q, tenantId, authorId, data));
}

export async function updateProduct(tenantId: string, authorId: string, id: string, input: unknown): Promise<ProductDto> {
  const data = updateProductSchema.parse(input);
  return withTenant(tenantId, async (q) => {
    const before = await fetchProduct(q, tenantId, id);
    const costo = data.costo ?? before.costo;
    const precio = data.precioVenta ?? before.precio_venta;
    if (data.costo !== undefined || data.precioVenta !== undefined) {
      assertPriceRule(costo, precio, data.confirmarPrecioBajoCosto);
    }
    const stockMin = data.stockMin ?? before.stock_min;
    const stockMax = data.stockMax === undefined ? before.stock_max : data.stockMax;
    assertStockBounds(stockMin, stockMax);
    checkVertical(data.vertical, data.verticalAttrs);
    if (data.proveedorId !== undefined) await assertSupplier(q, tenantId, data.proveedorId);
    if (data.sku && data.sku !== before.sku) await assertUnique(q, tenantId, 'sku', data.sku, id);
    if (data.codigoBarras !== undefined && data.codigoBarras !== before.barcode) {
      await assertUnique(q, tenantId, 'barcode', data.codigoBarras, id);
    }

    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];
    const set = (col: string, value: unknown, cast = '') => {
      params.push(value);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (data.sku !== undefined) set('sku', data.sku);
    if (data.nombre !== undefined) set('nombre', data.nombre);
    if (data.categoria !== undefined) set('categoria', data.categoria);
    if (data.descripcion !== undefined) set('descripcion', data.descripcion);
    if (data.unidad !== undefined) set('uom', data.unidad);
    if (data.costo !== undefined) set('costo', data.costo);
    if (data.precioVenta !== undefined) set('precio_venta', data.precioVenta);
    if (data.stockMin !== undefined) set('stock_min', data.stockMin);
    if (data.stockMax !== undefined) set('stock_max', data.stockMax);
    if (data.codigoBarras !== undefined) set('barcode', data.codigoBarras);
    if (data.proveedorId !== undefined) set('proveedor_id', data.proveedorId);
    if (data.estado !== undefined) set('estado', data.estado);
    if (data.itbisTasa !== undefined) set('tax_rate', data.itbisTasa);
    if (data.permiteNegativo !== undefined) set('allow_negative_stock', data.permiteNegativo);
    if (data.vertical !== undefined) {
      set('vertical_attrs', JSON.stringify({ vertical: data.vertical, attrs: data.verticalAttrs ?? {} }), '::jsonb');
    }
    if (!sets.length) return toDto(before);
    sets.push('updated_at = now()');
    await q.query(`UPDATE app.producto SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, params);
    const after = await fetchProduct(q, tenantId, id);
    const changed = Object.fromEntries(
      Object.entries(data).filter(([k]) => k !== 'confirmarPrecioBajoCosto' && k !== 'verticalAttrs'),
    );
    await appendAudit(q, {
      tenantId,
      action: 'update',
      entity: 'producto',
      entityId: id,
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, (toDto(before) as Record<string, unknown>)[k] ?? null])),
      after: changed,
      authorId,
    });
    return toDto(after);
  });
}

export async function getProduct(tenantId: string, id: string): Promise<ProductDto> {
  return withTenant(tenantId, async (q) => toDto(await fetchProduct(q, tenantId, id)));
}

export async function listProducts(tenantId: string, query: unknown) {
  const f = listProductsQuery.parse(query ?? {});
  const where: string[] = ['p.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.q) {
    params.push(likePattern(f.q));
    const likeIdx = params.length;
    params.push(f.q);
    where.push(`(p.nombre ILIKE $${likeIdx} OR p.sku ILIKE $${likeIdx} OR p.categoria ILIKE $${likeIdx} OR p.barcode = $${params.length})`);
  }
  if (f.categoria) add('p.categoria = ?', f.categoria);
  if (f.proveedorId) add('p.proveedor_id = ?', f.proveedorId);
  if (f.estado !== 'todos') add('p.estado = ?', f.estado);
  if (f.stock === 'agotado') where.push('p.stock_actual <= 0');
  if (f.stock === 'bajo') where.push('p.stock_actual > 0 AND p.stock_actual <= p.stock_min');
  if (f.stock === 'disponible') where.push('p.stock_actual > p.stock_min');

  const sortCol = {
    nombre: 'p.nombre',
    sku: 'p.sku',
    stock: 'p.stock_actual',
    precio: 'p.precio_venta',
    actualizado: 'p.updated_at',
  }[f.sort];
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const offset = (f.page - 1) * f.pageSize;

  return withTenant(tenantId, async (q) => {
    const total = await q.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.producto p WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await q.query<ProductRow & Record<string, unknown>>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM app.producto p
         LEFT JOIN app.proveedor pr ON pr.tenant_id = p.tenant_id AND pr.id = p.proveedor_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortCol} ${dir}, p.id
        LIMIT ${f.pageSize} OFFSET ${offset}`,
      params,
    );
    return {
      items: rows.rows.map(toDto),
      total: Number(total.rows[0]?.n ?? 0),
      page: f.page,
      pageSize: f.pageSize,
    };
  });
}

export async function listCategories(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (q) => {
    const r = await q.query<{ categoria: string }>(
      `SELECT DISTINCT categoria FROM app.producto WHERE tenant_id=$1 ORDER BY categoria`,
      [tenantId],
    );
    return r.rows.map((x) => x.categoria);
  });
}

export async function lowStock(tenantId: string, limit = 20) {
  return withTenant(tenantId, (q) => lowStockTx(q, tenantId, limit));
}

export async function lowStockTx(q: Queryable, tenantId: string, limit = 20) {
  {
    const r = await q.query<ProductRow & Record<string, unknown>>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM app.producto p
         LEFT JOIN app.proveedor pr ON pr.tenant_id = p.tenant_id AND pr.id = p.proveedor_id
        WHERE p.tenant_id = $1 AND p.estado = 'activo' AND p.stock_actual <= p.stock_min
        ORDER BY (p.stock_actual - p.stock_min) ASC, p.nombre
        LIMIT $2`,
      [tenantId, Math.min(Math.max(limit, 1), 100)],
    );
    return r.rows.map(toDto);
  }
}

export async function adjustStock(tenantId: string, authorId: string, productoId: string, input: unknown) {
  const data = adjustSchema.parse(input);
  return withTenant(tenantId, async (q) => {
    const product = await fetchProduct(q, tenantId, productoId);
    let tipo: 'in' | 'out' | 'count';
    let cantidad: string;
    if (data.tipo === 'fijar') {
      const delta = Money.fromString(data.cantidad).sub(Money.fromString(product.stock_actual));
      if (delta.isZero()) {
        throw new AppError(400, 'Sin cambios', 'El conteo coincide con el stock actual.', 'no_change');
      }
      tipo = 'count';
      cantidad = delta.toString();
    } else {
      tipo = data.tipo === 'entrada' ? 'in' : 'out';
      cantidad = data.cantidad;
    }
    const mov = await appendMovementWithClient(
      q,
      tenantId,
      authorId,
      {
        tipo,
        productoId,
        cantidad,
        costo: product.costo,
        motivoCodigo: data.motivo as MotivoCodigo,
        motivo: data.nota ?? undefined,
        clientUuid: data.clientUuid ?? newUuidsV7(),
      },
      { audit: false },
    );
    if (!mov.duplicate) {
      await appendAudit(q, {
        tenantId,
        action: 'adjust',
        entity: 'producto',
        entityId: productoId,
        before: { stock: product.stock_actual },
        after: { stock: mov.stockResultante, tipo: data.tipo, cantidad: data.cantidad, motivo: data.motivo, nota: data.nota },
        authorId,
      });
    }
    return { movimientoId: mov.id, duplicate: mov.duplicate, stockActual: trimQty(mov.stockResultante) };
  });
}

function trimQty(v: string): string {
  return Money.fromString(v).toString();
}

export const kardexQuery = pagination.extend({
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
});

export async function kardex(tenantId: string, productoId: string, query: unknown) {
  const f = kardexQuery.parse(query ?? {});
  return withTenant(tenantId, async (q) => {
    const product = await fetchProduct(q, tenantId, productoId);
    const params: unknown[] = [tenantId, productoId];
    const where = ['m.tenant_id = $1', 'm.producto_id = $2'];
    if (f.desde) {
      params.push(f.desde);
      where.push(`m.created_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'America/Santo_Domingo'`);
    }
    if (f.hasta) {
      params.push(f.hasta);
      where.push(`m.created_at < (($${params.length}::date + 1))::timestamp AT TIME ZONE 'America/Santo_Domingo'`);
    }
    const total = await q.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.movimiento_inventario m WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await q.query<{
      id: string;
      created_at: Date | string;
      tipo: string;
      cantidad: string;
      costo: string;
      motivo_codigo: string | null;
      motivo: string | null;
      referencia: string | null;
      stock_resultante: string | null;
      autor: string | null;
    }>(
      `SELECT m.id, m.created_at, m.tipo, trim_scale(m.cantidad)::text AS cantidad, round(m.costo,2)::text AS costo,
              m.motivo_codigo, m.motivo, m.referencia, trim_scale(m.stock_resultante)::text AS stock_resultante,
              a.display_name AS autor
         FROM app.movimiento_inventario m
         LEFT JOIN app.acceso a ON a.tenant_id = m.tenant_id AND a.persona_id = m.author_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
    );
    return {
      producto: { id: product.id, sku: product.sku, nombre: product.nombre, stockActual: product.stock_actual, unidad: product.unidad },
      items: rows.rows.map((r) => {
        const entrada = r.tipo === 'in' || r.tipo === 'void_sale' || (!r.cantidad.startsWith('-') && (r.tipo === 'count' || r.tipo === 'adjust'));
        const abs = r.cantidad.replace(/^-/, '');
        return {
          id: r.id,
          fecha: iso(r.created_at),
          tipo: r.tipo,
          motivo: r.motivo_codigo,
          nota: r.motivo,
          referencia: r.referencia,
          entrada: entrada ? abs : null,
          salida: entrada ? null : abs,
          costo: r.costo,
          saldo: r.stock_resultante,
          autor: r.autor ?? 'Usuario',
        };
      }),
      total: Number(total.rows[0]?.n ?? 0),
      page: f.page,
      pageSize: f.pageSize,
    };
  });
}

/* ───────────── CSV import / export ───────────── */

const HEADER_ALIASES: Record<string, string> = {
  sku: 'sku',
  codigo: 'sku',
  nombre: 'nombre',
  producto: 'nombre',
  categoria: 'categoria',
  descripcion: 'descripcion',
  unidad: 'unidad',
  unidad_medida: 'unidad',
  costo: 'costo',
  precio: 'precioVenta',
  precio_venta: 'precioVenta',
  stock: 'stockInicial',
  stock_inicial: 'stockInicial',
  stock_actual: 'stockInicial',
  stock_minimo: 'stockMin',
  stock_min: 'stockMin',
  minimo: 'stockMin',
  stock_maximo: 'stockMax',
  stock_max: 'stockMax',
  maximo: 'stockMax',
  codigo_barras: 'codigoBarras',
  barcode: 'codigoBarras',
  proveedor: 'proveedor',
  estado: 'estado',
  itbis: 'itbisTasa',
};

function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export const MAX_IMPORT_ROWS = 2000;

export interface ImportRowError {
  fila: number;
  campo: string;
  mensaje: string;
}

export async function importProductsCsv(tenantId: string, authorId: string, csvText: string) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new AppError(400, 'Archivo vacío', 'El archivo no tiene filas de productos.', 'import_empty');
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new AppError(400, 'Archivo muy grande', `Máximo ${MAX_IMPORT_ROWS} productos por archivo.`, 'import_size');
  }
  const headers = rows[0]!.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);
  if (!headers.includes('nombre') || !headers.includes('precioVenta')) {
    throw new AppError(400, 'Columnas faltantes', 'El archivo necesita al menos las columnas "nombre" y "precio_venta".', 'import_headers');
  }

  const suppliers = await withTenant(tenantId, async (q) => {
    const r = await q.query<{ id: string; nombre: string }>('SELECT id, nombre FROM app.proveedor WHERE tenant_id=$1', [tenantId]);
    return new Map(r.rows.map((s) => [s.nombre.trim().toLowerCase(), s.id]));
  });

  const errors: ImportRowError[] = [];
  let created = 0;
  for (let i = 1; i < rows.length; i++) {
    const fila = i + 1;
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) raw[h] = (rows[i]![idx] ?? '').trim();
    });
    const candidate: Record<string, unknown> = {
      nombre: raw.nombre ?? '',
      precioVenta: raw.precioVenta ?? '',
      costo: raw.costo || '0',
      categoria: raw.categoria || undefined,
      descripcion: raw.descripcion || null,
      unidad: raw.unidad ? raw.unidad.toLowerCase() : undefined,
      stockInicial: raw.stockInicial || '0',
      stockMin: raw.stockMin || '0',
      stockMax: raw.stockMax || null,
      codigoBarras: raw.codigoBarras || null,
      estado: raw.estado ? raw.estado.toLowerCase() : undefined,
      itbisTasa: raw.itbisTasa || undefined,
      sku: raw.sku || null,
    };
    if (raw.proveedor) {
      const pid = suppliers.get(raw.proveedor.toLowerCase());
      if (!pid) {
        errors.push({ fila, campo: 'proveedor', mensaje: `Proveedor "${raw.proveedor}" no existe` });
        continue;
      }
      candidate.proveedorId = pid;
    }
    const parsed = createProductSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ fila, campo: issue.path.join('.') || 'fila', mensaje: issue.message });
      }
      continue;
    }
    try {
      await withTenant(tenantId, (q) => createProductTx(q, tenantId, authorId, parsed.data));
      created++;
    } catch (e) {
      const app = e instanceof AppError ? e : mapDbError(e);
      errors.push({
        fila,
        campo: app?.code === 'duplicate_sku' ? 'sku' : app?.code === 'duplicate_barcode' ? 'codigo_barras' : app?.code === 'price_below_cost' ? 'precio_venta' : 'fila',
        mensaje: app?.detail ?? 'No se pudo importar la fila',
      });
    }
  }
  return { total: rows.length - 1, creados: created, errores: errors };
}

export async function exportProductsCsv(tenantId: string): Promise<string> {
  const rows = await withTenant(tenantId, async (q) => {
    const r = await q.query<ProductRow & Record<string, unknown>>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM app.producto p
         LEFT JOIN app.proveedor pr ON pr.tenant_id = p.tenant_id AND pr.id = p.proveedor_id
        WHERE p.tenant_id = $1 ORDER BY p.nombre`,
      [tenantId],
    );
    return r.rows;
  });
  return toCsv(
    ['sku', 'nombre', 'categoria', 'descripcion', 'unidad', 'costo', 'precio_venta', 'margen', 'stock_actual', 'stock_minimo', 'stock_maximo', 'codigo_barras', 'proveedor', 'estado'],
    rows.map((r) => [
      r.sku,
      r.nombre,
      r.categoria,
      r.descripcion,
      r.unidad,
      r.costo,
      r.precio_venta,
      r.margen,
      r.stock_actual,
      r.stock_min,
      r.stock_max,
      r.barcode,
      r.proveedor_nombre,
      r.estado,
    ]),
  );
}

export function importTemplateCsv(): string {
  return toCsv(
    ['sku', 'nombre', 'categoria', 'descripcion', 'unidad', 'costo', 'precio_venta', 'stock_inicial', 'stock_minimo', 'stock_maximo', 'codigo_barras', 'proveedor', 'estado'],
    [['', 'Arroz Selecto 1 lb', 'Granos', '', 'lb', '32.00', '45.00', '100', '20', '', '', '', 'activo']],
  );
}

/* ───────────── Images ───────────── */

function imagePath(tenantId: string, hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash) || !/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('invalid path segment');
  return path.resolve(getEnv().UPLOAD_DIR, tenantId, `${hash}.webp`);
}

export async function setProductImage(tenantId: string, authorId: string, productoId: string, buf: Buffer) {
  const clean = await sanitizeProductImage(buf, getEnv().UPLOAD_MAX_BYTES);
  if (!clean.ok) {
    const detail =
      clean.reason === 'size'
        ? 'La imagen supera el tamaño permitido (2 MB).'
        : 'Solo se aceptan imágenes PNG, JPG o WebP válidas.';
    throw new AppError(400, 'Imagen inválida', detail, 'image');
  }
  const file = imagePath(tenantId, clean.hash);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, clean.bytes);
  return withTenant(tenantId, async (q) => {
    await fetchProduct(q, tenantId, productoId);
    await q.query(
      `UPDATE app.producto SET imagen_hash=$3, imagen_mime=$4, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantId, productoId, clean.hash, clean.mime],
    );
    await appendAudit(q, {
      tenantId,
      action: 'update',
      entity: 'producto',
      entityId: productoId,
      before: null,
      after: { imagenHash: clean.hash },
      authorId,
    });
    return toDto(await fetchProduct(q, tenantId, productoId));
  });
}

export async function getProductImage(tenantId: string, productoId: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await withTenant(tenantId, async (q) => {
    const r = await q.query<{ imagen_hash: string | null; imagen_mime: string | null }>(
      'SELECT imagen_hash, imagen_mime FROM app.producto WHERE tenant_id=$1 AND id=$2',
      [tenantId, productoId],
    );
    return r.rows[0];
  });
  if (!row?.imagen_hash) return null;
  try {
    return { bytes: await readFile(imagePath(tenantId, row.imagen_hash)), mime: row.imagen_mime ?? 'image/webp' };
  } catch {
    return null;
  }
}

/** Legacy stock endpoint kept for the mobile client. */
export async function stockOf(tenantId: string, productoId: string): Promise<Money> {
  return withTenant(tenantId, async (q) => Money.fromString((await fetchProduct(q, tenantId, productoId)).stock_actual));
}

/** Legacy raw movement endpoint (mobile outbox). */
export const movementSchema = z
  .object({
    tipo: z.enum(['in', 'out', 'adjust', 'count']),
    productoId: z.string().uuid(),
    loteId: z.string().uuid().optional(),
    cantidad: z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/),
    costo: amount('Costo').default('0'),
    motivoCodigo: z.enum(['merma', 'devolucion', 'conteo_fisico', 'ajuste', 'compra']).optional(),
    motivo: optionalText(300),
    referencia: optionalText(120),
    clientUuid: z.string().uuid(),
    deviceId: z.string().max(80).optional(),
  })
  .strict()
  .refine((d) => d.tipo === 'in' || d.tipo === 'out' || d.motivoCodigo, {
    message: 'Los ajustes requieren motivo',
    path: ['motivoCodigo'],
  });

export async function appendMovement(tenantId: string, authorId: string, input: unknown) {
  const d = movementSchema.parse(input);
  return withTenant(tenantId, (q) =>
    appendMovementWithClient(q, tenantId, authorId, {
      ...d,
      motivo: d.motivo ?? undefined,
      referencia: d.referencia ?? undefined,
    }),
  );
}
