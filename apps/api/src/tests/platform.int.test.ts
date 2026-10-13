import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPlatformAdmin } from '../db/client.js';
import { provisionPlatformAdmin } from '../db/platform-admin.js';
import { api, bootApp, platformAdminSession, refreshCookieFrom, register, shutdown, type Session } from './helpers.js';

const ADMIN_EMAIL = 'Root.Admin@Facilito.test';
const ADMIN_PASSWORD = 'PlataformaSegura2026';
const ROTATED_PASSWORD = `${ADMIN_PASSWORD}-rotada`;
const CSRF = { 'x-facilito-csrf': '1' };

let app: FastifyInstance;
let admin: { token: string; personaId: string; totpSecret: string };
let owner: Session;

async function login(email: string, password: string, totp?: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password, ...(totp ? { totp } : {}) } });
}

beforeAll(async () => {
  app = await bootApp();
  admin = await platformAdminSession(app, ADMIN_EMAIL, ADMIN_PASSWORD);
  owner = await register(app, { nombre: 'María Colmado', razonSocial: 'Colmado María' });
});
afterAll(async () => {
  await shutdown(app);
});

describe('provisioning', () => {
  it('logs in with the second factor, with platform flag and an internal workspace', async () => {
    const res = await login(ADMIN_EMAIL.toLowerCase(), ADMIN_PASSWORD, authenticator.generate(admin.totpSecret));
    expect(res.json().user).toMatchObject({ platformAdmin: true, mfa: true, rol: 'owner', negocio: 'Facilito · Administración' });
    const s = await api(app, admin).get('/v1/settings');
    expect(s.statusCode).toBe(200);
    expect(JSON.stringify(s.json())).toContain('"rnc":null');
  });

  it('2FA is mandatory: an admin without it only gets a session that cannot open the panel', async () => {
    const email = 'sin.mfa@facilito.test';
    await provisionPlatformAdmin({ email, password: ADMIN_PASSWORD, nombre: 'Sin MFA' });
    const res = await login(email, ADMIN_PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ platformAdmin: true, mfa: false });
    const panel = await api(app, { token: res.json().accessToken }).get('/v1/platform/stats');
    expect(panel.statusCode).toBe(403);
    expect(panel.json().code).toBe('mfa_required');
  });

  it('enabling 2FA ends the old sessions so the next login carries the second factor', async () => {
    const email = 'enrola.mfa@facilito.test';
    await provisionPlatformAdmin({ email, password: ADMIN_PASSWORD, nombre: 'Enrola' });
    const first = await login(email, ADMIN_PASSWORD);
    const token = first.json().accessToken as string;
    const secret = (await api(app, { token }).post('/v1/auth/totp/setup')).json().secret as string;
    const verify = await api(app, { token }).post('/v1/auth/totp/verify', { code: authenticator.generate(secret) });
    expect(verify.json()).toMatchObject({ enabled: true, reloginRequired: true });
    expect((await api(app, { token }).get('/v1/me')).statusCode).toBe(401);
    expect((await login(email, ADMIN_PASSWORD)).json().code).toBe('totp_required');
    const again = await login(email, ADMIN_PASSWORD, authenticator.generate(secret));
    expect((await api(app, { token: again.json().accessToken }).get('/v1/platform/stats')).statusCode).toBe(200);
  });

  it('is idempotent: re-running keeps one account and rotates the password', async () => {
    const r = await provisionPlatformAdmin({ email: ADMIN_EMAIL, password: ROTATED_PASSWORD, nombre: 'Root' });
    expect(r.created).toBe(false);
    const code = () => authenticator.generate(admin.totpSecret);
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD, code())).statusCode).toBe(401);
    expect((await login(ADMIN_EMAIL, ROTATED_PASSWORD, code())).statusCode).toBe(200);
    await provisionPlatformAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, nombre: 'Root' });
    admin.token = (await login(ADMIN_EMAIL, ADMIN_PASSWORD, code())).json().accessToken;
  });

  it('regular sessions are not platform admins', async () => {
    const me = await api(app, owner).get('/v1/me');
    expect(me.json().platformAdmin).toBe(false);
  });
});

