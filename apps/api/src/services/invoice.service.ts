import { z } from 'zod';
import { computeInvoiceTotals, formatNcf, Money, newUuidsV7, type RoleCode } from '@facilito/domain';
import { withTenant, type Queryable } from '../db/client.js';
import { nextSequence } from '../db/sequence.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';
import { amount, likePattern, optionalText, pagination, positiveQty, safeText } from '../http/validators.js';
import { appendMovementWithClient } from './inventory-tx.js';
import { loadBusiness } from './settings.service.js';
import { toCsv } from '../utils/csv.js';

export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'credito'] as const;
export const MAX_LINES = 200;

/** Max line discount (% of line gross) per role. Above this a manager must issue the invoice. */
const DISCOUNT_CAP_PCT: Record<RoleCode, number> = {
  owner: 100,
  manager: 50,
  cashier: 10,
  warehouse: 0,
  accountant: 0,
  viewer: 0,
};
const PRICE_OVERRIDE_ROLES: readonly RoleCode[] = ['owner', 'manager'];

const lineSchema = z
  .object({
    productoId: z.string().uuid(),
    cantidad: positiveQty(),
    precioUnitario: amount('Precio').optional(),
    descuento: amount('Descuento').default('0'),
  })
  .strict();

export const createInvoiceSchema = z
  .object({
    clientUuid: z.string().uuid(),
    clienteId: z.string().uuid().nullable().optional(),
    clienteNombre: optionalText(200),
    metodoPago: z.enum(METODOS_PAGO),
    pagada: z.boolean().optional(),
    fechaVencimiento: z.string().date().nullable().optional(),
    ncfTipo: z
      .union([z.string().regex(/^[BE]\d{2}$/, 'Tipo NCF inválido'), z.null()])
      .optional(),
    notas: optionalText(500),
    lineas: z.array(lineSchema).min(1, 'Agrega al menos un producto').max(MAX_LINES, `Máximo ${MAX_LINES} líneas`),
  })
  .strict()
  .refine((d) => d.metodoPago !== 'credito' || !!d.fechaVencimiento, {
    message: 'Las ventas a crédito necesitan fecha de vencimiento',
    path: ['fechaVencimiento'],
  });

export type EstadoFactura = 'pendiente' | 'pagada' | 'anulada' | 'vencida';

const HEADER_COLUMNS = `
  f.id, f.numero::text AS numero, f.ncf, f.ncf_tipo, f.cliente_id, f.cliente_nombre, f.fecha_emision,
  f.fecha_vencimiento, f.itbis_modo, round(f.subtotal,2)::text AS subtotal,
  round(f.descuento_total,2)::text AS descuento_total, round(f.itbis_total,2)::text AS itbis_total,
  round(f.total,2)::text AS total, f.estado, f.metodo_pago, f.notas, f.motivo_anulacion, f.anulada_at,
  f.pagada_at, f.created_at,
  CASE WHEN f.estado = 'pendiente' AND f.fecha_vencimiento IS NOT NULL
        AND f.fecha_vencimiento < (now() AT TIME ZONE 'America/Santo_Domingo')::date
       THEN 'vencida' ELSE f.estado END AS estado_efectivo,
  (SELECT count(*) FROM app.factura_linea l WHERE l.tenant_id = f.tenant_id AND l.factura_id = f.id)::int AS lineas_count,
  (SELECT trim_scale(coalesce(sum(l.cantidad),0))::text FROM app.factura_linea l WHERE l.tenant_id = f.tenant_id AND l.factura_id = f.id) AS unidades`;

interface HeaderRow {
  id: string;
  numero: string;
  ncf: string | null;
  ncf_tipo: string | null;
  cliente_id: string | null;
  cliente_nombre: string;
  fecha_emision: Date | string;
  fecha_vencimiento: Date | string | null;
  itbis_modo: 'linea' | 'global';
  subtotal: string;
  descuento_total: string;
  itbis_total: string;
  total: string;
  estado: 'pendiente' | 'pagada' | 'anulada';
  estado_efectivo: EstadoFactura;
  metodo_pago: string;
  notas: string | null;
  motivo_anulacion: string | null;
  anulada_at: Date | string | null;
  pagada_at: Date | string | null;
  created_at: Date | string;
  lineas_count: number;
  unidades: string;
}

