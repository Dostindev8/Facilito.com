import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import {
  PASSWORD,
  adminSubscriptionAction,
  authorizeSubscription,
  invitationToken,
  ownerSession,
  pendingSubscription,
  randomRnc,
  uniqueEmail,
} from './helpers';

test.describe('suscripción → aprobación → activación', () => {
  test('camino feliz desde la UI: plan, datos, comprobante, aprobación y contraseña', async ({ page }, info) => {
    await page.goto('/suscribirme');
    await page.getByRole('button', { name: 'Elegir Profesional' }).click();

    await page.getByRole('button', { name: /Continuar al pago/ }).click();
    await expect(page.getByLabel(/^Tu nombre/)).toBeFocused();

    const email = uniqueEmail('ui');
    await page.getByLabel(/^Tu nombre/).fill('María Pérez');
    await page.getByLabel(/^Correo electrónico/).fill(email);
    await page.getByLabel(/^Nombre del negocio/).fill('Colmado La Esquina');
    await page.getByLabel(/^RNC o cédula/).fill(randomRnc());
    await page.getByRole('checkbox', { name: /Acepto los términos/ }).check();
    await page.getByRole('button', { name: /Continuar al pago/ }).click();

    await expect(page.getByRole('heading', { name: /Paga RD\$.* por transferencia/ })).toBeVisible();
    const file = info.outputPath('comprobante.png');
    mkdirSync(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 60, height: 60, channels: 3, background: '#eeeeee' } }).png().toFile(file);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole('button', { name: /Enviar comprobante/ }).click();
    await expect(page.getByRole('heading', { name: 'Estamos verificando tu pago' })).toBeVisible();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('facilito:solicitud') ?? 'null'));
    expect(saved?.id).toBeTruthy();
    const url = await authorizeSubscription(saved.id);

    await page.reload();
    await expect(page.getByRole('heading', { name: '¡Tu pago fue aprobado!' })).toBeVisible();

    await page.goto(new URL(url).pathname + new URL(url).search);
    await expect(page).toHaveURL(/\/activar$/);
    await expect(page.getByText('Colmado La Esquina')).toBeVisible();
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar contraseña').fill(`${PASSWORD}x`);
    await page.getByRole('button', { name: /Crear contraseña y entrar/ }).click();
    await expect(page.getByLabel('Confirmar contraseña')).toBeFocused();
    await expect(page.getByText('Las contraseñas no coinciden')).toBeVisible();

    await page.getByLabel('Confirmar contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: /Crear contraseña y entrar/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByRole('heading', { name: /¡Hola, María!/ })).toBeVisible();
  });

  test('el enlace de activación es de un solo uso', async ({ page, browser }) => {
    const sub = await pendingSubscription(page, 'unuso');
    const url = await authorizeSubscription(sub.id);
    const first = await page.request.post('/api/v1/auth/invitations/accept', { data: { token: invitationToken(url), password: PASSWORD } });
    expect(first.status()).toBe(200);

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(new URL(url).pathname + new URL(url).search);
    // Next.js also mounts #__next-route-announcer__ with role=alert; target the form alert only.
    await expect(p.locator('.form-alert[role="alert"]')).toBeVisible();
    await expect(p.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
    await expect(p.getByRole('link', { name: 'inicia sesión' })).toBeVisible();
    await ctx.close();
  });

  test('una solicitud rechazada lo explica en la página de estado', async ({ page }) => {
    const sub = await pendingSubscription(page, 'rechazo');
    await adminSubscriptionAction(sub.id, 'reject', { motivo: 'El comprobante no corresponde al monto del plan.' });
    await page.goto(`/suscribirme?ver=estado#s=${sub.id}.${sub.token}`);
    await expect(page.getByRole('heading', { name: 'No pudimos aprobar la solicitud' })).toBeVisible();
    await expect(page.getByText('El comprobante no corresponde al monto del plan.')).toBeVisible();
  });

  test('suscripción suspendida: aviso de solo lectura y la API rechaza escrituras', async ({ page }) => {
    const sub = await ownerSession(page, 'suspendida');
    await adminSubscriptionAction(sub.id, 'suspend', { motivo: 'Pago no recibido en el período de gracia.' });
    await page.goto('/inicio');
    await expect(page.getByRole('status').filter({ hasText: 'solo lectura' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Renovar' })).toHaveAttribute('href', '/suscripcion');
    const write = await page.request.post('/api/v1/products', {
      headers: { authorization: `Bearer ${sub.accessToken}` },
      data: { nombre: 'Producto bloqueado', costo: '10', precioVenta: '20' },
    });
    expect(write.status()).toBe(402);
    expect((await write.json()).code).toBe('subscription_readonly');
  });
});

test.describe('registro público retirado', () => {
  for (const legacy of ['/register', '/registro', '/signup', '/onboarding']) {
    test(`${legacy} redirige con 301 a /suscribirme`, async ({ page }) => {
      const res = await page.request.get(legacy, { maxRedirects: 0 });
      expect(res.status()).toBe(301);
      expect(res.headers().location).toMatch(/\/suscribirme$/);
    });
  }

  test('la API ya no crea cuentas sin suscripción', async ({ page }) => {
    const res = await page.request.post('/api/v1/auth/register', {
      data: { nombre: 'Intruso', email: uniqueEmail('reg'), password: PASSWORD, razonSocial: 'X', rnc: randomRnc(), vertical: 'colmado' },
    });
    expect(res.status()).toBe(404);
  });

  test('el login ya no tiene pestaña de registro y el enlace viejo lleva a suscribirse', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Elige un plan y suscríbete/ })).toHaveAttribute('href', /\/suscribirme/);
    await page.goto('/login?tab=registro');
    await expect(page).toHaveURL(/\/suscribirme/);
  });
});

