import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withTenant } from '../db/client.js';
import { addStaff, api, bootApp, createProduct, PASSWORD, register, shutdown, type Session } from './helpers.js';

const sent = vi.hoisted(() => ({
  emailChange: [] as Array<{ to: string; token: string }>,
  reset: [] as Array<{ to: string; token: string }>,
  notice: [] as Array<{ to: string; newEmail: string }>,
  fail: false,
}));
vi.mock('../services/mailer.js', () => {
  class MailDeliveryError extends Error {}
  const guard = () => {
    if (sent.fail) throw new MailDeliveryError('smtp down');
  };
  return {
    MailDeliveryError,
    sendPasswordResetEmail: async (to: string, token: string) => {
      guard();
      sent.reset.push({ to, token });
    },
    sendEmailChangeEmail: async (to: string, token: string) => {
      guard();
      sent.emailChange.push({ to, token });
    },
    sendEmailChangeNoticeEmail: async (to: string, newEmail: string) => {
      guard();
      sent.notice.push({ to, newEmail });
    },
    emailProviderConfigured: () => false,
  };
});

let app: FastifyInstance;
let rncSeq = 400_000_000;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await shutdown(app);
});

const login = (email: string, password = PASSWORD) => app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });

describe('registro: tipo de negocio libre + Instagram', () => {
  it('guarda un tipo escrito a mano como "custom" con el perfil por defecto', async () => {
    const s = await register(app, { vertical: undefined, tipoNegocio: '  Café &  Repostería ', instagram: 'https://www.instagram.com/Cafe.Rep/?igsh=x' });
    const b = (await api(app, s).get('/v1/settings')).json();
    expect(b.tipoNegocio).toBe('Café & Repostería');
    expect(b.verticales).toEqual(['colmado']);
    expect(b.instagram).toEqual({ handle: 'cafe.rep', url: 'https://www.instagram.com/cafe.rep/', connected: false, lastSyncedAt: null });
    expect(b).not.toHaveProperty('tipoNegocioSource');
  });

  it('un tipo del catálogo conserva su perfil (farmacia → lotes/FEFO)', async () => {
    const s = await register(app, { vertical: undefined, tipoNegocio: 'farmacia' });
    const b = (await api(app, s).get('/v1/settings')).json();
    expect(b.tipoNegocio).toBe('Farmacia');
    expect(b.verticales).toEqual(['farmacia']);
    expect(b.instagram).toBeNull();
  });

  it('clientes anteriores que solo envían `vertical` siguen funcionando', async () => {
    const s = await register(app, { vertical: 'ferreteria' });
    expect((await api(app, s).get('/v1/settings')).json()).toMatchObject({ tipoNegocio: 'Ferretería', verticales: ['ferreteria'] });
  });

  it('rechaza HTML en el tipo y un Instagram inválido con errores por campo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'Eva', email: `eva.${randomUUID()}@facilito.test`, password: PASSWORD, razonSocial: 'Neg', rnc: String(rncSeq++), tipoNegocio: '<script>x</script>', instagram: 'no válido' },
    });
    expect(res.statusCode).toBe(400);
    const fields = res.json().errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['tipoNegocio', 'instagram']));
  });
});

