import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const publicRoutes = ['/login', '/suscribirme', '/legal/privacidad', '/legal/terminos', '/legal/cookies'];
const widths = [375, 768, 1280, 1536];

test('la raíz redirige al login (app, no landing)', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /Bienvenido de nuevo/i })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Tu negocio, más fácil cada día/i })).toHaveCount(0);
});

test('rutas de marketing antiguas redirigen al sitio web dedicado', async ({ request }) => {
  for (const route of ['/features', '/precios', '/nosotros', '/contacto', '/modulos']) {
    const res = await request.get(route, { maxRedirects: 0 });
    expect(res.status(), route).toBeGreaterThanOrEqual(300);
    expect(res.status(), route).toBeLessThan(400);
    expect(res.headers().location ?? '', route).toMatch(/facilitord-web\.vercel\.app/);
  }
});

test('login muestra correo y contraseña, sin registro ni Google', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Iniciar sesión/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continuar con Google/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Crear cuenta/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Iniciar sesión/ }).click();
  await expect(page.getByText('Ingresa tu email')).toBeVisible();
});

test('suscribirme sigue en la app con los tres planes', async ({ page }) => {
  await page.goto('/suscribirme');
  await expect(page.getByRole('heading', { name: /Suscríbete/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Elegir / })).toHaveCount(3);
});

for (const width of widths) {
  test(`sin scroll horizontal a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/login', '/suscribirme', '/legal/privacidad']) {
      await page.goto(route);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(fits, route).toBe(true);
    }
  });
}

for (const route of publicRoutes) {
  test(`axe sin violaciones serias en ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
