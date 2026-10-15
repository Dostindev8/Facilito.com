import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp, PASSWORD, refreshCookieFrom, register, shutdown } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await shutdown(app);
});

const CSRF = { 'x-facilito-csrf': '1' };

describe('registro público retirado', () => {
  it('POST /v1/auth/register ya no existe (las cuentas nacen de una suscripción autorizada)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'Ana Pérez', email: 'ana@negocio.do', password: PASSWORD, razonSocial: 'Colmado Ana', rnc: '131000001', vertical: 'colmado' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('route_not_found');
  });

  it('el botón de Google sin configurar se retiró: la ruta no existe', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/auth/google' })).statusCode).toBe(404);
  });

  it('login devuelve sesión con cookie httpOnly, sin refresh token en el cuerpo', async () => {
    const s = await register(app, { nombre: 'Ana Pérez', razonSocial: 'Colmado Ana' });
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email.toUpperCase(), password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeUndefined();
    expect(body.user).toMatchObject({ nombre: 'Ana Pérez', email: s.email, rol: 'owner', negocio: 'Colmado Ana', mfa: false, suscripcion: null });
    const cookies = [res.headers['set-cookie']].flat().map(String);
    const rt = cookies.find((c) => c.startsWith('fc_rt='))!;
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Strict/i);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    const hint = cookies.find((c) => c.startsWith('fc_s='))!;
    expect(hint).toMatch(/^fc_s=1;/);
    expect(hint).not.toMatch(/HttpOnly/i);
    expect(hint).toMatch(/SameSite=Strict/i);
  });
});

describe('login y bloqueo por fuerza bruta', () => {
  it('login correcto', async () => {
    const s = await register(app);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email.toUpperCase(), password: PASSWORD, recordarme: true } });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=\d+/);
  });

  it('sin "recordarme" la cookie es de sesión (sin Max-Age)', async () => {
    const s = await register(app);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email, password: PASSWORD } });
    expect(String(res.headers['set-cookie'])).not.toMatch(/Max-Age/);
  });

  it('mismo mensaje para usuario inexistente y contraseña incorrecta', async () => {
    const s = await register(app);
    const wrong = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email, password: 'Incorrecta123' } });
    const ghost = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nadie@facilito.test', password: 'Incorrecta123' } });
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json().detail).toBe(ghost.json().detail);
  });

  it('bloquea la cuenta tras 5 intentos fallidos, incluso con la contraseña correcta', async () => {
    const s = await register(app);
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email, password: 'Incorrecta123' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email, password: PASSWORD } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('locked');
    expect(locked.json().retryAfterSeconds).toBe(900);
  });
});

describe('sesiones activas revocables', () => {
  it('lista los dispositivos y marca la sesión actual', async () => {
    const s = await register(app);
    const res = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: { authorization: `Bearer ${s.token}`, cookie: s.cookie } });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; actual: boolean }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.actual).toBe(true);
  });

  it('cerrar las demás sesiones invalida su access token al instante y su refresh', async () => {
    const s = await register(app);
    const other = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: s.email, password: PASSWORD } });
    const otherToken = other.json().accessToken as string;
    const otherCookie = refreshCookieFrom(other);
    expect((await api(app, { token: otherToken }).get('/v1/me')).statusCode).toBe(200);

    const out = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions/revoke-others',
      headers: { authorization: `Bearer ${s.token}`, cookie: s.cookie, ...CSRF },
    });
    expect(out.statusCode).toBe(200);
    expect(out.json().cerradas).toBe(1);

    expect((await api(app, { token: otherToken }).get('/v1/me')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: otherCookie, ...CSRF } })).statusCode).toBe(401);
    expect((await api(app, s).get('/v1/me')).statusCode).toBe(200);
  });

  it('revocar una sesión ajena o inexistente → 404', async () => {
    const a = await register(app);
    const b = await register(app);
    const list = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie } });
    const bFamily = (list.json().items as Array<{ id: string }>)[0]!.id;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/auth/sessions/${bFamily}/revoke`,
      headers: { authorization: `Bearer ${a.token}`, ...CSRF },
    });
    expect(res.statusCode).toBe(404);
    expect((await api(app, b).get('/v1/me')).statusCode).toBe(200);
  });
});

describe('refresh con rotación y detección de reuso', () => {
  it('requiere el encabezado anti-CSRF', async () => {
    const s = await register(app);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('csrf');
  });

  it('rota el token y revoca toda la familia al reusar uno viejo', async () => {
    const s = await register(app);
    const first = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: s.cookie, ...CSRF } });
    expect(first.statusCode).toBe(200);
    const rotated = refreshCookieFrom(first);
    expect(rotated).not.toBe(s.cookie);

    const reuse = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: s.cookie, ...CSRF } });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('refresh_reuse');

    const afterTheft = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: rotated, ...CSRF } });
    expect(afterTheft.statusCode).toBe(401);
  });

  it('sin cookie → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: CSRF });
    expect(res.statusCode).toBe(401);
  });

  it('logout revoca la sesión', async () => {
    const s = await register(app);
    const out = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie: s.cookie, ...CSRF } });
    expect(out.statusCode).toBe(204);
    expect([out.headers['set-cookie']].flat().map(String).some((c) => c.startsWith('fc_s=;'))).toBe(true);
    const again = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: s.cookie, ...CSRF } });
    expect(again.statusCode).toBe(401);
  });
});

describe('perfil, recuperación y protecciones', () => {
  it('GET /v1/me devuelve nombre, rol y negocio', async () => {
    const s = await register(app, { nombre: 'Luisa Gómez' });
    const res = await api(app, s).get('/v1/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ nombre: 'Luisa Gómez', rol: 'owner', tenantId: s.tenantId });
    expect(res.json().businesses).toHaveLength(1);
  });

  it('sin token o con token alterado → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    const s = await register(app);
    const tampered = s.token.slice(0, -4) + (s.token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await api(app, { token: tampered }).get('/v1/me')).statusCode).toBe(401);
  });

  it('forgot-password responde igual exista o no el email', async () => {
    const s = await register(app);
    const a = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email: s.email } });
    const b = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email: 'nadie@x.do' } });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(a.body).toBe(b.body);
  });

  it('reset con token inválido → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: { token: 'x'.repeat(43), password: PASSWORD } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('reset_invalid');
  });

  it('cabeceras de seguridad y CORS con allowlist', async () => {
    const ok = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(ok.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(String(ok.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const evil = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/email-change',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'DELETE' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(String(preflight.headers['access-control-allow-methods'])).toContain('DELETE');
  });

  it('readiness comprueba la base de datos sin exponer configuración', async () => {
    const r = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toMatchObject({ status: 'ok', db: 'ok', cache: expect.stringMatching(/^(redis|memoria)$/) });
    expect(Object.keys(r.json()).sort()).toEqual(['cache', 'db', 'latencyMs', 'status']);
  });

  it('errores con formato RFC 9457 y sin filtrar SQL', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).not.toMatch(/select|insert|postgres/i);
  });
});
