#!/usr/bin/env node
// End-to-end smoke test through the web origin (Next rewrite → API).
// Usage: node scripts/e2e-api-smoke.mjs [baseUrl]   (default http://localhost:3000)
// Owners are created through the real subscription flow, so the API must run with BILLING_BANK_* and either
// E2E_PLATFORM_ADMIN_EMAIL/PASSWORD (fresh admin, enrolled here) or E2E_ADMIN_* with E2E_ADMIN_TOTP_SECRET.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { acceptInvitation, adminToken, approvedInvitation, enrolAdminTotp, OWNER_PASSWORD } from './lib/e2e-accounts.mjs';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.SMOKE_ALLOW_REMOTE !== '1') {
  console.error('Refusing to create subscriptions on a non-local host: they record payments in the ledger. Set SMOKE_ALLOW_REMOTE=1 for a staging copy.');
  process.exit(2);
}
const CSRF = { 'x-facilito-csrf': '1' };
let passed = 0;

function step(name, ok) {
  assert.ok(ok, name);
  passed++;
  console.log(`  ✔ ${name}`);
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  const c = raw.find((s) => s.startsWith('fc_rt='));
  return c ? { value: c.split(';')[0], attrs: c.toLowerCase() } : null;
}

async function call(method, path, { token, body, cookie, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { res, status: res.status, json };
}

const adminSecret = process.env.E2E_ADMIN_TOTP_SECRET ?? (await enrolAdminTotp(BASE));
const adminAccess = await adminToken(BASE, adminSecret);

/** Checkout → receipt → admin approval → invitation accepted: the only way an owner account exists. */
async function register(suffix) {
  const inv = await approvedInvitation(BASE, adminAccess, `smoke-${suffix}`);
  return { r: await acceptInvitation(BASE, inv.invitation), email: inv.email };
}

console.log(`Facilito E2E smoke → ${BASE}`);

// 0. Public sign-up is gone
const legacy = await call('POST', '/v1/auth/register', { body: { email: 'x@facilito.test', password: 'Facilito!Seguro2026' } });
step(`public register endpoint removed (${legacy.status})`, legacy.status === 404);

// 1. Owner from an approved subscription + cookie hardening
const { r: reg, email: emailA } = await register('a');
step(`invitation accepted (got ${reg.status})`, reg.status === 200);
let token = reg.json.accessToken;
const tenantId = reg.json.user?.tenantId ?? reg.json.tenantId;
step('access token returned', typeof token === 'string' && token.split('.').length === 3);
const ck = cookieFrom(reg.res);
step('refresh cookie is HttpOnly + SameSite=Strict + scoped path', !!ck && ck.attrs.includes('httponly') && ck.attrs.includes('samesite=strict') && ck.attrs.includes('path=/api/v1/auth'));

// 2. Refresh requires CSRF header, rotates, and detects reuse
const noCsrf = await call('POST', '/v1/auth/refresh', { cookie: ck.value });
step(`refresh without CSRF header rejected (${noCsrf.status})`, noCsrf.status === 403 || noCsrf.status === 401);
const ref1 = await call('POST', '/v1/auth/refresh', { cookie: ck.value, headers: CSRF });
step(`refresh with CSRF ok (${ref1.status})`, ref1.status === 200);
const ck2 = cookieFrom(ref1.res);
step('refresh rotated the cookie', !!ck2 && ck2.value !== ck.value);
const reuse = await call('POST', '/v1/auth/refresh', { cookie: ck.value, headers: CSRF });
step(`reused refresh token rejected (${reuse.status})`, reuse.status === 401);
const afterReuse = await call('POST', '/v1/auth/refresh', { cookie: ck2.value, headers: CSRF });
step(`token family revoked after reuse (${afterReuse.status})`, afterReuse.status === 401);
const killed = await call('GET', '/v1/me', { token });
step(`access token of the revoked family stops working (${killed.status})`, killed.status === 401);
const relogin = await call('POST', '/v1/auth/login', { body: { email: emailA, password: OWNER_PASSWORD } });
step(`owner logs in with the password set on activation (${relogin.status})`, relogin.status === 200 && relogin.json?.user?.suscripcion?.estado === 'ACTIVA');
token = relogin.json.accessToken;

// 3. Unauthenticated + validation
const anon = await call('GET', '/v1/products');
step(`products without token → 401 (${anon.status})`, anon.status === 401);
const bad = await call('POST', '/v1/products', { token, body: { nombre: '<script>x</script>', costo: '-1', precioVenta: 'abc' } });
step(`invalid product → 400 with field errors (${bad.status})`, bad.status === 400 && Array.isArray(bad.json?.errors));

// 4. Price below cost needs explicit confirmation
const below = await call('POST', '/v1/products', { token, body: { nombre: 'Bajo costo', costo: '100', precioVenta: '50' } });
step(`price below cost → 409 (${below.status})`, below.status === 409 && below.json?.code === 'price_below_cost');

// 5. Create product with initial stock
const prod = await call('POST', '/v1/products', {
  token,
  body: { nombre: 'Arroz Selecto 5lb', categoria: 'Granos', costo: '180', precioVenta: '250', stockInicial: '10', stockMin: '3' },
});
step(`create product 201 (${prod.status})`, prod.status === 201);
const productId = prod.json.id;
step(`auto SKU + margin 28% (sku=${prod.json.sku}, margen=${prod.json.margen})`, !!prod.json.sku && Math.abs(Number(prod.json.margen) - 28) < 0.01);
step('initial stock = 10', Number(prod.json.stockActual ?? prod.json.stock_actual) === 10);

// 6. Adjustment requires a reason; negative stock blocked
const noReason = await call('POST', `/v1/products/${productId}/adjust`, { token, body: { tipo: 'salida', cantidad: '1' } });
step(`adjust without reason → 400 (${noReason.status})`, noReason.status === 400);
const neg = await call('POST', `/v1/products/${productId}/adjust`, { token, body: { tipo: 'salida', cantidad: '999', motivo: 'merma' } });
step(`adjust below zero → 409 (${neg.status})`, neg.status === 409);

// 7. Invoice deducts stock; server recomputes totals
const clientUuid = randomUUID();
const invBody = {
  clientUuid,
  metodoPago: 'efectivo',
  lineas: [{ productoId: productId, cantidad: '3' }],
};
const inv = await call('POST', '/v1/invoices', { token, body: invBody });
step(`create invoice 201 (${inv.status} ${inv.status !== 201 ? JSON.stringify(inv.json) : ''})`, inv.status === 201);
const invoiceId = inv.json.id;
step(`total = 3 × 250 + 18% ITBIS = 885.00 (got ${inv.json.total})`, Number(inv.json.total) === 885);
const afterSale = await call('GET', `/v1/products/${productId}`, { token });
step(`stock after sale = 7 (got ${afterSale.json.stockActual})`, Number(afterSale.json.stockActual) === 7);

// 8. Network-failure retry with same clientUuid does not duplicate
const retry = await call('POST', '/v1/invoices', { token, body: invBody });
step(`idempotent retry returns same invoice (${retry.status})`, (retry.status === 200 || retry.status === 201) && retry.json.id === invoiceId);
const afterRetry = await call('GET', `/v1/products/${productId}`, { token });
step('stock unchanged after retry = 7', Number(afterRetry.json.stockActual) === 7);

// 9. Selling above stock is blocked
const over = await call('POST', '/v1/invoices', {
  token,
  body: { clientUuid: randomUUID(), metodoPago: 'efectivo', lineas: [{ productoId: productId, cantidad: '50' }] },
});
step(`sale above stock → 409 (${over.status})`, over.status === 409);

// 10. Void restores stock, invoice is kept
const voidShort = await call('POST', `/v1/invoices/${invoiceId}/void`, { token, body: { motivo: 'no' } });
step(`void with short reason → 400 (${voidShort.status})`, voidShort.status === 400);
const v = await call('POST', `/v1/invoices/${invoiceId}/void`, { token, body: { motivo: 'Error del cajero en cantidad' } });
step(`void ok (${v.status})`, v.status === 200);
const afterVoid = await call('GET', `/v1/products/${productId}`, { token });
step(`stock restored = 10 (got ${afterVoid.json.stockActual})`, Number(afterVoid.json.stockActual) === 10);
const kept = await call('GET', `/v1/invoices/${invoiceId}`, { token });
step(`voided invoice still exists with estado=anulada (${kept.json?.estado})`, kept.status === 200 && kept.json.estado === 'anulada');
const voidAgain = await call('POST', `/v1/invoices/${invoiceId}/void`, { token, body: { motivo: 'Segundo intento' } });
step(`double void → 409 (${voidAgain.status})`, voidAgain.status === 409);

// 11. Kardex records every movement
const kardex = await call('GET', `/v1/products/${productId}/kardex`, { token });
const movs = kardex.json?.items ?? kardex.json;
step(`kardex has initial + sale + void movements (${movs?.length})`, Array.isArray(movs) && movs.length >= 3);

// 12. PDF
const pdf = await fetch(`${BASE}/api/v1/invoices/${invoiceId}/pdf`, { headers: { authorization: `Bearer ${token}` } });
const pdfBytes = Buffer.from(await pdf.arrayBuffer());
step(`invoice PDF served (${pdf.status}, ${pdf.headers.get('content-type')})`, pdf.status === 200 && pdfBytes.subarray(0, 4).toString() === '%PDF');

// 13. Tenant isolation: a second business cannot see the first one's data
const { r: regB } = await register('b');
const tokenB = regB.json.accessToken;
const crossProd = await call('GET', `/v1/products/${productId}`, { token: tokenB });
step(`tenant B cannot read tenant A product (${crossProd.status})`, crossProd.status === 404);
const crossInv = await call('GET', `/v1/invoices/${invoiceId}`, { token: tokenB });
step(`tenant B cannot read tenant A invoice (${crossInv.status})`, crossInv.status === 404);
const listB = await call('GET', '/v1/products', { token: tokenB });
step('tenant B product list is empty', (listB.json?.items ?? []).length === 0);

// 14. A client-supplied X-Forwarded-For must not open a fresh rate-limit bucket
const rl = async (headers = {}) => Number((await fetch(`${BASE}/api/v1/verticals`, { headers })).headers.get('x-ratelimit-remaining'));
const before = await rl();
const spoofed = await rl({ 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250)}` });
step(`spoofed X-Forwarded-For shares the caller's bucket (${before} → ${spoofed})`, spoofed < before);

// 15. Dashboard reflects real data
const dash = await call('GET', '/v1/dashboard?dias=7', { token });
step(`dashboard 200 (${dash.status})`, dash.status === 200 && dash.json && typeof dash.json === 'object');

console.log(`\n${passed} checks passed (tenant ${tenantId ?? 'n/a'})`);
