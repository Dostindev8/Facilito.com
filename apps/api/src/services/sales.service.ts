import { z } from 'zod';
import { Money, newUuidsV7 } from '@facilito/domain';
import { withTenant } from '../db/client.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';
import { appendMovementWithClient } from './inventory-tx.js';
import { verifyPin } from '../auth/tokens.js';
import { ROLE_HIERARCHY, type RoleCode } from '@facilito/domain';

const decimal = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'Número inválido');

const itemSchema = z.object({
  productoId: z.string().uuid(),
  cantidad: decimal.refine((v) => Number(v) > 0, 'Cantidad debe ser mayor que cero'),
  precioUnitario: decimal,
  taxRate: z.enum(['0', '0.16', '0.18']).default('0.18'),
});

const saleSchema = z.object({
  clientUuid: z.string().uuid(),
  clienteNombre: z.string().trim().max(200).optional(),
  items: z.array(itemSchema).min(1).max(200),
  descuento: decimal.default('0'),
  deviceId: z.string().max(80).optional(),
  supervisorPin: z.string().regex(/^\d{4,8}$/).optional(),
  fxRate: decimal.optional(),
  fxSource: z.string().max(40).optional(),
  fxDate: z.string().date().optional(),
});

const DISCOUNT_CAPS: Record<RoleCode, number> = {
  owner: 100,
  manager: 50,
  cashier: 10,
  warehouse: 0,
  accountant: 0,
  viewer: 0,
};

export function computeSaleTotals(items: z.infer<typeof itemSchema>[], descuento: string) {
  let subtotal = Money.zero();
  let tax = Money.zero();
  for (const item of items) {
    const line = Money.fromString(item.precioUnitario).mul(item.cantidad);
    const lineTax = line.mul(item.taxRate);
    subtotal = subtotal.add(line);
    tax = tax.add(lineTax);
  }
  const disc = Money.fromString(descuento);
  const total = subtotal.add(tax).sub(disc).round(2);
  return {
    subtotal: subtotal.round(2).toFixed(2),
    impuestos: tax.round(2).toFixed(2),
    descuento: disc.round(2).toFixed(2),
    total: total.toFixed(2),
  };
}

