import { expect, test } from '@playwright/test';
import { randomRnc, uniqueEmail } from './helpers';

test.describe('intro login + planes + tipo de negocio', () => {
  test('intro v2 se puede saltar y deja foco en el login', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.removeItem('facilito:intro-seen');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/login');
    const skip = page.getByRole('button', { name: 'Saltar' });
    await expect(skip).toBeVisible({ timeout: 3000 });
    await skip.click();
    await expect(page.getByRole('heading', { name: /^Iniciar sesión$/i })).toBeVisible();
    await expect(page.getByLabel('Correo electrónico')).toBeFocused();
    await expect(page.getByRole('link', { name: 'Sitio web' })).toBeVisible();
  });

  test('reduced-motion omite el intro animado largo', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try {
        sessionStorage.removeItem('facilito:intro-seen');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /^Iniciar sesión$/i })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.login-intro-bar')).toHaveCount(0);
    await ctx.close();
  });

  test('intro v2: sin barra blanca antes del logo (0–400ms)', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.removeItem('facilito:intro-seen');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/login');
    // Immediately after paint: track must not exist (logo phase starts at 400ms).
    await expect(page.locator('.login-intro-bar')).toHaveCount(0);
    await page.waitForTimeout(250);
    await expect(page.locator('.login-intro-bar')).toHaveCount(0);
    // After mount window, bar may appear with logo — never alone as a white strip pre-logo.
    await page.waitForTimeout(400);
    const bar = page.locator('.login-intro-bar');
    const logo = page.locator('.login-intro-logo');
    if ((await bar.count()) > 0) {
      await expect(logo).toBeVisible();
    }
    // After handoff (~5.2s) splash nodes are gone.
    await expect(page.getByRole('heading', { name: /^Iniciar sesión$/i })).toBeVisible({ timeout: 7000 });
    await expect(page.locator('.login-intro-bar')).toHaveCount(0);
    await expect(page.locator('.login-intro')).toHaveCount(0);
  });

  test('elegir plan actualiza el resumen y el picker de tipo tiene Otro', async ({ page }) => {
    await page.goto('/suscribirme');
    await expect(page.getByRole('heading', { name: 'Beneficios' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Comparativa' })).toBeVisible();
    await page.getByRole('button', { name: 'Elegir Profesional' }).click();
    await expect(page.locator('.plan-summary-bar')).toContainText('Profesional');
    await expect(page.locator('.plan-summary-bar')).toContainText(/1.?490|1490/);
    await page.getByLabel(/^Tu nombre/).fill('María Pérez');
    await page.getByLabel(/^Correo electrónico/).fill(uniqueEmail('tipo'));
    await page.getByLabel(/^Nombre del negocio/).fill('Colmado Demo');
    await page.getByLabel(/^RNC o cédula/).fill(randomRnc());
    const tipo = page.getByRole('combobox', { name: /Tipo de negocio/i });
    await tipo.click();
    await page.getByRole('option', { name: 'Otro (escribir el mío)' }).click();
    await expect(page.getByLabel(/Describe tu tipo/i)).toBeVisible();
    await page.getByLabel(/Describe tu tipo/i).fill('Venta de motores');
    await page.getByRole('checkbox', { name: /Acepto los términos/ }).check();
    await page.getByRole('button', { name: /Continuar al pago/ }).click();
    await expect(page.getByRole('heading', { name: /Paga RD\$.* por transferencia/ })).toBeVisible();
  });
});
