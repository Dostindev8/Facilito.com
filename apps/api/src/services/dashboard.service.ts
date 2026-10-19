import { z } from 'zod';
import { percentChange, type RoleCode } from '@facilito/domain';
import { withTenant, type Queryable } from '../db/client.js';
import { likePattern } from '../http/validators.js';
import { loadBusiness, presentBusiness } from './settings.service.js';
import { lowStockTx } from './inventory.service.js';
import { numeroLabel } from './invoice.service.js';

const TZ = 'America/Santo_Domingo';

export const dashboardQuery = z.object({
  fecha: z.string().date().optional(),
  dias: z.coerce.number().refine((n) => n === 7 || n === 14 || n === 30, 'Rango inválido').default(7),
});

function todayDo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

interface DayKpi {
  ventas: string;
  productos: string;
  facturas: number;
  clientes: number;
}

async function dayKpi(q: Queryable, tenantId: string, day: string): Promise<DayKpi> {
  const r = await q.query<{ ventas: string; facturas: number; clientes: number; productos: string }>(
    `WITH f AS (
       SELECT id, total, cliente_id FROM app.factura
        WHERE tenant_id = $1 AND estado <> 'anulada'
          AND fecha_emision >= ($2::date)::timestamp AT TIME ZONE '${TZ}'
          AND fecha_emision <  ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
     )
     SELECT round(coalesce(sum(f.total),0),2)::text AS ventas,
            count(*)::int AS facturas,
            count(DISTINCT coalesce(f.cliente_id::text, f.id::text))::int AS clientes,
            (SELECT trim_scale(coalesce(sum(l.cantidad),0))::text FROM app.factura_linea l
              WHERE l.tenant_id = $1 AND l.factura_id IN (SELECT id FROM f)) AS productos
       FROM f`,
    [tenantId, day],
  );
  const row = r.rows[0]!;
  return { ventas: row.ventas, productos: row.productos, facturas: Number(row.facturas), clientes: Number(row.clientes) };
}

