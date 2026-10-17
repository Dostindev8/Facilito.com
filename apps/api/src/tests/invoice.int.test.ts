import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addStaff, api, bootApp, createProduct, register, shutdown, type Session } from './helpers.js';

let app: FastifyInstance;
let owner: Session;

beforeAll(async () => {
  app = await bootApp();
  owner = await register(app);
});
afterAll(async () => {
  await shutdown(app);
});

const stockOf = async (s: Session, id: string) => (await api(app, s).get(`/v1/products/${id}`)).json().stockActual as string;

function invoice(lineas: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return { clientUuid: randomUUID(), metodoPago: 'efectivo', ncfTipo: null, lineas, ...extra };
}

describe('flujo E2E de negocio: producto → factura → stock → anulación → restauración', () => {
  it('descuenta stock atómicamente y lo restaura al anular sin borrar la factura', async () => {
    const p = await createProduct(app, owner, { nombre: 'Aceite Crisol 1L', costo: '150', precioVenta: '200', stockInicial: '10' });
    const res = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '3', descuento: '10' }]));
    expect(res.statusCode).toBe(201);
    const f = res.json();
    expect(f).toMatchObject({ numero: 1, numeroLabel: 'FAC-000001', estado: 'pagada', clienteNombre: 'Cliente general', subtotal: '590.00', descuentoTotal: '10.00', itbisTotal: '106.20', total: '696.20' });
    expect(f.lineas[0]).toMatchObject({ cantidad: '3', precioUnitario: '200.00', itbis: '106.20' });
    expect(await stockOf(owner, p.id)).toBe('7');

    const kardex = (await api(app, owner).get(`/v1/products/${p.id}/kardex`)).json();
    expect(kardex.items[0]).toMatchObject({ motivo: 'venta', referencia: 'FAC-000001', salida: '3', saldo: '7' });

    const v = await api(app, owner).post(`/v1/invoices/${f.id}/void`, { motivo: 'Cliente devolvió todo' });
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({ estado: 'anulada', motivoAnulacion: 'Cliente devolvió todo', numero: 1 });
    expect(await stockOf(owner, p.id)).toBe('10');

    const again = await api(app, owner).post(`/v1/invoices/${f.id}/void`, { motivo: 'Otra vez' });
    expect(again.statusCode).toBe(409);

    const still = await api(app, owner).get(`/v1/invoices/${f.id}`);
    expect(still.statusCode).toBe(200);

    const next = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]));
    expect(next.json().numero).toBe(2);
  });

  it('no permite facturar más del stock disponible y no consume número ni stock', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { nombre: 'Salami', stockInicial: '2' });
    const q = await createProduct(app, s, { nombre: 'Queso', stockInicial: '5' });
    const res = await api(app, s).post('/v1/invoices', invoice([{ productoId: q.id, cantidad: '1' }, { productoId: p.id, cantidad: '1.5' }, { productoId: p.id, cantidad: '1' }]));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('stock');
    expect(res.json().detail).toContain('Salami');
    expect(await stockOf(s, q.id)).toBe('5');
    const ok = await api(app, s).post('/v1/invoices', invoice([{ productoId: q.id, cantidad: '1' }]));
    expect(ok.json().numero).toBe(1);
  });

  it('permite stock negativo solo si el negocio lo habilita', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { stockInicial: '1' });
    expect((await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '2' }]))).statusCode).toBe(409);
    expect((await api(app, s).patch('/v1/settings', { permiteStockNegativo: true })).statusCode).toBe(200);
    expect((await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '2' }]))).statusCode).toBe(201);
    expect(await stockOf(s, p.id)).toBe('-1');
  });
});

