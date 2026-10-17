import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDriver } from '../db/client.js';
import { addStaff, api, bootApp, createProduct, register, shutdown, type Session } from './helpers.js';

let app: FastifyInstance;
let owner: Session;
let cashier: Session;
let productId: string;

beforeAll(async () => {
  app = await bootApp();
  owner = await register(app);
  cashier = await addStaff(app, owner.tenantId, 'cashier');
  productId = (await createProduct(app, owner, { nombre: 'Leche Rica 1L', costo: '60', precioVenta: '100', stockInicial: '50' })).id;
});
afterAll(async () => {
  await shutdown(app);
});

const sale = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ clientUuid: randomUUID(), items, ...extra });

describe('POST /v1/sales — el precio y el ITBIS salen del catálogo (TD-009)', () => {
  it('un cajero no puede alterar el precio de venta', async () => {
    const res = await api(app, cashier).post('/v1/sales', sale([{ productoId: productId, cantidad: '2', precioUnitario: '0.01', taxRate: '0' }]));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('price_override');
  });

  it('sin precio usa el del catálogo e ignora la tasa enviada por el cliente', async () => {
    const res = await api(app, cashier).post('/v1/sales', sale([{ productoId: productId, cantidad: '2', taxRate: '0' }]));
    expect(res.statusCode).toBe(200);
    expect(res.json().totals).toMatchObject({ subtotal: '200.00', impuestos: '36.00', total: '236.00' });
  });

  it('un precio igual al del catálogo es aceptado para un cajero', async () => {
    const res = await api(app, cashier).post('/v1/sales', sale([{ productoId: productId, cantidad: '1', precioUnitario: '100.00' }]));
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.total).toBe('118.00');
  });

  it('el dueño sí puede cambiar el precio; el ITBIS sigue siendo el del producto', async () => {
    const res = await api(app, owner).post('/v1/sales', sale([{ productoId: productId, cantidad: '1', precioUnitario: '50', taxRate: '0' }]));
    expect(res.statusCode).toBe(200);
    expect(res.json().totals).toMatchObject({ subtotal: '50.00', impuestos: '9.00', total: '59.00' });
  });

  it('rechaza productos de otro negocio', async () => {
    const other = await register(app);
    const foreign = await createProduct(app, other);
    const res = await api(app, cashier).post('/v1/sales', sale([{ productoId: foreign.id, cantidad: '1' }]));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('reference');
  });

  it('un reintento con el mismo clientUuid devuelve los totales guardados', async () => {
    const body = sale([{ productoId: productId, cantidad: '3' }]);
    const a = await api(app, cashier).post('/v1/sales', body);
    const b = await api(app, cashier).post('/v1/sales', body);
    expect(b.json()).toMatchObject({ id: a.json().id, duplicate: true, totals: a.json().totals });
  });

  it('no vende un producto inactivo', async () => {
    const inactive = await createProduct(app, owner, { nombre: 'Yogurt viejo', estado: 'inactivo' });
    const res = await api(app, cashier).post('/v1/sales', sale([{ productoId: inactive.id, cantidad: '1' }]));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('product_inactive');
  });
});

describe('POST /v1/sales — descuentos con tope por rol y PIN de supervisor', () => {
  const line = () => [{ productoId: productId, cantidad: '1' }];

  it('rechaza un descuento mayor que el subtotal', async () => {
    const res = await api(app, owner).post('/v1/sales', sale(line(), { descuento: '100.01' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation');
  });

  it('el cajero respeta su tope (10 %): sobre el tope exige un PIN válido de dueño o gerente', async () => {
    expect((await api(app, cashier).post('/v1/sales', sale(line(), { descuento: '10' }))).statusCode).toBe(200);

    const capped = await api(app, cashier).post('/v1/sales', sale(line(), { descuento: '20' }));
    expect(capped.statusCode).toBe(403);
    expect(capped.json().code).toBe('discount_cap');

    expect((await api(app, owner).post('/v1/access/pin', { pin: '4321' })).statusCode).toBeLessThan(300);
    const wrong = await api(app, cashier).post('/v1/sales', sale(line(), { descuento: '20', supervisorPin: '9999' }));
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('pin');

    const ok = await api(app, cashier).post('/v1/sales', sale(line(), { descuento: '20', supervisorPin: '4321' }));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().totals.descuento).toBe('20.00');
  });
});

describe('POST /v1/sales/:id/void — anulación', () => {
  const stock = async () => Number((await api(app, owner).get(`/v1/inventory/stock/${productId}`)).json().stock);

  it('devuelve el stock, deja rastro y no se repite', async () => {
    const before = await stock();
    const created = await api(app, cashier).post('/v1/sales', sale([{ productoId: productId, cantidad: '4' }]));
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    expect(await stock()).toBe(before - 4);

    expect((await api(app, cashier).post(`/v1/sales/${id}/void`, { reason: 'Cliente devolvió todo' })).statusCode).toBe(403);
    expect((await api(app, owner).post(`/v1/sales/${id}/void`, { reason: 'no' })).statusCode).toBe(400);

    const voided = await api(app, owner).post(`/v1/sales/${id}/void`, { reason: 'Cliente devolvió todo' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(voided.json()).toEqual({ id, voided: true });
    expect(await stock()).toBe(before);

    const again = await api(app, owner).post(`/v1/sales/${id}/void`, { reason: 'Cliente devolvió todo' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('voided');
    expect(await stock()).toBe(before);
  });

  it('una venta inexistente responde 404', async () => {
    const res = await api(app, owner).post(`/v1/sales/${randomUUID()}/void`, { reason: 'Error de digitación' });
    expect(res.statusCode).toBe(404);
  });

  it('con e-CF aceptado solo se anula con nota de crédito', async () => {
    const created = await api(app, owner).post('/v1/sales', sale([{ productoId: productId, cantidad: '1' }]));
    const id = created.json().id as string;
    const adminConn = await (await getDriver()).admin();
    try {
      await adminConn.query(`UPDATE app.venta SET fiscal_status = 'accepted' WHERE tenant_id = $1 AND id = $2`, [owner.tenantId, id]);
    } finally {
      await adminConn.release();
    }
    const res = await api(app, owner).post(`/v1/sales/${id}/void`, { reason: 'Cliente devolvió todo' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('credit_note_required');
  });
});
