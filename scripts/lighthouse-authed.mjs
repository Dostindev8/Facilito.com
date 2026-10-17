#!/usr/bin/env node
// Lighthouse on authenticated pages: starts Chromium with a DevTools port, opens a throwaway business through the
// subscription flow in its default context (Playwright over CDP), then points Lighthouse at the same browser and
// cookie jar. Needs the same API env as scripts/e2e-api-smoke.mjs; local hosts only (it records a ledger payment).
// Usage: CHROME_PATH=<chrome> node scripts/lighthouse-authed.mjs [baseUrl]
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { adminToken, approvedInvitation, enrolAdminTotp, OWNER_PASSWORD } from './lib/e2e-accounts.mjs';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.SMOKE_ALLOW_REMOTE !== '1') {
  console.error('Refusing to create subscriptions on a non-local host. Set SMOKE_ALLOW_REMOTE=1 for a staging copy.');
  process.exit(2);
}
const PORT = 9333;
const CHROME = process.env.CHROME_PATH ?? chromium.executablePath();
const OUT = path.resolve('test-results', 'lighthouse');
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'fc-lh-'));

const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let worst = 100;
try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
    if (!browser) await sleep(250);
  }
  if (!browser) throw new Error('Chromium did not open the DevTools port');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const secret = process.env.E2E_ADMIN_TOTP_SECRET ?? (await enrolAdminTotp(BASE));
  const inv = await approvedInvitation(BASE, await adminToken(BASE, secret), 'lighthouse');
  const res = await page.request.post(`${BASE}/api/v1/auth/invitations/accept`, { data: { token: inv.invitation, password: OWNER_PASSWORD, recordarme: true } });
  if (res.status() !== 200) throw new Error(`invitation accept failed: ${res.status()} ${await res.text()}`);
  await page.goto(`${BASE}/inicio`);
  await page.waitForSelector('main#main');
  await browser.close();

  const win = process.platform === 'win32';
  for (const route of ['/inicio', '/inventario', '/facturacion/nueva', '/suscripcion']) {
    for (const preset of ['mobile', 'desktop']) {
      const file = path.join(OUT, `authed-${preset}-${route.replace(/[^a-z]/gi, '_')}.json`);
      const args = ['dlx', 'lighthouse@12', `${BASE}${route}`, `--port=${PORT}`, '--quiet', '--output=json', `--output-path=${file}`, '--only-categories=performance,accessibility,best-practices', '--disable-storage-reset', '--max-wait-for-load=30000'];
      if (preset === 'desktop') args.push('--preset=desktop');
      execFileSync(win ? 'pnpm.cmd' : 'pnpm', win ? args.map((a) => `"${a}"`) : args, { stdio: 'inherit', shell: win, timeout: 180_000 });
      const r = JSON.parse(readFileSync(file, 'utf8'));
      if (!r.finalDisplayedUrl?.includes(route)) throw new Error(`Lighthouse was redirected to ${r.finalDisplayedUrl}`);
      const scores = Object.values(r.categories).map((c) => [c.title, Math.round(c.score * 100)]);
      scores.forEach(([, s]) => (worst = Math.min(worst, s)));
      console.log(`${preset.padEnd(8)} ${route.padEnd(20)} ${scores.map(([t, s]) => `${t}: ${s}`).join(' | ')}`);
    }
  }
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
console.log(`\nLowest score: ${worst}`);
process.exitCode = worst >= 90 ? 0 : 1;
