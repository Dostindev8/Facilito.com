import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { adminLoginBody, OWNER_PASSWORD, randomRnc, receiptPng, uniqueEmail } from '../scripts/lib/e2e-accounts.mjs';

export { randomRnc, uniqueEmail };
export const PASSWORD = OWNER_PASSWORD;
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

let admin: { ctx: APIRequestContext; token: string; at: number } | null = null;

/** The admin's API session lives in its own request context so its cookies never reach the page under test. */
async function loginAdmin(ctx: APIRequestContext): Promise<string> {
  const secret = process.env.E2E_ADMIN_TOTP_SECRET;
  if (!secret) throw new Error('E2E_ADMIN_TOTP_SECRET missing: global setup did not enrol the admin');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await ctx.post('/api/v1/auth/login', { data: await adminLoginBody(secret) });
    if (res.ok()) return (await res.json()).accessToken as string;
    if (res.status() !== 401) throw new Error(`admin login ${res.status()}: ${await res.text()}`);
  }
  throw new Error('admin login kept failing with a fresh TOTP code');
}

async function adminApi(): Promise<{ ctx: APIRequestContext; headers: Record<string, string> }> {
  if (!admin || Date.now() - admin.at > 10 * 60_000) {
    const ctx = admin?.ctx ?? (await request.newContext({ baseURL: BASE_URL }));
    admin = { ctx, token: await loginAdmin(ctx), at: Date.now() };
  }
  return { ctx: admin.ctx, headers: { authorization: `Bearer ${admin.token}` } };
}

/** Logs the browser in as the platform admin (second factor included), for UI checks of the admin panel. */
export async function adminBrowserSession(page: Page): Promise<void> {
  await loginAdmin(page.request);
}

export interface Subscription {
  id: string;
  token: string;
  email: string;
  nombre: string;
  negocio: string;
}

/** Public checkout plus the transfer receipt: leaves a request waiting for the admin, like a real customer would. */
export async function pendingSubscription(page: Page, tag = 'flow', planId = 'profesional'): Promise<Subscription> {
  const email = uniqueEmail(tag);
  const nombre = 'Ana Prueba';
  const negocio = `Colmado ${tag} ${Math.floor(Math.random() * 1e4)}`;
  const res = await page.request.post('/api/v1/billing/checkout', {
    data: { planId, nombre, email, razonSocial: negocio, rnc: randomRnc(), aceptaTerminos: true },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id, token } = (await res.json()) as { id: string; token: string };
  const up = await page.request.post(`/api/v1/billing/checkout/${id}/comprobante`, {
    headers: { 'x-solicitud-token': token },
    multipart: { file: { name: 'comprobante.png', mimeType: 'image/png', buffer: await receiptPng() } },
  });
  expect(up.status(), await up.text()).toBe(200);
  return { id, token, email, nombre, negocio };
}

/** Admin approval of a pending request; returns the single-use activation link. */
export async function authorizeSubscription(id: string): Promise<string> {
  const { ctx, headers } = await adminApi();
  const res = await ctx.post(`/api/v1/platform/subscriptions/${id}/authorize`, { headers, data: { confirmar: true } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).activationUrl as string;
}

/** Admin action on a subscription (suspend, reject, …) with the mandatory confirmation. */
export async function adminSubscriptionAction(id: string, action: string, data: Record<string, unknown> = {}) {
  const { ctx, headers } = await adminApi();
  const res = await ctx.post(`/api/v1/platform/subscriptions/${id}/${action}`, { headers, data: { confirmar: true, ...data } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

export const invitationToken = (activationUrl: string) => new URL(activationUrl).searchParams.get('token')!;

/**
 * A business owner with an active subscription, obtained the only way accounts exist now: checkout → receipt → admin
 * approval → invitation accepted. Accepting through the page's cookie jar leaves the browser with a real refresh cookie.
 */
export async function ownerSession(page: Page, tag = 'flow') {
  const sub = await pendingSubscription(page, tag);
  const url = await authorizeSubscription(sub.id);
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token: invitationToken(url), password: PASSWORD, recordarme: true } });
  expect(res.status(), await res.text()).toBe(200);
  return { ...sub, accessToken: (await res.json()).accessToken as string };
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
