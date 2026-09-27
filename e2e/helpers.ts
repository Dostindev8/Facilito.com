import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Facilito!Seguro2026';

export function uniqueEmail(tag: string): string {
  return `e2e.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@facilito.test`;
}

export function randomRnc(): string {
  return String(100000000 + Math.floor(Math.random() * 899999999));
}

/** Registers through the API using the page's cookie jar, so the browser ends up with a real refresh cookie. */
export async function registerSession(page: Page, tag = 'flow') {
  const email = uniqueEmail(tag);
  const res = await page.request.post('/api/v1/auth/register', {
    data: {
      nombre: 'Ana Prueba',
      email,
      password: PASSWORD,
      razonSocial: `Colmado ${tag}`,
      rnc: randomRnc(),
      vertical: 'colmado',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { email };
}

export async function gotoAuthed(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main#main')).toBeVisible();
}

export async function createProductViaUi(page: Page, p: { nombre: string; costo: string; precio: string; stock: string }) {
  await gotoAuthed(page, '/inventario');
  await page.getByRole('button', { name: 'Nuevo producto' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' });
  const box = (name: string) => dialog.getByLabel(new RegExp(`^${name.replace(/[()$]/g, '\\$&')}( \\*)?$`));
  await box('Nombre').fill(p.nombre);
  await box('Categoría').fill('Granos');
  await box('Costo (RD$)').fill(p.costo);
  await box('Precio de venta (RD$)').fill(p.precio);
  await box('Stock inicial').fill(p.stock);
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

export async function stockCell(page: Page, nombre: string) {
  await gotoAuthed(page, `/inventario`);
  await page.getByPlaceholder('Buscar por nombre, SKU, categoría o código de barras').fill(nombre);
  const row = page.locator('tr', { hasText: nombre }).first();
  await expect(row).toBeVisible();
  return row.locator('td[data-label="Stock"]');
}

export async function addProductToInvoice(page: Page, nombre: string, cantidad: string) {
  const picker = page.getByPlaceholder('Buscar producto por nombre, SKU o escanear código');
  await picker.fill(nombre);
  const option = page.getByRole('option', { name: new RegExp(nombre) });
  await option.click();
  await page.getByLabel(`Cantidad de ${nombre}`).fill(cantidad);
}