export async function dashboard(tenantId: string, rol: RoleCode, query: unknown) {
  const f = dashboardQuery.parse(query ?? {});
  const day = f.fecha && f.fecha <= todayDo() ? f.fecha : todayDo();
  const prev = new Date(`${day}T12:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevDay = prev.toISOString().slice(0, 10);

  return withTenant(tenantId, async (q) => {
    const [hoy, ayer] = [await dayKpi(q, tenantId, day), await dayKpi(q, tenantId, prevDay)];

    const serie = await q.query<{ dia: string; total: string; facturas: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              round(coalesce(sum(fa.total),0),2)::text AS total,
              count(fa.id)::int AS facturas
         FROM generate_series($2::date - ($3::int - 1), $2::date, interval '1 day') AS d
         LEFT JOIN app.factura fa
           ON fa.tenant_id = $1 AND fa.estado <> 'anulada'
          AND fa.fecha_emision >= (d::date)::timestamp AT TIME ZONE '${TZ}'
          AND fa.fecha_emision <  (d::date + 1)::timestamp AT TIME ZONE '${TZ}'
        GROUP BY d ORDER BY d`,
      [tenantId, day, f.dias],
    );

    const recientes = await q.query<{
      id: string;
      numero: string;
      fecha_emision: Date | string;
      cliente_nombre: string;
      productos: string;
      total: string;
      estado: string;
    }>(
      `SELECT f.id, f.numero::text, f.fecha_emision, f.cliente_nombre,
              (SELECT trim_scale(coalesce(sum(l.cantidad),0))::text FROM app.factura_linea l WHERE l.tenant_id=f.tenant_id AND l.factura_id=f.id) AS productos,
              round(f.total,2)::text AS total,
              CASE WHEN f.estado='pendiente' AND f.fecha_vencimiento < (now() AT TIME ZONE '${TZ}')::date THEN 'vencida' ELSE f.estado END AS estado
         FROM app.factura f WHERE f.tenant_id=$1 ORDER BY f.fecha_emision DESC, f.numero DESC LIMIT 6`,
      [tenantId],
    );

    const top = await q.query<{ producto_id: string; nombre: string; sku: string; unidades: string; ingresos: string }>(
      `SELECT l.producto_id, p.nombre, p.sku, trim_scale(sum(l.cantidad))::text AS unidades, round(sum(l.total),2)::text AS ingresos
         FROM app.factura_linea l
         JOIN app.factura f ON f.tenant_id=l.tenant_id AND f.id=l.factura_id AND f.estado <> 'anulada'
         JOIN app.producto p ON p.tenant_id=l.tenant_id AND p.id=l.producto_id
        WHERE l.tenant_id=$1 AND f.fecha_emision >= now() - interval '30 days'
        GROUP BY l.producto_id, p.nombre, p.sku
        ORDER BY sum(l.cantidad) DESC LIMIT 6`,
      [tenantId],
    );

    const negocio = presentBusiness(await loadBusiness(q, tenantId), rol);
    const counts = await q.query<{ productos: number; clientes: number }>(
      `SELECT (SELECT count(*) FROM app.producto WHERE tenant_id=$1 AND estado='activo')::int AS productos,
              (SELECT count(*) FROM app.cliente WHERE tenant_id=$1)::int AS clientes`,
      [tenantId],
    );

    const bajo = await lowStockTx(q, tenantId, 6);
    const ncfRows = await q.query<{
      tipo: string;
      restantes: string;
      siguiente: string;
      hasta: string;
      vence: Date | string | null;
    }>(
      `SELECT tipo, greatest(hasta - siguiente + 1, 0)::text AS restantes, siguiente::text, hasta::text, vence
         FROM app.ncf_secuencia WHERE tenant_id=$1 AND activo = true
        ORDER BY tipo`,
      [tenantId],
    );

    const cobrado = await q.query<{ cobrado: string; pendientes: number }>(
      `SELECT round(coalesce(sum(total) FILTER (WHERE estado = 'pagada'),0),2)::text AS cobrado,
              count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes
         FROM app.factura
        WHERE tenant_id=$1
          AND fecha_emision >= ($2::date)::timestamp AT TIME ZONE '${TZ}'
          AND fecha_emision <  ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'`,
      [tenantId, day],
    );

    const stockCritico = bajo.filter((p) => Number(p.stockActual) <= 0).length;
    const stockBajo = bajo.length;
    const ncfMin = ncfRows.rows.reduce((m, r) => Math.min(m, Number(r.restantes)), Number.POSITIVE_INFINITY);
    const saludInventario = stockCritico > 0 ? 40 : stockBajo > 0 ? 70 : 95;
    const saludFiscal = !Number.isFinite(ncfMin) ? 60 : ncfMin <= 20 ? 35 : ncfMin <= 100 ? 70 : 95;
    const saludNegocio = Math.round((saludInventario + saludFiscal) / 2);

    return {
      fecha: day,
      kpis: {
        ventas: { valor: hoy.ventas, anterior: ayer.ventas, cambio: percentChange(hoy.ventas, ayer.ventas) },
        productos: { valor: hoy.productos, anterior: ayer.productos, cambio: percentChange(hoy.productos, ayer.productos) },
        facturas: { valor: String(hoy.facturas), anterior: String(ayer.facturas), cambio: percentChange(String(hoy.facturas), String(ayer.facturas)) },
        clientes: { valor: String(hoy.clientes), anterior: String(ayer.clientes), cambio: percentChange(String(hoy.clientes), String(ayer.clientes)) },
      },
      serie: serie.rows.map((s) => ({ dia: s.dia, total: s.total, facturas: Number(s.facturas) })),
      recientes: recientes.rows.map((r) => ({
        id: r.id,
        numero: numeroLabel(r.numero),
        fecha: new Date(r.fecha_emision).toISOString(),
        cliente: r.cliente_nombre,
        productos: r.productos,
        total: r.total,
        estado: r.estado,
      })),
      masVendidos: top.rows.map((t) => ({ productoId: t.producto_id, nombre: t.nombre, sku: t.sku, unidades: t.unidades, ingresos: t.ingresos })),
      bajoStock: bajo.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        sku: p.sku,
        stockActual: p.stockActual,
        stockMin: p.stockMin,
        unidad: p.unidad,
        estado: p.stockEstado,
      })),
      negocio: {
        nombre: negocio.nombreComercial,
        rnc: negocio.rnc,
        ubicacion: negocio.ubicacion,
        estado: negocio.estado,
        productosActivos: Number(counts.rows[0]?.productos ?? 0),
        clientes: Number(counts.rows[0]?.clientes ?? 0),
      },
      /** Additive ERP+ fields — older clients ignore them. */
      ingresosCobrados: cobrado.rows[0]?.cobrado ?? '0',
      facturasPendientes: Number(cobrado.rows[0]?.pendientes ?? 0),
      ncfSecuencias: ncfRows.rows.map((s) => {
        const hasta = Number(s.hasta);
        const siguiente = Number(s.siguiente);
        const restantes = Number(s.restantes);
        const used = Math.max(0, siguiente - 1);
        return {
          tipo: s.tipo,
          restantes,
          siguiente,
          hasta,
          vence: s.vence ? new Date(s.vence).toISOString().slice(0, 10) : null,
          consumoPct: hasta > 0 ? Math.min(100, Math.round((used / hasta) * 100)) : 0,
        };
      }),
      salud: {
        negocio: saludNegocio,
        inventario: saludInventario,
        fiscal: saludFiscal,
        stockCritico,
        stockBajo,
      },
    };
  });
}

