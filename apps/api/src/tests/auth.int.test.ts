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

describe('registro', () => {
  it('crea dueño + negocio y devuelve sesión con cookie httpOnly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'Ana Pérez', email: 'Ana@Negocio.do', password: PASSWORD, razonSocial: 'Colmado Ana', rnc: '131-00000-1', vertical: 'colmado' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeUndefined();
    expect(body.user).toMatchObject({ nombre: 'Ana Pérez', email: 'ana@negocio.do', rol: 'owner', negocio: 'Colmado Ana' });
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

  it('rechaza email duplicado (sin distinguir mayúsculas)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'Otra', email: 'ana@negocio.do', password: PASSWORD, razonSocial: 'Otro', rnc: '131000009', vertical: 'colmado' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('email_taken');
  });

  it('valida campos: contraseña débil, RNC inválido, campos extra', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'X Y', email: 'x@y.do', password: 'corta', razonSocial: 'Neg', rnc: '123', vertical: 'colmado' },
    });
    expect(weak.statusCode).toBe(400);
    const fields = (weak.json().errors as Array<{ field: string }>).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['password', 'rnc']));

    const extra = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'X Y', email: 'x2@y.do', password: PASSWORD, razonSocial: 'Neg', rnc: '131000017', rol: 'owner', tenantId: 'x' },
    });
    expect(extra.statusCode).toBe(400);
  });

  it('rechaza RNC ya registrado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { nombre: 'Dup', email: 'dup@x.do', password: PASSWORD, razonSocial: 'Dup', rnc: '131000001', vertical: 'colmado' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('rnc_taken');
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

  it('Google OAuth reporta bloqueo de configuración (501)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/google' });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe('oauth_not_configured');
  });

  it('cabeceras de seguridad y CORS con allowlist', async () => {
    const ok = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(ok.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(String(ok.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const evil = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('errores con formato RFC 9457 y sin filtrar SQL', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).not.toMatch(/select|insert|postgres/i);
  });
});
