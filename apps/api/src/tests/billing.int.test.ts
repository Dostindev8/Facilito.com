import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDriver, withAuthBootstrap } from '../db/client.js';
import { resetEnvForTests } from '../config/env.js';
import { __resetSessionStatusForTests } from '../auth/session-status.js';
import { signWebhook } from '../services/billing-providers.js';
import { addStaff, api, bootApp, multipartBody, PASSWORD, platformAdminSession, refreshCookieFrom, register, shutdown } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_only_0123456789abcdef';
Object.assign(process.env, {
  BILLING_BANK_NAME: 'Banco Popular Dominicano',
  BILLING_BANK_ACCOUNT: '000-000000-0',
  BILLING_BANK_ACCOUNT_TYPE: 'Corriente',
  BILLING_BANK_HOLDER: 'Logic Code Spot SRL',
  BILLING_BANK_HOLDER_ID: '1-31-00000-0',
  BILLING_WEBHOOK_SECRET: WEBHOOK_SECRET,
  CRON_SECRET: 'cron_test_only_secret_value',
});

let app: FastifyInstance;
let admin: { token: string };
let png: Buffer;
let seq = 0;
let rncSeq = 501_000_000;

beforeAll(async () => {
  resetEnvForTests();
  app = await bootApp();
  admin = await platformAdminSession(app);
  png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
});
afterAll(async () => {
  await shutdown(app);
});

const adminApi = () => api(app, admin);

function applicant(over: Record<string, unknown> = {}) {
  seq++;
  return {
    planId: 'profesional',
    nombre: 'Carla Méndez',
    email: `cliente${seq}.${Date.now()}@facilito.test`,
    telefono: '809-555-0101',
    razonSocial: `Farmacia Carla ${seq}`,
    rnc: String(rncSeq++),
    tipoNegocio: 'Farmacia',
    referenciaPago: `TRX-${seq}`,
    aceptaTerminos: true,
    ...over,
  };
}

async function checkout(over: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: applicant(over) });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; token: string; estado: string; montoCentavos: number; instrucciones: { banco: string } };
}

async function uploadReceipt(id: string, token: string, file: Buffer = png, name = 'comprobante.png', type = 'image/png') {
  const mp = multipartBody('file', name, type, file);
  return app.inject({ method: 'POST', url: `/v1/billing/checkout/${id}/comprobante`, payload: mp.body, headers: { ...mp.headers, 'x-solicitud-token': token } });
}

async function pendingRequest(over: Record<string, unknown> = {}) {
  const c = await checkout(over);
  const up = await uploadReceipt(c.id, c.token);
  expect(up.statusCode, up.body).toBe(200);
  return c;
}

const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

async function activeOwner(over: Record<string, unknown> = {}) {
  const c = await pendingRequest(over);
  const auth = await adminApi().post(`/v1/platform/subscriptions/${c.id}/authorize`, { confirmar: true });
  expect(auth.statusCode, auth.body).toBe(200);
  const accept = await app.inject({
    method: 'POST',
    url: '/v1/auth/invitations/accept',
    payload: { token: tokenFrom(auth.json().activationUrl), password: PASSWORD },
  });
  expect(accept.statusCode, accept.body).toBe(200);
  const body = accept.json();
  return { subId: c.id, token: body.accessToken as string, cookie: refreshCookieFrom(accept), tenantId: body.user.tenantId as string, email: body.user.email as string };
}

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  return withAuthBootstrap(async (q) => (await q.query<T & Record<string, unknown>>(text, params)).rows);
}

