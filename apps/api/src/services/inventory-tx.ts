import { Money, newUuidsV7 } from '@facilito/domain';
import type { Queryable } from '../db/client.js';
import { appendAudit } from '../audit/append.js';
import { AppError } from '../http/errors.js';

export type MovementTipo = 'in' | 'out' | 'adjust' | 'sale' | 'void_sale' | 'count';
export type MotivoCodigo =
  | 'merma'
  | 'devolucion'
  | 'conteo_fisico'
  | 'ajuste'
  | 'compra'
  | 'venta'
  | 'anulacion'
  | 'inicial';

export interface MovementInput {
  tipo: MovementTipo;
  productoId: string;
  loteId?: string;
  cantidad: string;
  costo: string;
  motivoCodigo?: MotivoCodigo;
  motivo?: string;
  referencia?: string;
  clientUuid: string;
  deviceId?: string;
}

/**
 * Appends one inventory movement inside the caller's transaction.
 * Stock is updated by the `movimiento_apply` trigger, which also rejects negative stock,
 * so this cannot be bypassed by any caller. `audit: false` lets a parent operation
 * (e.g. an invoice) write a single audit entry for the whole document.
 */
export async function appendMovementWithClient(
  q: Queryable,
  tenantId: string,
  authorId: string,
  data: MovementInput,
  options: { audit?: boolean } = {},
): Promise<{ id: string; duplicate: boolean; stockResultante: string }> {
  const qty = Money.fromString(data.cantidad);
  if (qty.isZero()) throw new AppError(400, 'Cantidad inválida', 'La cantidad no puede ser cero.', 'validation');
  if (data.tipo !== 'adjust' && data.tipo !== 'count' && qty.isNegative()) {
    throw new AppError(400, 'Cantidad inválida', 'La cantidad debe ser positiva.', 'validation');
  }
  const costo = Money.fromString(data.costo || '0');
  if (costo.isNegative()) throw new AppError(400, 'Costo inválido', 'El costo no puede ser negativo.', 'validation');

  const id = newUuidsV7();
  const guard = await q.query<{ movimiento_id: string }>(
    `INSERT INTO app.movimiento_client_uuid (tenant_id, client_uuid, movimiento_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, client_uuid) DO NOTHING
     RETURNING movimiento_id`,
    [tenantId, data.clientUuid, id],
  );
  if (!guard.rows[0]) {
    const prev = await q.query<{ movimiento_id: string }>(
      `SELECT movimiento_id FROM app.movimiento_client_uuid WHERE tenant_id=$1 AND client_uuid=$2`,
      [tenantId, data.clientUuid],
    );
    const stock = await q.query<{ stock_actual: string }>(
      `SELECT stock_actual::text FROM app.producto WHERE tenant_id=$1 AND id=$2`,
      [tenantId, data.productoId],
    );
    return {
      id: prev.rows[0]?.movimiento_id ?? id,
      duplicate: true,
      stockResultante: stock.rows[0]?.stock_actual ?? '0',
    };
  }

  const inserted = await q.query<{ stock_resultante: string }>(
    `INSERT INTO app.movimiento_inventario
      (tenant_id, id, tipo, producto_id, lote_id, cantidad, costo, motivo_codigo, motivo, referencia,
       author_id, device_id, client_uuid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING stock_resultante::text`,
    [
      tenantId,
      id,
      data.tipo,
      data.productoId,
      data.loteId ?? null,
      qty.toString(),
      costo.toString(),
      data.motivoCodigo ?? null,
      data.motivo ?? null,
      data.referencia ?? null,
      authorId,
      data.deviceId ?? null,
      data.clientUuid,
    ],
  );
  const stockResultante = inserted.rows[0]?.stock_resultante ?? '0';

  if (options.audit !== false) {
    await appendAudit(q, {
      tenantId,
      action: 'create',
      entity: 'movimiento_inventario',
      entityId: id,
      before: null,
      after: {
        tipo: data.tipo,
        cantidad: qty.toString(),
        productoId: data.productoId,
        motivo: data.motivoCodigo ?? data.motivo ?? null,
        stockResultante,
      },
      authorId,
      deviceId: data.deviceId,
    });
  }
  return { id, duplicate: false, stockResultante };
}
