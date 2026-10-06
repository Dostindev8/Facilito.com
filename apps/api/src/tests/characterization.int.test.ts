import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addStaff, api, bootApp, createProduct, register, shutdown, type Session } from './helpers.js';

/**
 * Characterization tests (Fase 0, super prompt v2.0 §5.6): they pin behaviour that works in production today so later
 * phases can prove they preserve it. A failure here means existing behaviour changed; update the expectation only when
 * that change is the intended outcome of the phase.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await shutdown(app);
});

const CONCURRENT = 200;

function invoice(productoId: string, extra: Record<string, unknown> = {}) {
  return { clientUuid: randomUUID(), metodoPago: 'efectivo', ncfTipo: null, lineas: [{ productoId, cantidad: '1' }], ...extra };
}

describe('emisión concurrente de comprobantes', () => {
  it(`${CONCURRENT} facturas simultáneas reciben ${CONCURRENT} NCF únicos, consecutivos y sin saltos`, async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { nombre: 'Agua 500ml', costo: '15', precioVenta: '25', stockInicial: '500' });
    expect((await api(app, s).put('/v1/settings/ncf', { tipo: 'B02', desde: 1, hasta: 1000 })).statusCode).toBe(200);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => api(app, s).post('/v1/invoices', invoice(p.id, { ncfTipo: 'B02' }))),
    );

    expect(results.map((r) => r.statusCode).filter((c) => c !== 201)).toEqual([]);
    const ncfs = results.map((r) => r.json().ncf as string).sort();
    const expected = Array.from({ length: CONCURRENT }, (_, i) => `B02${String(i + 1).padStart(8, '0')}`);
    expect(ncfs).toEqual(expected);
    const numeros = results.map((r) => r.json().numero as number).sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: CONCURRENT }, (_, i) => i + 1));

    expect((await api(app, s).get(`/v1/products/${p.id}`)).json().stockActual).toBe(String(500 - CONCURRENT));
    const ncf = (await api(app, s).get('/v1/settings/ncf')).json();
    expect(ncf.secuencias[0]).toMatchObject({ tipo: 'B02', siguiente: CONCURRENT + 1 });
  }, 180_000);
});

describe('reportes fiscales 606/607/608 (estado actual)', () => {
  let owner: Session;
  beforeAll(async () => {
    owner = await register(app);
  });

  it('hoy responden un stub sin datos; la Fase 2 debe reemplazarlo por el formato DGII', async () => {
    for (const r of ['606', '607', '608']) {
      const res = await api(app, owner).get(`/v1/reports/${r}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ report: r, status: 'stub', note: 'TODO: VERIFICAR EN VIVO' });
    }
  });

  it('solo dueño, gerente y contador pueden pedirlos', async () => {
    const cashier = await addStaff(app, owner.tenantId, 'cashier');
    const accountant = await addStaff(app, owner.tenantId, 'accountant');
    expect((await api(app, cashier).get('/v1/reports/607')).statusCode).toBe(403);
    expect((await api(app, accountant).get('/v1/reports/607')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/reports/607' })).statusCode).toBe(401);
  });
});