export function numeroLabel(numero: string | number): string {
  return `FAC-${String(numero).padStart(6, '0')}`;
}

function dateOnly(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(d).toISOString().slice(0, 10);
}

function headerDto(r: HeaderRow) {
  return {
    id: r.id,
    numero: Number(r.numero),
    numeroLabel: numeroLabel(r.numero),
    ncf: r.ncf,
    ncfTipo: r.ncf_tipo,
    clienteId: r.cliente_id,
    clienteNombre: r.cliente_nombre,
    fechaEmision: new Date(r.fecha_emision).toISOString(),
    fechaVencimiento: dateOnly(r.fecha_vencimiento),
    itbisModo: r.itbis_modo,
    subtotal: r.subtotal,
    descuentoTotal: r.descuento_total,
    itbisTotal: r.itbis_total,
    total: r.total,
    estado: r.estado_efectivo,
    metodoPago: r.metodo_pago,
    notas: r.notas,
    motivoAnulacion: r.motivo_anulacion,
    anuladaAt: r.anulada_at ? new Date(r.anulada_at).toISOString() : null,
    pagadaAt: r.pagada_at ? new Date(r.pagada_at).toISOString() : null,
    lineasCount: Number(r.lineas_count),
    unidades: r.unidades,
  };
}

export type InvoiceHeaderDto = ReturnType<typeof headerDto>;