describe('planes y checkout público', () => {
  it('lista planes en centavos DOP y métodos disponibles', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/plans' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: { id: string }) => p.id)).toEqual(['inicial', 'profesional', 'negocio']);
    expect(Number.isInteger(body.items[0].precioMensualCentavos)).toBe(true);
    expect(body.metodos).toEqual({ transferencia: true, tarjeta: false });
  });

  it('seed admin de planes es idempotente y no pisa filas existentes', async () => {
    const first = await adminApi().post('/v1/platform/billing/plans/seed');
    expect(first.statusCode).toBe(200);
    expect(first.json().total).toBeGreaterThanOrEqual(3);
    expect(first.json().inserted).toBe(0);
    const second = await adminApi().post('/v1/platform/billing/plans/seed');
    expect(second.statusCode).toBe(200);
    expect(second.json().inserted).toBe(0);
  });

  it('checkout con Idempotency-Key no crea una segunda solicitud', async () => {
    const payload = applicant();
    const key = `idem-key-${seq}-${Date.now()}`;
    const a = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload,
      headers: { 'idempotency-key': key },
    });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: applicant(),
      headers: { 'idempotency-key': key },
    });
    expect(b.statusCode).toBe(409);
    expect(b.json().code).toBe('request_open');
  });

  it('crea la solicitud en PENDIENTE_PAGO con instrucciones bancarias y token de seguimiento', async () => {
    const c = await checkout();
    expect(c.estado).toBe('PENDIENTE_PAGO');
    expect(c.montoCentavos).toBe(149000);
    expect(c.instrucciones.banco).toBe('Banco Popular Dominicano');
    const status = await app.inject({ method: 'GET', url: `/v1/billing/checkout/${c.id}`, headers: { 'x-solicitud-token': c.token } });
    expect(status.json()).toMatchObject({ estado: 'PENDIENTE_PAGO', comprobantes: 0 });
  });

  it('valida: términos, RNC, campos extra; rechaza email con cuenta y solicitudes duplicadas', async () => {
    const noTerms = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: applicant({ aceptaTerminos: false }) });
    expect(noTerms.statusCode).toBe(400);
    const badRnc = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: applicant({ rnc: '123' }) });
    expect((badRnc.json().errors as Array<{ field: string }>).map((e) => e.field)).toContain('rnc');
    const extra = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: { ...applicant(), rol: 'owner', tenantId: 'x' } });
    expect(extra.statusCode).toBe(400);

    const existing = await register(app);
    const taken = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: applicant({ email: existing.email.toUpperCase() }) });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('email_taken');

    const first = applicant();
    await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: first });
    const dup = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: { ...applicant(), rnc: first.rnc } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('request_open');
  });

  it('cerrado sin cuenta bancaria configurada (503), sin simular cobros', async () => {
    const saved = process.env.BILLING_BANK_ACCOUNT;
    delete process.env.BILLING_BANK_ACCOUNT;
    resetEnvForTests();
    try {
      const res = await app.inject({ method: 'POST', url: '/v1/billing/checkout', payload: applicant() });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('billing_unavailable');
    } finally {
      process.env.BILLING_BANK_ACCOUNT = saved;
      resetEnvForTests();
    }
  });

  it('comprobante: exige el token de la solicitud y rechaza archivos que no son imagen/PDF', async () => {
    const c = await checkout();
    expect((await uploadReceipt(c.id, 'x'.repeat(43))).statusCode).toBe(404);
    const fake = await uploadReceipt(c.id, c.token, Buffer.from('MZ not an image'), 'recibo.png');
    expect(fake.statusCode).toBe(400);
    const js = await uploadReceipt(c.id, c.token, Buffer.from('%PDF-1.4\n1 0 obj << /OpenAction 2 0 R /JS (app.alert(1)) >>'), 'recibo.pdf', 'application/pdf');
    expect(js.statusCode).toBe(400);
    const ok = await uploadReceipt(c.id, c.token);
    expect(ok.json().estado).toBe('PENDIENTE_AUTORIZACION');
  });
});

