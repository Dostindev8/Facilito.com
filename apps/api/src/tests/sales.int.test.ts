import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