async function fetchHeader(q: Queryable, tenantId: string, id: string, lock = false): Promise<HeaderRow> {
  if (lock) {
    await q.query(`SELECT 1 FROM app.factura WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
  }
  const r = await q.query<HeaderRow & Record<string, unknown>>(
    `SELECT ${HEADER_COLUMNS} FROM app.factura f WHERE f.tenant_id=$1 AND f.id=$2`,
    [tenantId, id],
  );
  if (!r.rows[0]) throw new AppError(404, 'Factura no encontrada', 'La factura no existe en este negocio.', 'not_found');
  return r.rows[0];
}

async function fetchLines(q: Queryable, tenantId: string, facturaId: string) {
  const r = await q.query<{
    linea: number;
    producto_id: string;
    sku: string | null;
    descripcion: string;
    cantidad: string;
    unidad: string | null;
    precio_unitario: string;
    descuento: string;
    itbis_tasa: string;
    subtotal: string;
    itbis: string;
    total: string;
  }>(
    `SELECT l.linea, l.producto_id, p.sku, l.descripcion, trim_scale(l.cantidad)::text AS cantidad, p.uom AS unidad,
            round(l.precio_unitario,2)::text AS precio_unitario, round(l.descuento,2)::text AS descuento,
            trim_scale(l.itbis_tasa)::text AS itbis_tasa, round(l.subtotal,2)::text AS subtotal,
            round(l.itbis,2)::text AS itbis, round(l.total,2)::text AS total
       FROM app.factura_linea l
       LEFT JOIN app.producto p ON p.tenant_id = l.tenant_id AND p.id = l.producto_id
      WHERE l.tenant_id=$1 AND l.factura_id=$2 ORDER BY l.linea`,
    [tenantId, facturaId],
  );
  return r.rows.map((l) => ({
    linea: l.linea,
    productoId: l.producto_id,
    sku: l.sku,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    unidad: l.unidad,
    precioUnitario: l.precio_unitario,
    descuento: l.descuento,
    itbisTasa: l.itbis_tasa,
    subtotal: l.subtotal,
    itbis: l.itbis,
    total: l.total,
  }));
}

export async function getInvoice(tenantId: string, id: string) {
  return withTenant(tenantId, async (q) => ({
    ...headerDto(await fetchHeader(q, tenantId, id)),
    lineas: await fetchLines(q, tenantId, id),
  }));
}

export type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>;

function todayDo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
}

export async function createInvoice(tenantId: string, authorId: string, rol: RoleCode, input: unknown) {
  const d = createInvoiceSchema.parse(input);
  if (d.fechaVencimiento && d.fechaVencimiento < todayDo()) {
    throw new AppError(400, 'Fecha inválida', 'La fecha de vencimiento no puede ser anterior a hoy.', 'validation');
  }

  return withTenant(tenantId, async (q) => {
    const dup = await q.query<{ id: string }>(`SELECT id FROM app.factura WHERE tenant_id=$1 AND client_uuid=$2`, [
      tenantId,
      d.clientUuid,
    ]);
    if (dup.rows[0]) {
      return {
        ...headerDto(await fetchHeader(q, tenantId, dup.rows[0].id)),
        lineas: await fetchLines(q, tenantId, dup.rows[0].id),
        duplicate: true,
      };
    }

    const negocio = await loadBusiness(q, tenantId);

    const ids = [...new Set(d.lineas.map((l) => l.productoId))].sort();
    const prods = await q.query<{
      id: string;
      nombre: string;
      estado: string;
      precio_venta: string;
      tax_rate: string;
      stock_actual: string;
      allow_negative_stock: boolean;
    }>(
      `SELECT id, nombre, estado, precio_venta::text, tax_rate::text, stock_actual::text, allow_negative_stock
         FROM app.producto WHERE tenant_id=$1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [tenantId, ids],
    );
    const byId = new Map(prods.rows.map((p) => [p.id, p]));

    const required = new Map<string, Money>();
    d.lineas.forEach((l, i) => {
      const p = byId.get(l.productoId);
      if (!p) throw new AppError(400, 'Producto inválido', `Línea ${i + 1}: el producto no existe en este negocio.`, 'reference', { line: i });
      if (p.estado !== 'activo') {
        throw new AppError(409, 'Producto no disponible', `Línea ${i + 1}: "${p.nombre}" está ${p.estado}.`, 'product_inactive', { line: i });
      }
      if (l.precioUnitario !== undefined && !PRICE_OVERRIDE_ROLES.includes(rol) && Money.fromString(l.precioUnitario).cmp(Money.fromString(p.precio_venta)) !== 0) {
        throw new AppError(403, 'Precio bloqueado', 'Solo el dueño o gerente puede cambiar el precio de venta.', 'price_override', { line: i });
      }
      required.set(l.productoId, (required.get(l.productoId) ?? Money.zero()).add(Money.fromString(l.cantidad)));
    });

    const shortages: string[] = [];
    for (const [pid, qty] of required) {
      const p = byId.get(pid)!;
      if (Money.fromString(p.stock_actual).cmp(qty) < 0 && !p.allow_negative_stock && !negocio.permiteStockNegativo) {
        shortages.push(`${p.nombre} (disponible: ${Money.fromString(p.stock_actual).toString()})`);
      }
    }
    if (shortages.length) {
      throw new AppError(409, 'Stock insuficiente', `No hay suficiente inventario: ${shortages.join(', ')}.`, 'stock', { productos: shortages });
    }

    const calcLines = d.lineas.map((l) => {
      const p = byId.get(l.productoId)!;
      return {
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario ?? p.precio_venta,
        descuento: l.descuento,
        itbisTasa: p.tax_rate,
      };
    });
    const cap = DISCOUNT_CAP_PCT[rol] ?? 0;
    calcLines.forEach((l, i) => {
      const gross = Money.fromString(l.precioUnitario).mul(l.cantidad).round(2);
      const disc = Money.fromString(l.descuento);
      if (disc.cmp(gross) > 0) {
        throw new AppError(400, 'Descuento inválido', `Línea ${i + 1}: el descuento no puede superar el importe de la línea.`, 'invoice', { line: i });
      }
      if (!disc.isZero() && disc.mul(100).cmp(gross.mul(cap)) > 0) {
        throw new AppError(403, 'Descuento no permitido', `Línea ${i + 1}: el descuento supera el ${cap}% permitido para tu rol.`, 'discount_cap', { line: i });
      }
    });
    const totals = computeInvoiceTotals(calcLines, negocio.itbisModo, negocio.itbisTasa);

    let clienteNombre = d.clienteNombre ?? 'Cliente general';
    if (d.clienteId) {
      const c = await q.query<{ nombre: string }>(`SELECT nombre FROM app.cliente WHERE tenant_id=$1 AND id=$2`, [tenantId, d.clienteId]);
      if (!c.rows[0]) throw new AppError(400, 'Cliente inválido', 'El cliente no existe en este negocio.', 'reference');
      clienteNombre = c.rows[0].nombre;
    }

    const ncfTipo = d.ncfTipo === undefined ? (negocio.sujetoDgii ? negocio.ncfTipoDefault : null) : d.ncfTipo;
    let ncf: string | null = null;
    if (ncfTipo) {
      const seq = await q.query<{ n: string }>(
        `UPDATE app.ncf_secuencia SET siguiente = siguiente + 1
          WHERE tenant_id=$1 AND tipo=$2 AND activo AND siguiente <= hasta
            AND (vence IS NULL OR vence >= (now() AT TIME ZONE 'America/Santo_Domingo')::date)
          RETURNING (siguiente - 1)::text AS n`,
        [tenantId, ncfTipo],
      );
      if (!seq.rows[0]) {
        throw new AppError(
          409,
          'Secuencia NCF no disponible',
          `No hay secuencia ${ncfTipo} activa, vigente y con números disponibles. Configúrala en Configuración → Comprobantes, o emite sin comprobante fiscal.`,
          'ncf_unavailable',
        );
      }
      ncf = formatNcf(ncfTipo, Number(seq.rows[0].n));
    }

    const numero = await nextSequence(q, tenantId, 'factura');
    const id = newUuidsV7();
    const pagada = d.metodoPago === 'credito' ? false : d.pagada ?? true;
    await q.query(
      `INSERT INTO app.factura
        (tenant_id, id, numero, client_uuid, ncf, ncf_tipo, cliente_id, cliente_nombre, fecha_vencimiento, itbis_modo,
         subtotal, descuento_total, itbis_total, total, estado, metodo_pago, notas, pagada_at, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        tenantId,
        id,
        numero,
        d.clientUuid,
        ncf,
        ncf ? ncfTipo : null,
        d.clienteId ?? null,
        clienteNombre,
        d.fechaVencimiento ?? null,
        negocio.itbisModo,
        totals.subtotal,
        totals.descuentoTotal,
        totals.itbisTotal,
        totals.total,
        pagada ? 'pagada' : 'pendiente',
        d.metodoPago,
        d.notas,
        pagada ? new Date().toISOString() : null,
        authorId,
      ],
    );

    const ref = numeroLabel(numero);
    for (let i = 0; i < d.lineas.length; i++) {
      const l = d.lineas[i]!;
      const c = calcLines[i]!;
      const t = totals.lines[i]!;
      await q.query(
        `INSERT INTO app.factura_linea
          (tenant_id, factura_id, linea, producto_id, descripcion, cantidad, precio_unitario, descuento, itbis_tasa, subtotal, itbis, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tenantId, id, i + 1, l.productoId, byId.get(l.productoId)!.nombre, l.cantidad, c.precioUnitario, c.descuento, c.itbisTasa, t.subtotal, t.itbis, t.total],
      );
      await appendMovementWithClient(
        q,
        tenantId,
        authorId,
        {
          tipo: 'sale',
          productoId: l.productoId,
          cantidad: l.cantidad,
          costo: '0',
          motivoCodigo: 'venta',
          referencia: ref,
          clientUuid: newUuidsV7(),
        },
        { audit: false },
      );
    }

    await appendAudit(q, {
      tenantId,
      action: 'create',
      entity: 'factura',
      entityId: id,
      before: null,
      after: { numero, ncf, total: totals.total, itbis: totals.itbisTotal, lineas: d.lineas.length, metodoPago: d.metodoPago },
      authorId,
    });

    return { ...headerDto(await fetchHeader(q, tenantId, id)), lineas: await fetchLines(q, tenantId, id), duplicate: false };
  });
}