export async function createSale(
  tenantId: string,
  authorId: string,
  rol: RoleCode,
  input: unknown,
) {
  const data = saleSchema.parse(input);
  const totals = computeSaleTotals(data.items, data.descuento);
  const cap = DISCOUNT_CAPS[rol] ?? 0;
  const disc = Money.fromString(data.descuento);
  if (disc.isNegative() || disc.cmp(Money.fromString(totals.subtotal)) > 0) {
    throw new AppError(400, 'Descuento inválido', 'El descuento no puede ser negativo ni mayor que el subtotal.', 'validation');
  }
  const exceedsCap = disc.mul(100).cmp(Money.fromString(totals.subtotal).mul(cap)) > 0;
  if (exceedsCap) {
    if (!data.supervisorPin) {
      throw new AppError(
        403,
        'PIN de supervisor',
        'El descuento supera el tope de tu rol. Pide autorización.',
        'discount_cap',
      );
    }
    await withTenant(tenantId, async (client) => {
      const managers = await client.query<{ pin_hash: string | null }>(
        `SELECT pin_hash FROM app.acceso
         WHERE tenant_id=$1 AND rol IN ('owner','manager') AND estado='active' AND pin_hash IS NOT NULL`,
        [tenantId],
      );
      let ok = false;
      for (const m of managers.rows) {
        if (m.pin_hash && (await verifyPin(m.pin_hash, data.supervisorPin!))) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        throw new AppError(403, 'PIN inválido', 'El PIN de supervisor no es válido.', 'pin');
      }
    });
  }

  const id = newUuidsV7();
  return withTenant(tenantId, async (client) => {
    const dup = await client.query(`SELECT id FROM app.venta WHERE tenant_id=$1 AND client_uuid=$2`, [
      tenantId,
      data.clientUuid,
    ]);
    if (dup.rows[0]) {
      return { id: dup.rows[0].id as string, duplicate: true, totals };
    }

    await client.query(
      `INSERT INTO app.venta
        (tenant_id, id, client_uuid, cliente_nombre, items, descuento, impuestos, total, author_id, device_id, fx_rate, fx_source, fx_date, fiscal_status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,'pending')`,
      [
        tenantId,
        id,
        data.clientUuid,
        data.clienteNombre ?? null,
        JSON.stringify(data.items),
        totals.descuento,
        totals.impuestos,
        totals.total,
        authorId,
        data.deviceId ?? null,
        data.fxRate ?? null,
        data.fxSource ?? null,
        data.fxDate ?? null,
      ],
    );

    for (const item of data.items) {
      await appendMovementWithClient(client, tenantId, authorId, {
        tipo: 'sale',
        productoId: item.productoId,
        cantidad: item.cantidad,
        costo: '0',
        motivoCodigo: 'venta',
        referencia: id,
        clientUuid: newUuidsV7(),
        deviceId: data.deviceId,
      });
    }

    // Enqueue e-CF (never blocks sale)
    await client.query(
      `INSERT INTO app.comprobante_fiscal (tenant_id, id, venta_id, tipo, estado_dgii)
       VALUES ($1,$2,$3,'e-CF','pending')
       ON CONFLICT (tenant_id, venta_id) DO NOTHING`,
      [tenantId, newUuidsV7(), id],
    );

    await appendAudit(client, {
      tenantId,
      action: 'create',
      entity: 'venta',
      entityId: id,
      before: null,
      after: { total: totals.total, items: data.items.length },
      authorId,
      deviceId: data.deviceId,
    });

    return { id, duplicate: false, totals, fiscalStatus: 'pending' };
  });
}

export async function voidSale(
  tenantId: string,
  authorId: string,
  ventaId: string,
  reason: string,
) {
  if (!reason.trim()) {
    throw new AppError(400, 'Motivo requerido', 'La anulación necesita un motivo.', 'validation');
  }
  return withTenant(tenantId, async (client) => {
    const venta = await client.query<{
      estado: string;
      fiscal_status: string;
      items: unknown;
      total: string;
    }>(`SELECT estado, fiscal_status, items, total FROM app.venta WHERE tenant_id=$1 AND id=$2`, [
      tenantId,
      ventaId,
    ]);
    const v = venta.rows[0];
    if (!v) throw new AppError(404, 'Venta no encontrada', 'No existe esa venta.', 'not_found');
    if (v.estado === 'voided') {
      throw new AppError(409, 'Ya anulada', 'Esta venta ya fue anulada.', 'voided');
    }
    // TODO: VERIFICAR EN VIVO — credit note rules when e-CF accepted
    if (v.fiscal_status === 'accepted' || v.fiscal_status === 'accepted_conditional') {
      throw new AppError(
        409,
        'Nota de crédito',
        'Con e-CF emitido solo se anula mediante nota de crédito.',
        'credit_note_required',
      );
    }
    await client.query(
      `UPDATE app.venta SET estado='voided', void_reason=$3, voided_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND id=$2`,
      [tenantId, ventaId, reason],
    );
    const items = v.items as Array<{ productoId: string; cantidad: string }>;
    for (const item of items) {
      await appendMovementWithClient(client, tenantId, authorId, {
        tipo: 'void_sale',
        productoId: item.productoId,
        cantidad: item.cantidad,
        costo: '0',
        motivoCodigo: 'anulacion',
        motivo: reason,
        referencia: ventaId,
        clientUuid: newUuidsV7(),
      });
    }
    await appendAudit(client, {
      tenantId,
      action: 'void',
      entity: 'venta',
      entityId: ventaId,
      before: { estado: 'completed' },
      after: { estado: 'voided', reason },
      authorId,
    });
    return { id: ventaId, voided: true };
  });
}

export { ROLE_HIERARCHY };