describe('autorización → invitación → contraseña → login', () => {
  it('camino feliz completo', async () => {
    const c = await pendingRequest({ nombre: 'Rosa Peña', razonSocial: 'Colmado Rosa' });

    const queue = await adminApi().get('/v1/platform/subscriptions?estado=PENDIENTE_AUTORIZACION');
    expect((queue.json().items as Array<{ id: string; comprobantesPendientes: number }>).find((s) => s.id === c.id)?.comprobantesPendientes).toBe(1);
    expect((await adminApi().get('/v1/platform/stats')).json().solicitudesPendientes).toBeGreaterThanOrEqual(1);

    expect((await adminApi().post(`/v1/platform/subscriptions/${c.id}/authorize`, {})).statusCode).toBe(400);
    const auth = await adminApi().post(`/v1/platform/subscriptions/${c.id}/authorize`, { confirmar: true, referencia: 'BPD-998877' });
    expect(auth.statusCode, auth.body).toBe(200);
    expect(auth.json()).toMatchObject({ estado: 'ACTIVA', emailEnviado: false, venceEnHoras: 72 });
    const token = tokenFrom(auth.json().activationUrl);

    const inspect = await app.inject({ method: 'POST', url: '/v1/auth/invitations/inspect', payload: { token } });
    expect(inspect.json()).toMatchObject({ negocio: 'Colmado Rosa', plan: 'Profesional' });

    const weak = await app.inject({ method: 'POST', url: '/v1/auth/invitations/accept', payload: { token, password: 'corta' } });
    expect(weak.statusCode).toBe(400);

    const accept = await app.inject({ method: 'POST', url: '/v1/auth/invitations/accept', payload: { token, password: PASSWORD } });
    expect(accept.statusCode).toBe(200);
    const user = accept.json().user;
    expect(user).toMatchObject({ rol: 'owner', negocio: 'Colmado Rosa', platformAdmin: false, suscripcion: { estado: 'ACTIVA', plan: 'Profesional', soloLectura: false } });

    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);

    const mine = await api(app, { token: accept.json().accessToken }).get('/v1/billing/mi-suscripcion');
    expect(mine.statusCode).toBe(200);
    expect(mine.json().pagos).toHaveLength(1);
    expect(mine.json().pagos[0]).toMatchObject({ tipo: 'cobro', montoCentavos: 149000, referencia: 'BPD-998877' });
    expect(mine.json().comprobantes[0].estado).toBe('aprobado');

    const pdf = await api(app, { token: accept.json().accessToken }).get(`/v1/billing/recibos/${mine.json().pagos[0].id}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const activity = (await adminApi().get('/v1/platform/activity')).json().items as Array<{ action: string; targetId: string }>;
    expect(activity.some((a) => a.action === 'suscripcion.autorizar' && a.targetId === c.id)).toBe(true);
  });

  it('la invitación es de un solo uso y vence; reenviar invalida la anterior', async () => {
    const c = await pendingRequest();
    const auth = await adminApi().post(`/v1/platform/subscriptions/${c.id}/authorize`, { confirmar: true });
    const first = tokenFrom(auth.json().activationUrl);

    const resent = await adminApi().post(`/v1/platform/subscriptions/${c.id}/resend-invitation`, { confirmar: true });
    expect(resent.statusCode).toBe(200);
    const second = tokenFrom(resent.json().activationUrl);
    const old = await app.inject({ method: 'POST', url: '/v1/auth/invitations/accept', payload: { token: first, password: PASSWORD } });
    expect(old.json().code).toBe('invitation_invalid');

    await sql(`UPDATE billing.invitacion SET expires_at = now() - interval '1 minute' WHERE suscripcion_id = $1 AND revoked_at IS NULL`, [c.id]);
    const expired = await app.inject({ method: 'POST', url: '/v1/auth/invitations/accept', payload: { token: second, password: PASSWORD } });
    expect(expired.json().code).toBe('invitation_invalid');

    const third = tokenFrom((await adminApi().post(`/v1/platform/subscriptions/${c.id}/resend-invitation`, { confirmar: true })).json().activationUrl);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/invitations/accept', payload: { token: third, password: PASSWORD } })).statusCode).toBe(200);
    const reused = await app.inject({ method: 'POST', url: '/v1/auth/invitations/accept', payload: { token: third, password: 'OtraClave12345' } });
    expect(reused.json().code).toBe('invitation_invalid');
    expect((await adminApi().post(`/v1/platform/subscriptions/${c.id}/resend-invitation`, { confirmar: true })).json().code).toBe('invitation_used');
  });

  it('antes de aceptar la invitación la cuenta no puede entrar (contraseña inutilizable)', async () => {
    const c = await pendingRequest();
    await adminApi().post(`/v1/platform/subscriptions/${c.id}/authorize`, { confirmar: true });
    const detail = (await adminApi().get(`/v1/platform/subscriptions/${c.id}`)).json();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: detail.email, password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });

  it('rechazo con motivo: el solicitante lo ve y no se puede autorizar después', async () => {
    const c = await pendingRequest();
    expect((await adminApi().post(`/v1/platform/subscriptions/${c.id}/reject`, { confirmar: true })).statusCode).toBe(400);
    const rej = await adminApi().post(`/v1/platform/subscriptions/${c.id}/reject`, { confirmar: true, motivo: 'La transferencia no aparece en el banco' });
    expect(rej.json().estado).toBe('RECHAZADA');
    const status = await app.inject({ method: 'GET', url: `/v1/billing/checkout/${c.id}`, headers: { 'x-solicitud-token': c.token } });
    expect(status.json()).toMatchObject({ estado: 'RECHAZADA', motivo: 'La transferencia no aparece en el banco' });
    const late = await adminApi().post(`/v1/platform/subscriptions/${c.id}/authorize`, { confirmar: true });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('invalid_transition');
  });

  it('transiciones inválidas se rechazan: autorizar dos veces o sin pago reportado', async () => {
    const unpaid = await checkout();
    expect((await adminApi().post(`/v1/platform/subscriptions/${unpaid.id}/authorize`, { confirmar: true })).json().code).toBe('invalid_transition');
    const o = await activeOwner();
    expect((await adminApi().post(`/v1/platform/subscriptions/${o.subId}/authorize`, { confirmar: true })).json().code).toBe('invalid_transition');
  });
});

describe('control de acceso', () => {
  it('un cliente no entra a rutas de administración ni el empleado ve la suscripción', async () => {
    const o = await activeOwner();
    expect((await api(app, o).get('/v1/platform/subscriptions')).statusCode).toBe(403);
    expect((await api(app, o).post(`/v1/platform/subscriptions/${o.subId}/authorize`, { confirmar: true })).statusCode).toBe(403);
    const cashier = await addStaff(app, o.tenantId, 'cashier');
    expect((await api(app, cashier).get('/v1/billing/mi-suscripcion')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/platform/finance' })).statusCode).toBe(401);
  });

  it('un negocio no puede descargar recibos de otro (aislamiento entre tenants)', async () => {
    const a = await activeOwner();
    const b = await activeOwner();
    const bPago = (await api(app, b).get('/v1/billing/mi-suscripcion')).json().pagos[0].id;
    const res = await api(app, a).get(`/v1/billing/recibos/${bPago}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('vencimiento, gracia, suspensión de solo lectura y renovación', () => {
  it('vencida pasa a gracia (escribe); tras la gracia queda en solo lectura sin perder datos', async () => {
    const o = await activeOwner();
    const created = await api(app, o).post('/v1/products', { nombre: 'Jarabe', categoria: 'Farmacia', unidad: 'unidad', costo: '100.00', precioVenta: '150.00', stockInicial: '5', stockMin: '1' });
    expect(created.statusCode).toBe(201);

    await sql(`UPDATE billing.suscripcion SET periodo_fin = now() - interval '2 days' WHERE id = $1`, [o.subId]);
    __resetSessionStatusForTests();
    expect((await api(app, o).post('/v1/products', { nombre: 'Gotas', categoria: 'Farmacia', unidad: 'unidad', costo: '10.00', precioVenta: '15.00', stockInicial: '1', stockMin: '0' })).statusCode).toBe(201);

    await sql(`UPDATE billing.suscripcion SET periodo_fin = now() - interval '9 days' WHERE id = $1`, [o.subId]);
    __resetSessionStatusForTests();
    const blocked = await api(app, o).post('/v1/products', { nombre: 'Vendas', categoria: 'Farmacia', unidad: 'unidad', costo: '10.00', precioVenta: '15.00', stockInicial: '1', stockMin: '0' });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe('subscription_readonly');
    const list = await api(app, o).get('/v1/products');
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).toContain('Jarabe');

    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: o.email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.suscripcion).toMatchObject({ estado: 'SUSPENDIDA', soloLectura: true });
    expect((await api(app, o).get('/v1/billing/mi-suscripcion')).statusCode).toBe(200);

    const swept = await app.inject({ method: 'POST', url: '/v1/billing/cron/sweep', headers: { authorization: 'Bearer cron_test_only_secret_value' } });
    expect(swept.statusCode).toBe(200);
    expect(swept.json().suspendidas).toBeGreaterThanOrEqual(1);
    const detail = (await adminApi().get(`/v1/platform/subscriptions/${o.subId}`)).json();
    expect(detail.estado).toBe('SUSPENDIDA');
    expect(detail.eventos.map((e: { evento: string }) => e.evento)).toEqual(expect.arrayContaining(['vencimiento', 'fin_gracia']));

    const mp = multipartBody('file', 'renovacion.png', 'image/png', png);
    const report = await app.inject({
      method: 'POST',
      url: '/v1/billing/mi-suscripcion/comprobante',
      payload: mp.body,
      headers: { ...mp.headers, authorization: `Bearer ${o.token}` },
    });
    expect(report.statusCode).toBe(201);
    const queue = (await adminApi().get('/v1/platform/subscriptions?estado=por_revisar')).json().items as Array<{ id: string }>;
    expect(queue.some((s) => s.id === o.subId)).toBe(true);
    const pay = await adminApi().post(`/v1/platform/subscriptions/${o.subId}/payments`, {
      confirmar: true,
      montoCentavos: 149000,
      referencia: 'BPD-RENOV-1',
      comprobanteId: report.json().id,
    });
    expect(pay.statusCode, pay.body).toBe(200);
    expect(pay.json().estado).toBe('ACTIVA');
    expect(new Date(pay.json().periodoFin).getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
    const after = (await adminApi().get('/v1/platform/subscriptions?estado=por_revisar')).json().items as Array<{ id: string }>;
    expect(after.some((s) => s.id === o.subId)).toBe(false);
    expect((await api(app, o).post('/v1/products', { nombre: 'Vendas', categoria: 'Farmacia', unidad: 'unidad', costo: '10.00', precioVenta: '15.00', stockInicial: '1', stockMin: '0' })).statusCode).toBe(201);
  });

  it('el cron exige el secreto', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/billing/cron/sweep' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/billing/cron/sweep', headers: { authorization: 'Bearer otro' } })).statusCode).toBe(404);
  });

  it('el dueño programa la cancelación al final del periodo; al vencer queda cancelada (solo lectura)', async () => {
    const o = await activeOwner();
    const res = await api(app, o).post('/v1/billing/mi-suscripcion/cancelacion', { cancelar: true });
    expect(res.json().cancelarAlFinal).toBe(true);
    await sql(`UPDATE billing.suscripcion SET periodo_fin = now() - interval '1 hour' WHERE id = $1`, [o.subId]);
    __resetSessionStatusForTests();
    expect((await api(app, o).get('/v1/billing/mi-suscripcion')).json().suscripcion.estado).toBe('CANCELADA');
    expect((await api(app, o).post('/v1/products', { nombre: 'X', categoria: 'Y', unidad: 'unidad', costo: '1.00', precioVenta: '2.00', stockInicial: '1', stockMin: '0' })).statusCode).toBe(402);
  });

  it('suspensión manual, reactivación y cambio de plan desde el panel', async () => {
    const o = await activeOwner();
    const s = await adminApi().post(`/v1/platform/subscriptions/${o.subId}/suspend`, { confirmar: true, motivo: 'Contracargo en revisión' });
    expect(s.json().estado).toBe('SUSPENDIDA');
    expect((await api(app, o).post('/v1/products', { nombre: 'X', categoria: 'Y', unidad: 'unidad', costo: '1.00', precioVenta: '2.00', stockInicial: '1', stockMin: '0' })).statusCode).toBe(402);
    expect((await adminApi().post(`/v1/platform/subscriptions/${o.subId}/reactivate`, { confirmar: true, motivo: 'Resuelto' })).json().estado).toBe('ACTIVA');
    const plan = await adminApi().post(`/v1/platform/subscriptions/${o.subId}/plan`, { confirmar: true, planId: 'negocio' });
    expect(plan.json().planId).toBe('negocio');
    expect((await api(app, o).get('/v1/billing/mi-suscripcion')).json().suscripcion).toMatchObject({ planId: 'negocio', montoCentavos: 249000 });
  });
});

