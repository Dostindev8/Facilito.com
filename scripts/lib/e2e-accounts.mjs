// Test accounts for smoke, Lighthouse and Playwright now that public sign-up is gone: a business owner only exists
// after checkout → transfer receipt → platform admin approval → invitation accepted. Talks to the web origin
// (Next rewrite → API). Never point the subscription flow at production: it records a real payment in the ledger.
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret) {
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('invalid base32 secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const totpStep = (at = Date.now()) => Math.floor(at / 30_000);

/** RFC 6238 (SHA-1, 6 digits, 30 s): what authenticator apps and the API's otplib compute. */
export function totp(secret, step = totpStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin.e2e@facilito.test';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'AdminE2E!Seguro2026';
export const OWNER_PASSWORD = 'Facilito!Seguro2026';

async function post(base, path, { body, token, headers = {} } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { res, status: res.status, json, text };
}

// Local only (.data is git-ignored): lets standalone scripts run again without restarting the API.
const SECRET_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.data/e2e-admin-totp');

/**
 * Base32 TOTP secret of the E2E admin. The local API provisions that admin without 2FA on every boot
 * (E2E_PLATFORM_ADMIN_*), so a login without a code either enrols a fresh authenticator or, when an earlier run already
 * did, reuses the secret saved by that run.
 */
export async function enrolAdminTotp(base) {
  const login = await post(base, '/v1/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (login.status === 401 && login.json?.code === 'totp_required' && existsSync(SECRET_FILE)) {
    return readFileSync(SECRET_FILE, 'utf8').trim();
  }
  if (login.status !== 200) {
    throw new Error(
      `E2E admin login failed (${login.status} ${login.json?.code ?? ''}). Start the API with E2E_PLATFORM_ADMIN_EMAIL/` +
        'E2E_PLATFORM_ADMIN_PASSWORD (Playwright does it), or set E2E_ADMIN_TOTP_SECRET for an admin that already has 2FA.',
    );
  }
  const token = login.json.accessToken;
  const setup = await post(base, '/v1/auth/totp/setup', { token });
  if (setup.status !== 200) throw new Error(`TOTP setup failed: ${setup.status}`);
  const verify = await post(base, '/v1/auth/totp/verify', { token, body: { code: totp(setup.json.secret) } });
  if (verify.status !== 200) throw new Error(`TOTP verify failed: ${verify.status}`);
  mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  writeFileSync(SECRET_FILE, setup.json.secret, { mode: 0o600 });
  return setup.json.secret;
}

let lastAdminStep = -1;

/** A TOTP code opens one session only (the API refuses replays), so each login waits for a step not used yet. */
export async function nextAdminCode(secret) {
  if (totpStep() <= lastAdminStep) await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 200));
  lastAdminStep = totpStep();
  return totp(secret, lastAdminStep);
}

export const adminLoginBody = async (secret) => ({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, totp: await nextAdminCode(secret), recordarme: true });

/** Admin login with the second factor; retries on a fresh step if another process spent the current code. */
export async function adminToken(base, secret) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await post(base, '/v1/auth/login', { body: await adminLoginBody(secret) });
    if (r.status === 200) return r.json.accessToken;
    if (r.status !== 401) throw new Error(`admin login ${r.status}: ${r.text}`);
  }
  throw new Error('admin login kept failing with a fresh TOTP code');
}

let png = null;
export async function receiptPng() {
  png ??= await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return png;
}

export const uniqueEmail = (tag) => `e2e.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@facilito.test`;
export const randomRnc = () => String(100000000 + Math.floor(Math.random() * 899999999));

/** Checkout + receipt + admin approval. Returns the single-use invitation token; the caller decides who accepts it. */
export async function approvedInvitation(base, adminAccessToken, tag = 'smoke') {
  const email = uniqueEmail(tag);
  const negocio = `Colmado ${tag} ${Math.floor(Math.random() * 1e4)}`;
  const c = await post(base, '/v1/billing/checkout', {
    body: { planId: 'profesional', nombre: 'Prueba E2E', email, razonSocial: negocio, rnc: randomRnc(), aceptaTerminos: true },
  });
  if (c.status !== 201) throw new Error(`checkout ${c.status}: ${c.text}`);
  const form = new FormData();
  form.append('file', new Blob([await receiptPng()], { type: 'image/png' }), 'comprobante.png');
  const up = await post(base, `/v1/billing/checkout/${c.json.id}/comprobante`, { body: form, headers: { 'x-solicitud-token': c.json.token } });
  if (up.status !== 200) throw new Error(`receipt ${up.status}: ${up.text}`);
  const auth = await post(base, `/v1/platform/subscriptions/${c.json.id}/authorize`, { token: adminAccessToken, body: { confirmar: true } });
  if (auth.status !== 200) throw new Error(`authorize ${auth.status}: ${auth.text}`);
  return { subscriptionId: c.json.id, email, negocio, invitation: new URL(auth.json.activationUrl).searchParams.get('token') };
}

/** Accepts an invitation over plain fetch; returns the raw response pieces the smoke test inspects. */
export async function acceptInvitation(base, invitation, password = OWNER_PASSWORD) {
  return post(base, '/v1/auth/invitations/accept', { body: { token: invitation, password, recordarme: true } });
}