test.describe('autenticación', () => {
  test('login con credenciales válidas e inválidas; la sesión sobrevive a recargar', async ({ page, browser }) => {
    const { email } = await ownerSession(page, 'login');

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/login');
    await p.getByLabel('Correo electrónico').fill(email);
    await p.getByLabel('Contraseña', { exact: true }).fill('incorrecta-123');
    await p.getByRole('button', { name: /^Iniciar sesión/ }).click();
    await expect(p.getByRole('alert')).toBeVisible();
    await expect(p).toHaveURL(/\/login/);

    await p.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: /^Iniciar sesión/ }).click();
    await expect(p).toHaveURL(/\/inicio$/);
    await expect(p.getByRole('heading', { name: /¡Hola, Ana!/ })).toBeVisible();

    await p.reload();
    await expect(p.getByRole('heading', { name: /¡Hola, Ana!/ })).toBeVisible();

    const cookies = await ctx.cookies();
    const rt = cookies.find((c) => c.name === 'fc_rt');
    expect(rt?.httpOnly).toBe(true);
    expect(rt?.sameSite).toBe('Strict');
    expect(await p.evaluate(() => document.cookie)).not.toContain('fc_rt');
    await ctx.close();
  });

  test('ruta protegida sin sesión redirige al login conservando el destino', async ({ page }) => {
    await page.goto('/inventario');
    await expect(page).toHaveURL(/\/login\?next=%2Finventario/);
  });

  test('si el servidor no responde al validar la sesión, ofrece reintentar en vez de cerrarla', async ({ page }) => {
    await ownerSession(page, 'caido');
    await page.route('**/api/v1/auth/refresh', (r) =>
      r.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Servicio no disponible', detail: 'Intenta de nuevo.' }) }),
    );
    await page.goto('/inicio');
    const retry = page.getByRole('button', { name: 'Reintentar' });
    await expect(retry).toBeVisible();
    await expect(page).toHaveURL(/\/inicio$/);
    await page.unroute('**/api/v1/auth/refresh');
    await retry.click();
    await expect(page.locator('#main')).toBeVisible();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('el parámetro next no permite redirección abierta', async ({ page, baseURL }) => {
    const { email } = await ownerSession(page, 'next');
    await page.context().clearCookies();
    await page.goto('/login?next=https://evil.example.com');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /^Iniciar sesión/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test('un cliente no entra al panel de administración ni a su API', async ({ page }) => {
    const { accessToken } = await ownerSession(page, 'rol');
    await page.goto('/admin');
    await expect(page.getByText('Acceso restringido')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Solicitudes/ })).toHaveCount(0);
    const res = await page.request.get('/api/v1/platform/subscriptions', { headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.status()).toBe(403);
  });

  test('fondo de login: Ken Burns sólo con transform y detenido con reduced motion', async ({ browser }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const ctx = await browser.newContext({ reducedMotion });
      const p = await ctx.newPage();
      await p.goto('/login');
      const bg = p.locator('.auth-bg-image');
      await expect(bg).toHaveAttribute('alt', '');
      const s = await bg.evaluate((img: HTMLImageElement) => {
        const cs = getComputedStyle(img);
        return { anim: cs.animationName, transform: cs.transform, willChange: cs.willChange, fit: cs.objectFit, src: img.currentSrc };
      });
      expect(s.fit).toBe('cover');
      expect(s.src).toMatch(/login-bg\.webp$/);
      if (reducedMotion === 'reduce') {
        expect(s).toMatchObject({ anim: 'none', transform: 'none', willChange: 'auto' });
      } else {
        expect(s.anim).toBe('auth-ken-burns');
        expect(s.willChange).toBe('transform');
      }
      await expect(p.locator('.auth-bg')).toHaveAttribute('aria-hidden', 'true');
      await ctx.close();
    }
  });
});