export type NotificationType = 'stock' | 'agotado' | 'vencida' | 'ncf' | 'anulada' | 'venta';

export interface NotificationDto {
  id: string;
  tipo: NotificationType;
  titulo: string;
  detalle: string;
  fecha: string;
  href: string;
}

/** Notifications are derived from live data; "read" state is kept per device by the client. */
export async function notifications(tenantId: string): Promise<NotificationDto[]> {
  return withTenant(tenantId, async (q) => {
    const out: NotificationDto[] = [];
    const stock = await q.query<{ id: string; nombre: string; stock_actual: string; stock_min: string; updated_at: Date | string }>(
      `SELECT id, nombre, trim_scale(stock_actual)::text AS stock_actual, trim_scale(stock_min)::text AS stock_min, updated_at
         FROM app.producto WHERE tenant_id=$1 AND estado='activo' AND stock_actual <= stock_min
        ORDER BY updated_at DESC LIMIT 10`,
      [tenantId],
    );
    for (const p of stock.rows) {
      const agotado = Number(p.stock_actual) <= 0;
      out.push({
        id: `stock:${p.id}:${p.stock_actual}`,
        tipo: agotado ? 'agotado' : 'stock',
        titulo: agotado ? 'Producto agotado' : 'Stock bajo',
        detalle: agotado ? `${p.nombre} no tiene existencias` : `${p.nombre}: quedan ${p.stock_actual} (mínimo ${p.stock_min})`,
        fecha: new Date(p.updated_at).toISOString(),
        href: `/inventario?producto=${p.id}`,
      });
    }
    const overdue = await q.query<{ id: string; numero: string; cliente_nombre: string; total: string; fecha_vencimiento: Date | string }>(
      `SELECT id, numero::text, cliente_nombre, round(total,2)::text AS total, fecha_vencimiento
         FROM app.factura WHERE tenant_id=$1 AND estado='pendiente'
          AND fecha_vencimiento < (now() AT TIME ZONE '${TZ}')::date
        ORDER BY fecha_vencimiento LIMIT 10`,
      [tenantId],
    );
    for (const f of overdue.rows) {
      out.push({
        id: `vencida:${f.id}`,
        tipo: 'vencida',
        titulo: 'Factura vencida',
        detalle: `${numeroLabel(f.numero)} · ${f.cliente_nombre} · RD$ ${Number(f.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`,
        fecha: new Date(f.fecha_vencimiento).toISOString(),
        href: `/facturacion/${f.id}`,
      });
    }
    const ncf = await q.query<{ tipo: string; restantes: string; vence: Date | string | null }>(
      `SELECT tipo, (hasta - siguiente + 1)::text AS restantes, vence FROM app.ncf_secuencia
        WHERE tenant_id=$1 AND activo
          AND ((hasta - siguiente + 1) <= 50 OR (vence IS NOT NULL AND vence <= (now() AT TIME ZONE '${TZ}')::date + 30))`,
      [tenantId],
    );
    for (const s of ncf.rows) {
      out.push({
        id: `ncf:${s.tipo}:${s.restantes}`,
        tipo: 'ncf',
        titulo: 'Secuencia NCF por agotarse',
        detalle: `${s.tipo}: quedan ${Math.max(Number(s.restantes), 0)}${s.vence ? ` · vence ${new Date(s.vence).toISOString().slice(0, 10)}` : ''}`,
        fecha: new Date().toISOString(),
        href: '/configuracion?tab=comprobantes',
      });
    }
    const voided = await q.query<{ id: string; numero: string; anulada_at: Date | string; motivo_anulacion: string }>(
      `SELECT id, numero::text, anulada_at, motivo_anulacion FROM app.factura
        WHERE tenant_id=$1 AND estado='anulada' AND anulada_at >= now() - interval '3 days'
        ORDER BY anulada_at DESC LIMIT 5`,
      [tenantId],
    );
    for (const v of voided.rows) {
      out.push({
        id: `anulada:${v.id}`,
        tipo: 'anulada',
        titulo: 'Factura anulada',
        detalle: `${numeroLabel(v.numero)}: ${v.motivo_anulacion}`,
        fecha: new Date(v.anulada_at).toISOString(),
        href: `/facturacion/${v.id}`,
      });
    }
    const sales = await q.query<{ id: string; numero: string; total: string; fecha_emision: Date | string }>(
      `SELECT id, numero::text, round(total,2)::text AS total, fecha_emision FROM app.factura
        WHERE tenant_id=$1 AND estado <> 'anulada' AND fecha_emision >= now() - interval '1 day'
        ORDER BY fecha_emision DESC LIMIT 5`,
      [tenantId],
    );
    for (const s of sales.rows) {
      out.push({
        id: `venta:${s.id}`,
        tipo: 'venta',
        titulo: 'Nueva venta registrada',
        detalle: `${numeroLabel(s.numero)} · RD$ ${Number(s.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`,
        fecha: new Date(s.fecha_emision).toISOString(),
        href: `/facturacion/${s.id}`,
      });
    }
    return out.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 25);
  });
}