describe('numeración, NCF e idempotencia', () => {
  it('reintento con el mismo clientUuid devuelve la misma factura sin duplicar stock', async () => {
    const p = await createProduct(app, owner, { stockInicial: '10' });
    const body = invoice([{ productoId: p.id, cantidad: '2' }]);
    const a = await api(app, owner).post('/v1/invoices', body);
    const b = await api(app, owner).post('/v1/invoices', body);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ id: a.json().id, duplicate: true });
    expect(await stockOf(owner, p.id)).toBe('8');
  });

  it('facturas concurrentes reciben números únicos y consecutivos', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { stockInicial: '100' });
    const results = await Promise.all(Array.from({ length: 6 }, () => api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]))));
    const nums = results.map((r) => r.json().numero).sort((x: number, y: number) => x - y);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await stockOf(s, p.id)).toBe('94');
  });

  it('consume la secuencia NCF configurada y la agota correctamente', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { stockInicial: '50' });
    const none = await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { ncfTipo: 'B02' }));
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('ncf_unavailable');

    expect((await api(app, s).put('/v1/settings/ncf', { tipo: 'B02', desde: 1, hasta: 2 })).statusCode).toBe(200);
    const f1 = await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { ncfTipo: 'B02' }));
    expect(f1.json().ncf).toBe('B0200000001');
    const f2 = await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { ncfTipo: 'B02' }));
    expect(f2.json().ncf).toBe('B0200000002');
    const f3 = await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { ncfTipo: 'B02' }));
    expect(f3.statusCode).toBe(409);

    const reuse = await api(app, s).put('/v1/settings/ncf', { tipo: 'B02', desde: 1, hasta: 100 });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().code).toBe('ncf_reuse');

    await api(app, s).post(`/v1/invoices/${f1.json().id}/void`, { motivo: 'Error de digitación' });
    expect((await api(app, s).put('/v1/settings/ncf', { tipo: 'B02', desde: 3, hasta: 100 })).statusCode).toBe(200);
    const f4 = await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { ncfTipo: 'B02' }));
    expect(f4.json().ncf).toBe('B0200000003');
    const ncfList = (await api(app, s).get('/v1/settings/ncf')).json();
    expect(ncfList.secuencias[0]).toMatchObject({ tipo: 'B02', siguiente: 4, disponibles: 97 });
  });

  it('negocio nuevo factura sin NCF hasta registrar su primera secuencia, que pasa a ser la predeterminada', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { stockInicial: '10' });
    const { ncfTipo: _omit, ...sinTipo } = invoice([{ productoId: p.id, cantidad: '1' }]);
    expect((await api(app, s).get('/v1/settings')).json().ncfTipoDefault).toBeNull();
    const first = await api(app, s).post('/v1/invoices', sinTipo);
    expect(first.statusCode).toBe(201);
    expect(first.json().ncf).toBeNull();

    expect((await api(app, s).put('/v1/settings/ncf', { tipo: 'B02', desde: 1, hasta: 10 })).statusCode).toBe(200);
    expect((await api(app, s).get('/v1/settings')).json().ncfTipoDefault).toBe('B02');
    const second = await api(app, s).post('/v1/invoices', { ...sinTipo, clientUuid: randomUUID() });
    expect(second.json().ncf).toBe('B0200000001');

    expect((await api(app, s).patch('/v1/settings', { ncfTipoDefault: null })).statusCode).toBe(200);
    const third = await api(app, s).post('/v1/invoices', { ...sinTipo, clientUuid: randomUUID() });
    expect(third.json().ncf).toBeNull();
  });

  it('secuencia vencida no se usa', async () => {
    const s = await register(app);
    const p = await createProduct(app, s);
    await api(app, s).put('/v1/settings/ncf', { tipo: 'B01', desde: 1, hasta: 10, vence: '2020-01-01' });
    const r = await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { ncfTipo: 'B01' }));
    expect(r.statusCode).toBe(409);
  });
});

