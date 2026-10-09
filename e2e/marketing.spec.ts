import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const publicRoutes = ['/', '/features', '/precios', '/contacto', '/nosotros', '/legal/privacidad', '/legal/terminos', '/legal/cookies'];
const widths = [375, 768, 1280, 1536];

test('la home tiene un solo h1 y el CTA abre el registro', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tu negocio, más fácil cada día');
  await page.getByRole('link', { name: 'Empezar gratis' }).first().click();
  await expect(page).toHaveURL(/\/login\?tab=registro/);
  await expect(page.getByRole('tab', { name: 'Registrarse' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Tu nombre')).toBeVisible();
  await expect(page.getByLabel('Nombre del negocio')).toBeVisible();
});

test('login muestra correo, contraseña y Google sin cambiar el flujo', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Iniciar sesión/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continuar con Google/ })).toBeVisible();
  await page.getByRole('button', { name: /^Iniciar sesión/ }).click();
  await expect(page.getByText('Ingresa tu email')).toBeVisible();
});

for (const width of widths) {
  test(`sin scroll horizontal a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/features', '/precios', '/contacto']) {
      await page.goto(route);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(fits, route).toBe(true);
    }
  });
}

test('menú móvil, aviso de cookies y formulario se usan con teclado', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const burger = page.getByRole('button', { name: 'Abrir menú' });
  await burger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Configurar' }).click();
  await page.getByRole('button', { name: 'Rechazar' }).click();
  await expect(page.getByRole('dialog', { name: /Cookies/ })).toHaveCount(0);

  await page.goto('/contacto');
  await page.getByLabel('Nombre').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('WhatsApp o celular')).toBeFocused();
});

test('contacto: validación, honeypot y límite', async ({ page }) => {
  await page.goto('/contacto?motivo=demo');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByRole('status')).toContainText(/nombre|Revisa/i);
  await expect(page.getByRole('status')).not.toContainText('Listo');

  await page.getByLabel('Nombre').fill('Ana Núñez');
  await page.getByLabel('WhatsApp o celular').fill('8095550101');
  await page.getByLabel('Correo').fill('ana@ejemplo.test');
  await page.getByLabel('Mensaje').fill('Quiero una demo para mi colmado esta semana.');
  await page.locator('input[name="company_website"]').fill('https://spam.test');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByRole('status')).toContainText('No pudimos enviar');

  await page.locator('input[name="company_website"]').fill('');
  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('status')).toContainText('Listo');
  }
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByRole('status')).toContainText('Demasiados envíos');
});

test('reduced motion no monta el video', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('video')).toHaveCount(0);
  await context.close();
});

test('saveData no pide el video', async ({ page }) => {
  const videoRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/media/') && request.url().includes('loop')) videoRequests.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true, effectiveType: '4g' },
    });
  });
  await page.goto('/');
  await expect(page.locator('video')).toHaveCount(0);
  expect(videoRequests).toEqual([]);
});

for (const route of publicRoutes) {
  test(`axe sin violaciones serias en ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