export const searchQuery = z.object({ q: z.string().trim().min(2, 'Escribe al menos 2 letras').max(100) });

export async function globalSearch(tenantId: string, query: unknown) {
  const { q: text } = searchQuery.parse(query ?? {});
  const like = likePattern(text);
  const digits = text.replace(/\D/g, '');
  return withTenant(tenantId, async (q) => {
    const productos = await q.query<{ id: string; nombre: string; sku: string; stock: string; precio: string }>(
      `SELECT id, nombre, sku, trim_scale(stock_actual)::text AS stock, round(precio_venta,2)::text AS precio
         FROM app.producto WHERE tenant_id=$1 AND (nombre ILIKE $2 OR sku ILIKE $2 OR barcode = $3)
        ORDER BY nombre LIMIT 5`,
      [tenantId, like, text],
    );
    const clientes = await q.query<{ id: string; nombre: string; telefono: string | null }>(
      `SELECT id, nombre, telefono FROM app.cliente WHERE tenant_id=$1 AND (nombre ILIKE $2 OR coalesce(telefono,'') ILIKE $2)
        ORDER BY nombre LIMIT 5`,
      [tenantId, like],
    );
    const facturas = await q.query<{ id: string; numero: string; cliente_nombre: string; total: string; ncf: string | null }>(
      `SELECT id, numero::text, cliente_nombre, round(total,2)::text AS total, ncf FROM app.factura
        WHERE tenant_id=$1 AND (cliente_nombre ILIKE $2 OR coalesce(ncf,'') ILIKE $2 OR numero = $3)
        ORDER BY fecha_emision DESC LIMIT 5`,
      [tenantId, like, digits ? Number(digits.slice(-12)) : -1],
    );
    return {
      productos: productos.rows,
      clientes: clientes.rows,
      facturas: facturas.rows.map((f) => ({ ...f, numero: numeroLabel(f.numero) })),
    };
  });
}
