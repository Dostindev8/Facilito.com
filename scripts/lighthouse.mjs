#!/usr/bin/env node
// Runs Lighthouse (mobile + desktop) against public pages and prints category scores.
// Usage: CHROME_PATH=<chrome.exe> node scripts/lighthouse.mjs [baseUrl]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve('test-results', 'lighthouse');
mkdirSync(OUT, { recursive: true });
// Password recovery is noindex on purpose, so its SEO score is reported but not gated.
const pages = [
  { p: '/login', indexable: true },
  { p: '/suscribirme', indexable: true },
  { p: '/recuperar', indexable: false },
];
const npx = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

let worst = 100;
for (const preset of ['mobile', 'desktop']) {
  for (const { p, indexable } of pages) {
    const file = path.join(OUT, `${preset}-${p.replace(/[^a-z]/gi, '_')}.json`);
    const args = ['dlx', 'lighthouse@12', `${BASE}${p}`, '--quiet', '--output=json', `--output-path=${file}`, '--chrome-flags=--headless=new --no-sandbox', '--only-categories=performance,accessibility,best-practices,seo'];
    if (preset === 'desktop') args.push('--preset=desktop');
    const win = process.platform === 'win32';
    execFileSync(npx, win ? args.map((a) => `"${a}"`) : args, { stdio: 'inherit', shell: win });
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const scores = Object.entries(r.categories).map(([id, c]) => [c.title, Math.round(c.score * 100), id]);
    scores.forEach(([, s, id]) => {
      if (indexable || id !== 'seo') worst = Math.min(worst, s);
    });
    console.log(`${preset.padEnd(8)} ${p.padEnd(22)} ${scores.map(([t, s]) => `${t}: ${s}`).join(' | ')}`);
  }
}
console.log(`\nLowest score: ${worst}`);
process.exitCode = worst >= 90 ? 0 : 1;