export const voidSchema = z.object({ motivo: safeText(5, 300) }).strict();

/** Voiding never deletes: the invoice keeps its number and NCF, stock is restored in the same transaction. */
export async function voidInvoice(tenantId: string, authorId: string, id: string, input: unknown) {
  const { motivo } = voidSchema.parse(input);
  return withTenant(tenantId, async (q) => {
    const h = await fetchHeader(q, tenantId, id, true);
    if (h.estado === 'anulada') throw new AppError(409, 'Ya anulada', 'Esta factura ya fue anulada.', 'already_void');
    const lines = await fetchLines(q, tenantId, id);
    await q.query(
      `UPDATE app.factura SET estado='anulada', motivo_anulacion=$3, anulada_at=now(), anulada_por=$4, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id, motivo, authorId],
    );
    const ref = numeroLabel(h.numero);
    for (const l of lines) {
      await appendMovementWithClient(
        q,
        tenantId,
        authorId,
        {
          tipo: 'void_sale',
          productoId: l.productoId,
          cantidad: l.cantidad,
          costo: '0',
          motivoCodigo: 'anulacion',
          motivo,
          referencia: ref,
          clientUuid: newUuidsV7(),
        },
        { audit: false },
      );
    }
    // TODO: VERIFICAR EN VIVO — reporte de NCF anulados (formato 608) y reglas de nota de crédito.
    await appendAudit(q, {
      tenantId,
      action: 'void',
      entity: 'factura',
      entityId: id,
      before: { estado: h.estado, total: h.total },
      after: { estado: 'anulada', motivo },
      authorId,
    });
    return { ...headerDto(await fetchHeader(q, tenantId, id)), lineas: await fetchLines(q, tenantId, id) };
  });
}

export const paySchema = z
  .object({ metodoPago: z.enum(['efectivo', 'tarjeta', 'transferencia']).optional() })
  .strict();

export async function markPaid(tenantId: string, authorId: string, id: string, input: unknown) {
  const d = paySchema.parse(input ?? {});
  return withTenant(tenantId, async (q) => {
    const h = await fetchHeader(q, tenantId, id, true);
    if (h.estado === 'anulada') throw new AppError(409, 'Factura anulada', 'No se puede cobrar una factura anulada.', 'void');
    if (h.estado === 'pagada') throw new AppError(409, 'Ya pagada', 'Esta factura ya está pagada.', 'already_paid');
    await q.query(`UPDATE app.factura SET estado='pagada', pagada_at=now(), updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    await appendAudit(q, {
      tenantId,
      action: 'pay',
      entity: 'factura',
      entityId: id,
      before: { estado: h.estado_efectivo },
      after: { estado: 'pagada', metodoCobro: d.metodoPago ?? h.metodo_pago },
      authorId,
    });
    return headerDto(await fetchHeader(q, tenantId, id));
  });
}

export const listInvoicesQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  estado: z.enum(['pendiente', 'pagada', 'anulada', 'vencida', 'todas']).default('todas'),
  metodoPago: z.enum(METODOS_PAGO).optional(),
  clienteId: z.string().uuid().optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
});