describe('límites del plan', () => {
  const product = (nombre: string, over: Record<string, unknown> = {}) => ({
    nombre,
    categoria: 'Farmacia',
    unidad: 'unidad',
    costo: '1.00',
    precioVenta: '2.00',
    stockInicial: '0',
    stockMin: '0',
    ...over,
  });

  it('el servidor impide pasar del máximo de productos; descontinuar libera cupo y reactivar lo vuelve a exigir', async () => {
    const o = await activeOwner();
    const adminConn = await (await getDriver()).admin();
    try {
      await adminConn.query(
        `INSERT INTO billing.plan (id, nombre, descripcion, precio_mensual_centavos, max_usuarios, max_productos, activo)
         VALUES ('prueba_limite', 'Prueba', 'Plan de prueba con cupo mínimo', 100, 1, 2, false) ON CONFLICT (id) DO NOTHING`,
      );
    } finally {
      await adminConn.release();
    }
    await sql(`UPDATE billing.suscripcion SET plan_id = 'prueba_limite' WHERE id = $1`, [o.subId]);
    const s = api(app, o);

    const first = await s.post('/v1/products', product('Uno'));
    expect(first.statusCode, first.body).toBe(201);
    expect((await s.post('/v1/products', product('Dos'))).statusCode).toBe(201);
    const over = await s.post('/v1/products', product('Tres'));
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe('plan_limit_products');

    const mp = multipartBody('file', 'productos.csv', 'text/csv', Buffer.from('nombre,precio_venta\nCuatro,5.00\n'));
    const imported = await app.inject({
      method: 'POST',
      url: '/v1/products/import',
      payload: mp.body,
      headers: { ...mp.headers, authorization: `Bearer ${o.token}` },
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({ creados: 0, errores: [expect.objectContaining({ mensaje: expect.stringContaining('permite hasta 2 productos') })] });

    expect((await s.post('/v1/products', product('Archivo', { estado: 'descontinuado' }))).statusCode).toBe(201);

    const id = first.json().id as string;
    expect((await s.patch(`/v1/products/${id}`, { estado: 'descontinuado' })).statusCode).toBe(200);
    expect((await s.post('/v1/products', product('Tres'))).statusCode).toBe(201);
    const back = await s.patch(`/v1/products/${id}`, { estado: 'activo' });
    expect(back.statusCode).toBe(409);
    expect(back.json().code).toBe('plan_limit_products');

    const plans = (await app.inject({ method: 'GET', url: '/v1/billing/plans' })).json();
    expect(JSON.stringify(plans)).not.toContain('prueba_limite');
  });
});

describe('ledger inmutable, reembolsos y finanzas', () => {
  it('reembolso parcial dentro del límite; nunca más de lo cobrado', async () => {
    const o = await activeOwner();
    const pagoId = (await api(app, o).get('/v1/billing/mi-suscripcion')).json().pagos[0].id;
    const tooMuch = await adminApi().post(`/v1/platform/subscriptions/${o.subId}/refunds`, { confirmar: true, pagoId, montoCentavos: 999999, motivo: 'Error' });
    expect(tooMuch.json().code).toBe('refund_exceeds');
    const ok = await adminApi().post(`/v1/platform/subscriptions/${o.subId}/refunds`, { confirmar: true, pagoId, montoCentavos: 49000, motivo: 'Cobro proporcional' });
    expect(ok.json().disponible).toBe(100000);
    const pagos = (await api(app, o).get('/v1/billing/mi-suscripcion')).json().pagos as Array<{ tipo: string }>;
    expect(pagos.map((p) => p.tipo).sort()).toEqual(['cobro', 'reembolso']);
  });

  it('pagos, comprobantes e historial no se pueden editar ni borrar', async () => {
    await activeOwner();
    // The app role has no UPDATE/DELETE grant at all…
    await expect(sql(`UPDATE billing.pago SET monto_centavos = 1`)).rejects.toThrow(/permission denied|append-only/);
    await expect(sql(`DELETE FROM billing.evento`)).rejects.toThrow(/permission denied|append-only/);
    // …and the trigger stops even the database owner.
    const adminConn = await (await getDriver()).admin();
    try {
      await expect(adminConn.query(`UPDATE billing.pago SET monto_centavos = 1`)).rejects.toThrow(/append-only/);
      await expect(adminConn.query(`DELETE FROM billing.evento`)).rejects.toThrow(/append-only/);
      await expect(adminConn.query(`DELETE FROM billing.comprobante`)).rejects.toThrow(/append-only/);
    } finally {
      await adminConn.release();
    }
  });

  it('MRR suma las suscripciones activas', async () => {
    await activeOwner();
    const f = (await adminApi().get('/v1/platform/finance')).json();
    expect(f.mrrCentavos).toBeGreaterThanOrEqual(149000);
    expect(f.activas).toBeGreaterThanOrEqual(1);
    expect(f.ledger.items.length).toBeGreaterThan(0);
  });

  it('negocios anteriores a los planes: el admin les asigna uno con fecha de vencimiento', async () => {
    const legacy = await register(app);
    const res = await adminApi().post('/v1/platform/subscriptions/assign', {
      confirmar: true,
      tenantId: legacy.tenantId,
      planId: 'inicial',
      periodoFin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      motivo: 'Cliente fundador',
    });
    expect(res.statusCode, res.body).toBe(200);
    const me = await api(app, legacy).get('/v1/me');
    expect(me.json().suscripcion).toMatchObject({ estado: 'ACTIVA', plan: 'Inicial' });
  });

  it('salud del sistema sin exponer secretos', async () => {
    const h = await adminApi().get('/v1/platform/health');
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ baseDeDatos: { ok: true }, pagos: { transferencia: true, webhook: true }, cron: { configurado: true } });
    expect(h.body).not.toContain(WEBHOOK_SECRET);
    expect(h.body).not.toContain('cron_test_only_secret_value');
  });
});