describe('ITBIS, crédito, cobro y cliente', () => {
  it('ITBIS global configurable', async () => {
    const s = await register(app);
    await api(app, s).patch('/v1/settings', { itbisModo: 'global' });
    const a = await createProduct(app, s, { costo: '0.10', precioVenta: '0.35', stockInicial: '10' });
    const r = await api(app, s).post('/v1/invoices', invoice([{ productoId: a.id, cantidad: '1' }, { productoId: a.id, cantidad: '1' }, { productoId: a.id, cantidad: '1' }]));
    expect(r.json()).toMatchObject({ itbisModo: 'global', subtotal: '1.05', itbisTotal: '0.19', total: '1.24' });
  });

  it('producto exento (ITBIS 0)', async () => {
    const p = await createProduct(app, owner, { itbisTasa: '0', precioVenta: '100', costo: '50' });
    const r = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]));
    expect(r.json()).toMatchObject({ itbisTotal: '0.00', total: '100.00' });
  });

  it('crédito exige vencimiento, queda pendiente, se marca vencida y luego pagada', async () => {
    const p = await createProduct(app, owner, { stockInicial: '10' });
    const noDue = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { metodoPago: 'credito' }));
    expect(noDue.statusCode).toBe(400);
    const past = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { metodoPago: 'credito', fechaVencimiento: '2020-01-01' }));
    expect(past.statusCode).toBe(400);

    const c = await api(app, owner).post('/v1/customers', { nombre: 'Ferretería Juan', documento: '131-00000-2', telefono: '809-555-0101' });
    expect(c.statusCode).toBe(201);
    expect(c.json().documento).toBe('•••••0002');
    const future = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    const f = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { metodoPago: 'credito', fechaVencimiento: future, clienteId: c.json().id }));
    expect(f.json()).toMatchObject({ estado: 'pendiente', clienteNombre: 'Ferretería Juan', fechaVencimiento: future });

    const pay = await api(app, owner).post(`/v1/invoices/${f.json().id}/pay`, { metodoPago: 'transferencia' });
    expect(pay.json().estado).toBe('pagada');
    expect((await api(app, owner).post(`/v1/invoices/${f.json().id}/pay`, {})).statusCode).toBe(409);
  });

  it('cliente de otro negocio no se puede usar', async () => {
    const other = await register(app);
    const c = await api(app, other).post('/v1/customers', { nombre: 'Ajeno' });
    const p = await createProduct(app, owner);
    const r = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { clienteId: c.json().id }));
    expect(r.statusCode).toBe(400);
  });

  it('producto inactivo no se puede facturar', async () => {
    const p = await createProduct(app, owner);
    await api(app, owner).patch(`/v1/products/${p.id}`, { estado: 'inactivo' });
    const r = await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('product_inactive');
  });

  it('validaciones: sin líneas, cantidad 0, descuento mayor al importe, campos extra', async () => {
    const p = await createProduct(app, owner);
    const cases = [
      invoice([]),
      invoice([{ productoId: p.id, cantidad: '0' }]),
      invoice([{ productoId: p.id, cantidad: '1', descuento: '1000' }]),
      invoice([{ productoId: p.id, cantidad: '1' }], { total: '1.00' }),
      invoice([{ productoId: p.id, cantidad: '1' }], { metodoPago: 'bitcoin' }),
    ];
    const codes = [];
    for (const c of cases) codes.push((await api(app, owner).post('/v1/invoices', c)).statusCode);
    expect(codes).toEqual([400, 400, 400, 400, 400]);
  });
});

describe('roles en facturación', () => {
  it('cajero factura al precio de lista, con tope de descuento 10%, y no puede anular', async () => {
    const cashier = await addStaff(app, owner.tenantId, 'cashier');
    const p = await createProduct(app, owner, { precioVenta: '100', stockInicial: '20' });
    const priced = await api(app, cashier).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1', precioUnitario: '1.00' }]));
    expect(priced.statusCode).toBe(403);
    expect(priced.json().code).toBe('price_override');
    const disc = await api(app, cashier).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1', descuento: '11' }]));
    expect(disc.statusCode).toBe(403);
    const ok = await api(app, cashier).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1', descuento: '10' }]));
    expect(ok.statusCode).toBe(201);
    const v = await api(app, cashier).post(`/v1/invoices/${ok.json().id}/void`, { motivo: 'No autorizado' });
    expect(v.statusCode).toBe(403);
  });

  it('viewer no puede facturar; almacén no puede cambiar configuración', async () => {
    const viewer = await addStaff(app, owner.tenantId, 'viewer');
    const p = await createProduct(app, owner);
    expect((await api(app, viewer).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]))).statusCode).toBe(403);
    const wh = await addStaff(app, owner.tenantId, 'warehouse');
    expect((await api(app, wh).patch('/v1/settings', { itbisModo: 'global' })).statusCode).toBe(403);
    expect((await api(app, wh).put('/v1/settings/ncf', { tipo: 'B02', desde: 1, hasta: 5 })).statusCode).toBe(403);
  });

  it('otro negocio no puede ver, anular, cobrar ni descargar el PDF', async () => {
    const other = await register(app);
    const p = await createProduct(app, owner);
    const f = (await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]))).json();
    const o = api(app, other);
    expect((await o.get(`/v1/invoices/${f.id}`)).statusCode).toBe(404);
    expect((await o.post(`/v1/invoices/${f.id}/void`, { motivo: 'ataque cruzado' })).statusCode).toBe(404);
    expect((await o.post(`/v1/invoices/${f.id}/pay`, {})).statusCode).toBe(404);
    expect((await o.get(`/v1/invoices/${f.id}/pdf`)).statusCode).toBe(404);
    expect((await o.get('/v1/invoices')).json().items.some((x: { id: string }) => x.id === f.id)).toBe(false);
    const pOther = await createProduct(app, other);
    expect((await api(app, owner).post('/v1/invoices', invoice([{ productoId: pOther.id, cantidad: '1' }]))).statusCode).toBe(400);
  });
});