function buildInvoiceFilter(tenantId: string, f: z.infer<typeof listInvoicesQuery>) {
  const where = ['f.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const overdue = `(f.estado = 'pendiente' AND f.fecha_vencimiento IS NOT NULL AND f.fecha_vencimiento < (now() AT TIME ZONE 'America/Santo_Domingo')::date)`;
  if (f.estado === 'vencida') where.push(overdue);
  else if (f.estado === 'pendiente') where.push(`f.estado = 'pendiente' AND NOT ${overdue}`);
  else if (f.estado !== 'todas') where.push(`f.estado = ${push(f.estado)}`);
  if (f.metodoPago) where.push(`f.metodo_pago = ${push(f.metodoPago)}`);
  if (f.clienteId) where.push(`f.cliente_id = ${push(f.clienteId)}`);
  if (f.desde) where.push(`f.fecha_emision >= (${push(f.desde)}::date)::timestamp AT TIME ZONE 'America/Santo_Domingo'`);
  if (f.hasta) where.push(`f.fecha_emision < ((${push(f.hasta)}::date + 1))::timestamp AT TIME ZONE 'America/Santo_Domingo'`);
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    const like = push(likePattern(f.q));
    const num = digits ? push(Number(digits.slice(-12))) : 'NULL';
    where.push(`(f.cliente_nombre ILIKE ${like} OR coalesce(f.ncf,'') ILIKE ${like} OR f.numero = ${num})`);
  }
  return { where: where.join(' AND '), params };
}