describe('webhook de pasarela: firma, idempotencia y orden', () => {
  const send = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return app.inject({
      method: 'POST',
      url: '/v1/billing/webhooks/pasarela',
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-facilito-signature': signature ?? signWebhook(raw, WEBHOOK_SECRET) },
    });
  };
  const event = (id: string, tipo: string, suscripcionId: string, montoCentavos: number, ocurridoAt = new Date().toISOString()) => ({
    id,
    tipo,
    ocurridoAt,
    datos: { suscripcionId, montoCentavos, moneda: 'DOP', referencia: `ref-${id}` },
  });

  it('firma inválida, alterada o vieja → 401 sin tocar nada', async () => {
    const c = await checkout();
    const body = event('evt_bad_1', 'pago.exitoso', c.id, 149000);
    expect((await send(body, 't=1,v1=' + 'a'.repeat(64))).statusCode).toBe(401);
    const raw = JSON.stringify(body);
    const oldSig = signWebhook(raw, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect((await send(body, oldSig)).statusCode).toBe(401);
    expect((await send(body, signWebhook(raw, 'otro-secreto'))).statusCode).toBe(401);
    const status = await app.inject({ method: 'GET', url: `/v1/billing/checkout/${c.id}`, headers: { 'x-solicitud-token': c.token } });
    expect(status.json().estado).toBe('PENDIENTE_PAGO');
  });

  it('pago exitoso lleva a PENDIENTE_AUTORIZACION; el duplicado no cobra dos veces', async () => {
    const c = await checkout();
    const ev = event(`evt_ok_${c.id}`, 'pago.exitoso', c.id, 149000);
    const first = await send(ev);
    expect(first.json()).toMatchObject({ duplicado: false, resultado: 'pendiente_autorizacion' });
    const again = await send(ev);
    expect(again.json()).toMatchObject({ duplicado: true });
    const rows = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM billing.pago WHERE suscripcion_id = $1`, [c.id]);
    expect(rows[0]!.n).toBe(1);
  });

  it('monto menor al plan no avanza el estado', async () => {
    const c = await checkout();
    const r = await send(event(`evt_low_${c.id}`, 'pago.exitoso', c.id, 100));
    expect(r.json().resultado).toBe('monto_insuficiente');
  });

  it('un fallo anterior al último cobro (fuera de orden) se ignora; uno nuevo manda a gracia', async () => {
    const o = await activeOwner();
    const stale = await send(event(`evt_stale_${o.subId}`, 'pago.fallido', o.subId, 149000, new Date(Date.now() - 86_400_000).toISOString()));
    expect(stale.json().resultado).toBe('ignorado_fuera_de_orden');
    const fresh = await send(event(`evt_fail_${o.subId}`, 'pago.fallido', o.subId, 149000, new Date(Date.now() + 1000).toISOString()));
    expect(fresh.json().resultado).toBe('en_gracia');
    const renew = await send(event(`evt_renew_${o.subId}`, 'pago.exitoso', o.subId, 149000, new Date(Date.now() + 2000).toISOString()));
    expect(renew.json().resultado).toBe('renovada');
  });

  it('proveedor desconocido → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/billing/webhooks/otro', payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(404);
  });
});