describe('listado, PDF, reportes y envío', () => {
  it('lista con filtros por estado, búsqueda y totales', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { stockInicial: '50', precioVenta: '100' });
    const c = (await api(app, s).post('/v1/customers', { nombre: 'María López' })).json();
    const f1 = (await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }], { clienteId: c.id }))).json();
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '2' }], { metodoPago: 'credito', fechaVencimiento: future }));
    const f3 = (await api(app, s).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]))).json();
    await api(app, s).post(`/v1/invoices/${f3.id}/void`, { motivo: 'Prueba de anulación' });

    const all = (await api(app, s).get('/v1/invoices')).json();
    expect(all.total).toBe(3);
    expect(all.sumaTotal).toBe('354.00');
    expect((await api(app, s).get('/v1/invoices?estado=pendiente')).json().total).toBe(1);
    expect((await api(app, s).get('/v1/invoices?estado=anulada')).json().total).toBe(1);
    expect((await api(app, s).get('/v1/invoices?q=mar%C3%ADa')).json().items[0].id).toBe(f1.id);
    expect((await api(app, s).get(`/v1/invoices?q=FAC-000001`)).json().items[0].id).toBe(f1.id);
    expect((await api(app, s).get('/v1/invoices?estado=borrada')).statusCode).toBe(400);
  });

  it('genera PDF válido con cabeceras seguras', async () => {
    const p = await createProduct(app, owner);
    const f = (await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '2' }]))).json();
    const pdf = await api(app, owner).get(`/v1/invoices/${f.id}/pdf?download=1`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/attachment; filename="FAC-\d{6}\.pdf"/);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(1500);
  });

  it('reporte por rango en JSON, CSV (Excel) y PDF; valida el rango', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
    const json = await api(app, owner).get(`/v1/reports/invoices?desde=${today}&hasta=${today}`);
    expect(json.statusCode).toBe(200);
    expect(json.json().resumen.facturas).toBeGreaterThan(0);
    const csv = await api(app, owner).get(`/v1/reports/invoices?desde=${today}&hasta=${today}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')[0]).toContain('numero,ncf,fecha,cliente');
    const pdf = await api(app, owner).get(`/v1/reports/invoices?desde=${today}&hasta=${today}&format=pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await api(app, owner).get(`/v1/reports/invoices?desde=2026-02-01&hasta=2026-01-01`)).statusCode).toBe(400);
    const cashier = await addStaff(app, owner.tenantId, 'cashier');
    expect((await api(app, cashier).get(`/v1/reports/invoices?desde=${today}&hasta=${today}`)).statusCode).toBe(403);
  });

  it('WhatsApp genera enlace wa.me seguro; email reporta proveedor no configurado', async () => {
    const p = await createProduct(app, owner);
    const f = (await api(app, owner).post('/v1/invoices', invoice([{ productoId: p.id, cantidad: '1' }]))).json();
    const wa = await api(app, owner).post(`/v1/invoices/${f.id}/whatsapp`, { telefono: '(809) 555-0101' });
    expect(wa.json().url).toMatch(/^https:\/\/wa\.me\/18095550101\?text=/);
    expect((await api(app, owner).post(`/v1/invoices/${f.id}/whatsapp`, { telefono: 'abc' })).statusCode).toBe(400);
    expect((await api(app, owner).get(`/v1/invoices/${f.id}`)).json().emailDisponible).toBe(false);
    const mail = await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: 'cliente@example.com' });
    expect(mail.statusCode).toBe(503);
    expect(mail.json().code).toBe('email_provider_not_configured');
  });
});