export async function listInvoices(tenantId: string, query: unknown) {
  const f = listInvoicesQuery.parse(query ?? {});
  const { where, params } = buildInvoiceFilter(tenantId, f);
  return withTenant(tenantId, async (q) => {
    const agg = await q.query<{ n: string; suma: string }>(
      `SELECT count(*)::text AS n, round(coalesce(sum(f.total) FILTER (WHERE f.estado <> 'anulada'),0),2)::text AS suma
         FROM app.factura f WHERE ${where}`,
      params,
    );
    const rows = await q.query<HeaderRow & Record<string, unknown>>(
      `SELECT ${HEADER_COLUMNS} FROM app.factura f WHERE ${where}
        ORDER BY f.fecha_emision DESC, f.numero DESC
        LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
    );
    return {
      items: rows.rows.map(headerDto),
      total: Number(agg.rows[0]?.n ?? 0),
      sumaTotal: agg.rows[0]?.suma ?? '0.00',
      page: f.page,
      pageSize: f.pageSize,
    };
  });
}

export const reportQuery = z.object({
  desde: z.string().date(),
  hasta: z.string().date(),
  estado: z.enum(['pendiente', 'pagada', 'anulada', 'vencida', 'todas']).default('todas'),
});

export async function invoiceReport(tenantId: string, query: unknown) {
  const r = reportQuery.parse(query ?? {});
  if (r.hasta < r.desde) throw new AppError(400, 'Rango inválido', '"Hasta" debe ser posterior a "desde".', 'validation');
  const days = (Date.parse(r.hasta) - Date.parse(r.desde)) / 86_400_000;
  if (days > 366) throw new AppError(400, 'Rango muy amplio', 'El reporte admite hasta un año.', 'validation');
  const { where, params } = buildInvoiceFilter(tenantId, { ...r, page: 1, pageSize: 1 });
  return withTenant(tenantId, async (q) => {
    const rows = await q.query<HeaderRow & Record<string, unknown>>(
      `SELECT ${HEADER_COLUMNS} FROM app.factura f WHERE ${where} ORDER BY f.fecha_emision, f.numero LIMIT 20000`,
      params,
    );
    const items = rows.rows.map(headerDto);
    const valid = items.filter((i) => i.estado !== 'anulada');
    const sum = (k: 'subtotal' | 'itbisTotal' | 'total' | 'descuentoTotal') =>
      valid.reduce((a, i) => a.add(Money.fromString(i[k])), Money.zero()).toFixed(2);
    return {
      desde: r.desde,
      hasta: r.hasta,
      items,
      resumen: {
        facturas: valid.length,
        anuladas: items.length - valid.length,
        subtotal: sum('subtotal'),
        descuentos: sum('descuentoTotal'),
        itbis: sum('itbisTotal'),
        total: sum('total'),
      },
      negocio: await loadBusiness(q, tenantId),
    };
  });
}

export function invoiceReportCsv(report: Awaited<ReturnType<typeof invoiceReport>>): string {
  return toCsv(
    ['numero', 'ncf', 'fecha', 'cliente', 'metodo_pago', 'estado', 'subtotal', 'descuento', 'itbis', 'total'],
    report.items.map((i) => [
      i.numeroLabel,
      i.ncf,
      new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(i.fechaEmision)),
      i.clienteNombre,
      i.metodoPago,
      i.estado,
      i.subtotal,
      i.descuentoTotal,
      i.itbisTotal,
      i.total,
    ]),
  );
}

export async function businessName(tenantId: string): Promise<string> {
  return (await withTenant(tenantId, (q) => loadBusiness(q, tenantId))).nombreComercial;
}

export async function whatsappLink(tenantId: string, id: string, phoneInput: unknown) {
  const { telefono } = z
    .object({ telefono: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().regex(/^\d{10,15}$/, 'Teléfono inválido')) })
    .strict()
    .parse(phoneInput);
  const inv = await getInvoice(tenantId, id);
  const negocio = await withTenant(tenantId, (q) => loadBusiness(q, tenantId));
  const phone = telefono.length === 10 ? `1${telefono}` : telefono;
  const text = [
    `${negocio.nombreComercial}`,
    `Factura ${inv.numeroLabel}${inv.ncf ? ` · NCF ${inv.ncf}` : ''}`,
    `Total: RD$ ${Number(inv.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`,
    `Estado: ${inv.estado}`,
    '¡Gracias por su compra!',
  ].join('\n');
  return { url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
}
