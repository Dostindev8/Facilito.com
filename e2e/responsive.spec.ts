import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createProductViaUi, registerSession } from './helpers';

const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;
const PAGES = ['/inicio', '/inventario', '/facturacion', '/facturacion/nueva', '/ventas', '/clientes', '/reportes', '/configuracion', '/configuracion?tab=cuenta', '/configuracion?tab=seguridad', '/notificaciones'] as const;
const SHOTS = process.env.E2E_SCREENSHOTS === '1';
const shot = (name: string) => path.join(__dirname, '..', 'test-results', 'shots', `${name}.png`);

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
        let p: HTMLElement | null = el.parentElement;
        while (p && p !== document.body) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false;
          p = p.parentElement;
        }
        return r.right > vw + 1 || r.left < -1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
    const widest = offenders.length ? Math.max(vw, ...[...document.querySelectorAll<HTMLElement>('body *')].map((el) => el.getBoundingClientRect().right)) : vw;
    return { scroll: offenders.length ? Math.ceil(widest) : Math.min(document.documentElement.scrollWidth, vw), vw, offenders };
  });
}

test('login sin desbordamiento horizontal en todos los breakpoints', async ({ page }) => {
  await page.goto('/login');
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const o = await overflow(page);
    expect(o.scroll, `login @${w}px: ${o.offenders.join(', ')}`).toBeLessThanOrEqual(o.vw);
    if (SHOTS) await page.screenshot({ path: shot(`login-${w}`), fullPage: true });
  }
});

test('panel sin desbordamiento horizontal en todos los breakpoints', async ({ page }) => {
  test.setTimeout(240_000);
  await registerSession(page, 'resp');
  await createProductViaUi(page, { nombre: 'Refresco Rojo 2 litros edición especial', costo: '60', precio: '95', stock: '2' });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  for (const route of PAGES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await expect(page.locator('main#main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Algo salió mal'), `${route} cayó al error boundary: ${pageErrors.join(' | ')}`).toHaveCount(0);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      const o = await overflow(page);
      expect(o.scroll, `${route} @${w}px: ${o.offenders.join(', ')}`).toBeLessThanOrEqual(o.vw);
      if (SHOTS) await page.screenshot({ path: shot(`${route.replace(/[/?=]/g, '_').slice(1)}-${w}`), fullPage: true });
    }
  }
});

test('en móvil el menú lateral es un drawer accesible', async ({ page }) => {
  await registerSession(page, 'drawer');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/inicio');
  const nav = page.locator('#app-sidebar');
  const menu = page.getByRole('button', { name: 'Abrir menú' });
  await expect(nav).toBeHidden();
  await menu.click();
  await expect(nav).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await nav.getByRole('link', { name: /Inventario/ }).click();
  await expect(page).toHaveURL(/\/inventario/);
  await expect(nav).toBeHidden();
});
