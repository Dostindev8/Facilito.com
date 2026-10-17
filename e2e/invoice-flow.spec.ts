import { expect, test } from '@playwright/test';
import { addProductToInvoice, createProductViaUi, gotoAuthed, ownerSession, stockCell } from './helpers';

test.describe.configure({ mode: 'serial' });

test('crear producto → facturar → verificar stock → anular → verificar restauración', async ({ page }) => {
  await ownerSession(page, 'flujo');
  const nombre = `Arroz E2E ${Date.now() % 100000}`;

  await createProductViaUi(page, { nombre, costo: '180', precio: '250', stock: '10' });
  await expect(await stockCell(page, nombre)).toContainText('10');

  await gotoAuthed(page, '/facturacion/nueva');
  await addProductToInvoice(page, nombre, '3');
  const emit = page.getByRole('button', { name: /Emitir factura/ });
  await expect(emit).toContainText('885.00');
  await emit.click();
  await expect(page).toHaveURL(/\/facturacion\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'FAC-000001' })).toBeVisible();
  const invoiceUrl = page.url();

  await expect(await stockCell(page, nombre)).toContainText('7');

  await page.goto(invoiceUrl);
  await page.getByRole('button', { name: 'Anular', exact: true }).click();
  await page.getByRole('textbox', { name: 'Motivo de la anulación' }).fill('Cliente devolvió la mercancía');
  await page.getByRole('button', { name: 'Anular factura' }).click();
  await expect(page.locator('.void-stamp')).toBeVisible();

  await expect(await stockCell(page, nombre)).toContainText('10');

  await gotoAuthed(page, '/facturacion');
  await expect(page.locator('tr', { hasText: 'FAC-000001' })).toContainText('Anulada');
});

test('falla de red al emitir: el reintento no duplica la factura ni el descuento de stock', async ({ page }) => {
  await ownerSession(page, 'red');
  const nombre = `Aceite E2E ${Date.now() % 100000}`;
  await createProductViaUi(page, { nombre, costo: '150', precio: '200', stock: '5' });

  await gotoAuthed(page, '/facturacion/nueva');
  await addProductToInvoice(page, nombre, '2');

  let dropped = false;
  await page.route('**/api/v1/invoices', async (route) => {
    if (!dropped && route.request().method() === 'POST') {
      dropped = true;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: /Emitir factura/ }).click();
  await expect(page.locator('.form-alert[role="alert"]')).toContainText('al reintentar no se duplicará');
  await page.getByRole('button', { name: /Reintentar/ }).click();
  await expect(page).toHaveURL(/\/facturacion\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'FAC-000001' })).toBeVisible();

  await gotoAuthed(page, '/facturacion');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(await stockCell(page, nombre)).toContainText('3');
});

test('no deja vender más del stock disponible', async ({ page }) => {
  await ownerSession(page, 'stock');
  const nombre = `Leche E2E ${Date.now() % 100000}`;
  await createProductViaUi(page, { nombre, costo: '50', precio: '75', stock: '2' });
  await gotoAuthed(page, '/facturacion/nueva');
  await addProductToInvoice(page, nombre, '5');
  await expect(page.getByText('Solo hay 2 disponibles')).toBeVisible();
  await expect(page.getByRole('button', { name: /Emitir factura/ })).toBeDisabled();
});