describe('access control', () => {
  it('rejects business owners and anonymous callers', async () => {
    expect((await api(app, owner).get('/v1/platform/stats')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/platform/users' })).statusCode).toBe(401);
  });

  it('database refuses cross-tenant reads to a non-admin even if the platform flag is set', async () => {
    const visible = await withPlatformAdmin(owner.personaId, async (q) => {
      const ok = await q.query<{ ok: boolean }>('SELECT app.is_platform_admin() AS ok');
      const personas = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM identity.persona');
      const negocios = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM app.negocio');
      return { ok: ok.rows[0]!.ok, personas: personas.rows[0]!.n, negocios: negocios.rows[0]!.n };
    });
    expect(visible).toEqual({ ok: false, personas: 1, negocios: 1 });
  });

  it('the app role cannot grant itself platform membership', async () => {
    await expect(
      withPlatformAdmin(owner.personaId, (q) => q.query('INSERT INTO identity.platform_admin (persona_id) VALUES ($1)', [owner.personaId])),
    ).rejects.toThrow();
  });
});

describe('panel data', () => {
  it('stats count people and businesses, excluding the admin workspace', async () => {
    const res = await api(app, admin).get('/v1/platform/stats');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const s = res.json();
    expect(s.usuarios).toBeGreaterThanOrEqual(1);
    expect(s.negocios).toBeGreaterThanOrEqual(1);
    const users = (await api(app, admin).get('/v1/platform/users')).json();
    const businesses = (await api(app, admin).get('/v1/platform/businesses')).json();
    expect(s.usuarios).toBe(users.total);
    expect(s.negocios).toBe(businesses.total);
  });

  it('lists users with their businesses and supports search', async () => {
    const res = await api(app, admin).get(`/v1/platform/users?q=${encodeURIComponent(owner.email)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: owner.personaId,
      email: owner.email,
      platformAdmin: false,
      bloqueadoAt: null,
      negocios: [{ tenantId: owner.tenantId, negocio: 'Colmado María', rol: 'owner', estado: 'activo' }],
    });
    const wildcard = await api(app, admin).get('/v1/platform/users?q=%25');
    expect(wildcard.json().total).toBe(0);
  });

  it('lists businesses with the owner and hides the admin workspace', async () => {
    const res = await api(app, admin).get('/v1/platform/businesses?pageSize=100');
    const items = res.json().items as Array<{ id: string; razonSocial: string; ownerEmail: string }>;
    expect(items.find((b) => b.id === owner.tenantId)).toMatchObject({ razonSocial: 'Colmado María', ownerEmail: owner.email });
    expect(items.some((b) => b.razonSocial === 'Facilito · Administración')).toBe(false);
  });
});

describe('block and unblock people', () => {
  it('requires a reason', async () => {
    const res = await api(app, admin).post(`/v1/platform/users/${owner.personaId}/block`, {});
    expect(res.statusCode).toBe(400);
  });

  it('blocking ends live sessions at once and stops login and refresh', async () => {
    const victim = await register(app, { nombre: 'Pedro Bloqueado' });
    const res = await api(app, admin).post(`/v1/platform/users/${victim.personaId}/block`, { motivo: 'Fraude reportado' });
    expect(res.statusCode).toBe(200);
    expect(res.json().bloqueadoAt).toBeTypeOf('string');

    const me = await api(app, victim).get('/v1/me');
    expect(me.statusCode).toBe(403);
    expect(me.json().code).toBe('account_blocked');

    const again = await login(victim.email, 'Segura12345');
    expect(again.statusCode).toBe(403);
    expect(again.json().code).toBe('account_blocked');

    const wrongPw = await login(victim.email, 'NoEsLaClave123');
    expect(wrongPw.statusCode).toBe(401);

    const refresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: victim.cookie, ...CSRF } });
    expect(refresh.statusCode).toBe(401);

    const listed = await api(app, admin).get('/v1/platform/users?estado=bloqueados');
    expect((listed.json().items as Array<{ id: string; bloqueadoMotivo: string }>).find((u) => u.id === victim.personaId)?.bloqueadoMotivo).toBe(
      'Fraude reportado',
    );

    const un = await api(app, admin).post(`/v1/platform/users/${victim.personaId}/unblock`);
    expect(un.statusCode).toBe(200);
    const back = await login(victim.email, 'Segura12345');
    expect(back.statusCode).toBe(200);
    expect(refreshCookieFrom(back)).not.toBe('');
  });

  it('protects the admin itself and other platform admins', async () => {
    const self = await api(app, admin).post(`/v1/platform/users/${admin.personaId}/block`, { motivo: 'prueba' });
    expect(self.statusCode).toBe(409);
    const other = await provisionPlatformAdmin({ email: 'otro.admin@facilito.test', password: ADMIN_PASSWORD, nombre: 'Otro' });
    const res = await api(app, admin).post(`/v1/platform/users/${other.personaId}/block`, { motivo: 'prueba' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('protected');
  });

  it('returns 404 for unknown people', async () => {
    const res = await api(app, admin).post('/v1/platform/users/00000000-0000-7000-8000-000000000000/block', { motivo: 'no existe' });
    expect(res.statusCode).toBe(404);
  });
});

describe('suspend and reactivate businesses', () => {
  it('suspension cuts the business sessions; reactivation restores access', async () => {
    const shop = await register(app, { nombre: 'Luis Suspendido', razonSocial: 'Ferretería Luis' });
    const res = await api(app, admin).post(`/v1/platform/businesses/${shop.tenantId}/suspend`, { motivo: 'Pago pendiente' });
    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('suspendido');

    expect((await api(app, shop).get('/v1/me')).statusCode).toBe(401);
    expect((await login(shop.email, 'Segura12345')).json().code).toBe('no_tenant');

    expect((await api(app, admin).post(`/v1/platform/businesses/${shop.tenantId}/reactivate`)).statusCode).toBe(200);
    expect((await login(shop.email, 'Segura12345')).statusCode).toBe(200);
  });

  it('the admin workspace cannot be suspended', async () => {
    const meRes = await api(app, admin).get('/v1/me');
    const res = await api(app, admin).post(`/v1/platform/businesses/${meRes.json().tenantId}/suspend`, { motivo: 'prueba' });
    expect(res.statusCode).toBe(409);
  });
});

describe('activity log', () => {
  it('records every action with actor and target', async () => {
    const res = await api(app, admin).get('/v1/platform/activity');
    const actions = (res.json().items as Array<{ action: string; actorEmail: string }>).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['persona.block', 'persona.unblock', 'negocio.suspend', 'negocio.reactivate']));
    expect(res.json().items[0].actorEmail).toBe(ADMIN_EMAIL.toLowerCase());
  });
});