describe('Configuración → Negocio (flujo cargar → editar → guardar → persistir)', () => {
  it('actualiza nombre, tipo, Instagram y RNC; la bitácora no guarda el RNC en claro', async () => {
    const s = await register(app);
    const before = (await api(app, s).get('/v1/settings')).json();
    expect(before.tipoNegocio).toBe('Colmado');

    const newRnc = String(rncSeq++);
    const res = await api(app, s).patch('/v1/settings', {
      razonSocial: 'Colmado La Esquina SRL',
      nombreComercial: 'Colmado La Esquina',
      tipoNegocio: 'Venta de repuestos y gomas',
      instagram: '@la.esquina',
      rnc: newRnc,
    });
    expect(res.statusCode).toBe(200);

    const after = (await api(app, s).get('/v1/settings')).json();
    expect(after).toMatchObject({
      razonSocial: 'Colmado La Esquina SRL',
      nombreComercial: 'Colmado La Esquina',
      tipoNegocio: 'Venta de repuestos y gomas',
      instagram: { handle: 'la.esquina', url: 'https://www.instagram.com/la.esquina/', connected: false },
    });
    expect(after.rnc.replace(/-/g, '')).toBe(newRnc);

    const audit = await withTenant(s.tenantId, async (q) =>
      (await q.query(`SELECT before_json::text AS b, after_json::text AS a FROM audit.bitacora WHERE tenant_id = $1 AND entity = 'negocio'`, [s.tenantId])).rows,
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).not.toContain(newRnc);
    expect(JSON.stringify(audit)).toContain('rncChanged');

    expect((await api(app, s).patch('/v1/settings', { instagram: '' })).json().instagram).toBeNull();
  });

  it('pide confirmación antes de cambiar el RNC si ya hay comprobantes emitidos', async () => {
    const s = await register(app);
    const p = await createProduct(app, s, { stockInicial: '5' });
    await api(app, s).put('/v1/settings/ncf', { tipo: 'B02', desde: 1, hasta: 10 });
    const f = await api(app, s).post('/v1/invoices', { clientUuid: randomUUID(), metodoPago: 'efectivo', ncfTipo: 'B02', lineas: [{ productoId: p.id, cantidad: '1' }] });
    expect(f.json().ncf).toBe('B0200000001');

    const newRnc = String(rncSeq++);
    const blocked = await api(app, s).patch('/v1/settings', { rnc: newRnc });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('rnc_confirm_required');
    expect((await api(app, s).get('/v1/settings')).json().rnc.replace(/-/g, '')).not.toBe(newRnc);

    const ok = await api(app, s).patch('/v1/settings', { rnc: newRnc, confirmRncChange: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().rnc.replace(/-/g, '')).toBe(newRnc);
  });

  it('no permite tomar el RNC de otro negocio', async () => {
    const taken = String(rncSeq++);
    await register(app, { rnc: taken });
    const s = await register(app);
    const res = await api(app, s).patch('/v1/settings', { rnc: taken });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('rnc_taken');
  });

  it('solo el dueño cambia el RNC; roles sin permiso reciben 403', async () => {
    const s = await register(app);
    const manager = await addStaff(app, s.tenantId, 'manager');
    expect((await api(app, manager).patch('/v1/settings', { tipoNegocio: 'Minimarket' })).statusCode).toBe(200);
    expect((await api(app, manager).patch('/v1/settings', { rnc: String(rncSeq++) })).statusCode).toBe(403);
    const cashier = await addStaff(app, s.tenantId, 'cashier');
    expect((await api(app, cashier).patch('/v1/settings', { tipoNegocio: 'Otro rubro' })).statusCode).toBe(403);
  });

  it('solo edita el negocio del token: un tenantId en el cuerpo se rechaza', async () => {
    const a = await register(app);
    const b = await register(app);
    const res = await api(app, a).patch('/v1/settings', { tenantId: b.tenantId, nombreComercial: 'Hackeado' });
    expect(res.statusCode).toBe(400);
    expect((await api(app, b).get('/v1/settings')).json().nombreComercial).not.toBe('Hackeado');
  });
});

describe('Mi cuenta: nombre, correo verificado y contraseña', () => {
  it('actualiza el nombre personal', async () => {
    const s = await register(app);
    const res = await api(app, s).patch('/v1/me', { nombre: 'María Pérez' });
    expect(res.statusCode).toBe(200);
    expect((await api(app, s).get('/v1/me')).json().nombre).toBe('María Pérez');
  });

  it('el correo solo cambia al confirmar el enlace; exige la contraseña actual', async () => {
    const s = await register(app);
    const newEmail = `nuevo.${randomUUID()}@facilito.test`;

    const wrong = await api(app, s).post('/v1/auth/email-change', { newEmail, password: 'Incorrecta123' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().errors[0].field).toBe('password');

    const req = await api(app, s).post('/v1/auth/email-change', { newEmail: newEmail.toUpperCase(), password: PASSWORD });
    expect(req.statusCode).toBe(202);
    const me = (await api(app, s).get('/v1/me')).json();
    expect(me).toMatchObject({ email: s.email, pendingEmail: newEmail });
    expect((await login(s.email)).statusCode).toBe(200);

    const mail = sent.emailChange.at(-1)!;
    expect(mail.to).toBe(newEmail);
    const bad = await app.inject({ method: 'POST', url: '/v1/auth/email-change/confirm', payload: { token: 'x'.repeat(40) } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/email-change/confirm', payload: { token: mail.token } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().email).toBe(newEmail);

    expect((await login(s.email)).statusCode).toBe(401);
    expect((await login(newEmail)).statusCode).toBe(200);
    const reuse = await app.inject({ method: 'POST', url: '/v1/auth/email-change/confirm', payload: { token: mail.token } });
    expect(reuse.statusCode).toBe(400);
  });

  it('no permite pedir un correo que ya usa otra cuenta', async () => {
    const other = await register(app);
    const s = await register(app);
    const res = await api(app, s).post('/v1/auth/email-change', { newEmail: other.email, password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('email_taken');
  });

  it('cambia la contraseña solo con la actual y cierra las otras sesiones', async () => {
    const s: Session = await register(app);
    const otherDevice = await login(s.email);
    const otherCookie = String([otherDevice.headers['set-cookie']].flat().find((c) => String(c).startsWith('fc_rt='))).split(';')[0]!;

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/password',
      headers: { authorization: `Bearer ${s.token}` },
      payload: { currentPassword: 'Incorrecta123', newPassword: 'NuevaClave2026' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().errors[0].field).toBe('currentPassword');

    const same = await app.inject({
      method: 'POST',
      url: '/v1/auth/password',
      headers: { authorization: `Bearer ${s.token}` },
      payload: { currentPassword: PASSWORD, newPassword: PASSWORD },
    });
    expect(same.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/password',
      headers: { authorization: `Bearer ${s.token}`, cookie: s.cookie },
      payload: { currentPassword: PASSWORD, newPassword: 'NuevaClave2026' },
    });
    expect(ok.statusCode).toBe(204);

    const refresh = (cookie: string) =>
      app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie, 'x-facilito-csrf': '1' } });
    expect((await refresh(s.cookie)).statusCode).toBe(200);
    expect((await refresh(otherCookie)).statusCode).toBe(401);
    expect((await login(s.email)).statusCode).toBe(401);
    expect((await login(s.email, 'NuevaClave2026')).statusCode).toBe(200);
  });

  it('los enlaces de restablecer pedidos antes de cambiar correo o contraseña dejan de servir', async () => {
    const requestReset = async (email: string) => {
      await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email } });
      return sent.reset.filter((m) => m.to === email).at(-1)!.token;
    };
    const resetWith = (token: string) =>
      app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: { token, password: 'Secuestro2026x' } }); // gitleaks:allow test-only fixture password

    const a = await register(app);
    const staleByEmail = await requestReset(a.email);
    await api(app, a).post('/v1/auth/email-change', { newEmail: `otro.${randomUUID()}@facilito.test`, password: PASSWORD });
    await app.inject({ method: 'POST', url: '/v1/auth/email-change/confirm', payload: { token: sent.emailChange.at(-1)!.token } });
    expect((await resetWith(staleByEmail)).statusCode).toBe(400);

    const b = await register(app);
    const staleByPassword = await requestReset(b.email);
    const changed = await app.inject({
      method: 'POST',
      url: '/v1/auth/password',
      headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
      payload: { currentPassword: PASSWORD, newPassword: 'NuevaClave2026' },
    });
    expect(changed.statusCode).toBe(204);
    expect((await resetWith(staleByPassword)).statusCode).toBe(400);
    expect((await login(b.email, 'NuevaClave2026')).statusCode).toBe(200);
  });
});

describe('Correos: aviso de seguridad y fallas del proveedor', () => {
  it('pedir un cambio de correo avisa a la dirección actual', async () => {
    const s = await register(app);
    const newEmail = `aviso.${randomUUID()}@facilito.test`;
    expect((await api(app, s).post('/v1/auth/email-change', { newEmail, password: PASSWORD })).statusCode).toBe(202);
    expect(sent.notice.at(-1)).toEqual({ to: s.email, newEmail });
  });

  it('si el correo no sale, el cambio de correo responde 502 y el reset no revela nada', async () => {
    const s = await register(app);
    sent.fail = true;
    try {
      const change = await api(app, s).post('/v1/auth/email-change', { newEmail: `falla.${randomUUID()}@facilito.test`, password: PASSWORD });
      expect(change.statusCode).toBe(502);
      expect(change.json().code).toBe('email_delivery_failed');

      const existing = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email: s.email } });
      const missing = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email: `nadie.${randomUUID()}@facilito.test` } });
      expect(existing.statusCode).toBe(missing.statusCode);
      expect(existing.body).toBe(missing.body);
    } finally {
      sent.fail = false;
    }
  });
});
