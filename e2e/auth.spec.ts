import { expect, test } from '@playwright/test';
import { PASSWORD, randomRnc, uniqueEmail } from './helpers';

test.describe('autenticación', () => {
  test('registro desde la UI entra al panel con el saludo del dueño', async ({ page }) => {
    await page.goto('/login?tab=registro');
    await page.getByLabel('Tu nombre').fill('María Pérez');
    await page.getByLabel('Correo electrónico').fill(uniqueEmail('ui'));
    await page.getByLabel('Nombre del negocio').fill('Colmado La Esquina');
    await page.getByLabel('RNC o cédula').fill(randomRnc());
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: /Crear cuenta/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByRole('heading', { name: /¡Hola, María!/ })).toBeVisible();
    await expect(page.getByText('Ventas del día')).toBeVisible();
  });

  test('login con credenciales válidas e inválidas; la sesión sobrevive a recargar', async ({ page, browser }) => {
    const email = uniqueEmail('login');
    const reg = await page.request.post('/api/v1/auth/register', {
      data: { nombre: 'Luis Gómez', email, password: PASSWORD, razonSocial: 'Ferretería Gómez', rnc: randomRnc(), vertical: 'colmado' },
    });
    expect(reg.status()).toBe(201);

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
    await expect(p.getByRole('heading', { name: /¡Hola, Luis!/ })).toBeVisible();

    await p.reload();
    await expect(p.getByRole('heading', { name: /¡Hola, Luis!/ })).toBeVisible();

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

  test('el parámetro next no permite redirección abierta', async ({ page, baseURL }) => {
    const email = uniqueEmail('next');
    await page.request.post('/api/v1/auth/register', {
      data: { nombre: 'Rosa Díaz', email, password: PASSWORD, razonSocial: 'Colmado Rosa', rnc: randomRnc(), vertical: 'colmado' },
    });
    await page.context().clearCookies();
    await page.goto('/login?next=https://evil.example.com');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /^Iniciar sesión/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test('pestañas accesibles por teclado y validación del registro enfoca el primer error', async ({ page }) => {
    await page.goto('/login');
    const loginTab = page.getByRole('tab', { name: 'Iniciar sesión' });
    await loginTab.focus();
    await page.keyboard.press('ArrowRight');
    const regTab = page.getByRole('tab', { name: 'Registrarse' });
    await expect(regTab).toHaveAttribute('aria-selected', 'true');
    await expect(regTab).toBeFocused();
    await expect(page).toHaveURL(/tab=registro/);
    await expect(page.getByRole('tabpanel', { name: 'Registrarse' })).toBeVisible();

    await page.getByRole('button', { name: /Crear cuenta/ }).click();
    await expect(page.getByLabel('Tu nombre')).toBeFocused();
    await expect(page.getByText('Escribe tu nombre')).toBeVisible();

    await page.getByLabel('Tu nombre').fill('Ana Núñez');
    await page.getByLabel('Correo electrónico').fill(uniqueEmail('val'));
    await page.getByLabel('Nombre del negocio').fill('Colmado Ana');
    await page.getByLabel('RNC o cédula').fill(randomRnc());
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar contraseña').fill(`${PASSWORD}x`);
    await page.getByRole('button', { name: /Crear cuenta/ }).click();
    await expect(page.getByLabel('Confirmar contraseña')).toBeFocused();
    await expect(page.getByText('Las contraseñas no coinciden')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await regTab.focus();
    await page.keyboard.press('Home');
    await expect(loginTab).toHaveAttribute('aria-selected', 'true');
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
