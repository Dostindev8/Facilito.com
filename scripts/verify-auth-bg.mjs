// Verifies the Login/Register animated background against a running web build.
// Usage: node scripts/verify-auth-bg.mjs  (E2E_BASE_URL defaults to http://localhost:3000; SHOTS=1 saves screenshots)
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const WIDTHS = [320, 375, 414, 768, 1024, 1440, 1920];
const HEIGHT = { 320: 640, 375: 812, 414: 896, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 };
const PAGES = ['/login', '/login?tab=registro'];
const SHOTS = process.env.SHOTS === '1';
const SHOT_DIR = path.resolve('test-results', 'auth-bg');
const MIN_TEXT_CONTRAST = 4.5;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}`);
  if (!ok) failures++;
};

const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Worst WCAG contrast of each brand-panel text node against the real pixels behind it (text hidden). */
async function textContrast(page) {
  const boxes = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.brand-panel h1, .brand-panel h1 em, .brand-sub, .value-item strong, .value-item span:not(.value-icon), .script-line, .brand-foot span')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('.value-item') && getComputedStyle(el.closest('.value-item')).backgroundColor !== 'rgba(0, 0, 0, 0)') continue;
      const m = cs.color.match(/\d+(\.\d+)?/g).map(Number);
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        out.push({ sel: `${el.tagName.toLowerCase()}.${el.className || ''}`.slice(0, 40), text: el.textContent.trim().slice(0, 28), x: r.x, y: r.y, w: r.width, h: r.height, color: m.slice(0, 3), large: parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700) });
      }
    }
    document.documentElement.classList.add('__hide-text');
    const st = document.createElement('style');
    st.id = '__hide-text';
    st.textContent = '.__hide-text .brand-panel *{color:transparent!important;text-shadow:none!important} .__hide-text .brand-panel svg{visibility:hidden}';
    document.head.append(st);
    return out;
  });
  const vp = page.viewportSize();
  const png = await page.screenshot();
  await page.evaluate(() => {
    document.documentElement.classList.remove('__hide-text');
    document.getElementById('__hide-text')?.remove();
  });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const results = [];
  for (const b of boxes) {
    let worst = Infinity;
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(vp.width - 1, Math.ceil(b.x + b.w)), y1 = Math.min(vp.height - 1, Math.ceil(b.y + b.h));
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const i = (y * info.width + x) * 3;
        worst = Math.min(worst, contrast(b.color, [data[i], data[i + 1], data[i + 2]]));
      }
    }
    if (worst !== Infinity) results.push({ ...b, worst });
  }
  return results;
}

const browser = await chromium.launch();
if (SHOTS) await mkdir(SHOT_DIR, { recursive: true });

for (const reduced of [false, true]) {
  console.log(`\n== prefers-reduced-motion: ${reduced ? 'reduce' : 'no-preference'} ==`);
  const ctx = await browser.newContext({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const route of PAGES) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: HEIGHT[w] });
      await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('.auth-bg-image')?.complete);
      const s = await page.evaluate(() => {
        const img = document.querySelector('.auth-bg-image');
        const cs = getComputedStyle(img);
        const want = window.innerWidth < 768 ? '/brand/login-bg-sm.webp' : '/brand/login-bg.webp';
        const pre = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')].find((l) => l.getAttribute('href') === want && matchMedia(l.media || 'all').matches);
        const bgBox = document.querySelector('.auth-bg').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          src: img.currentSrc,
          natural: `${img.naturalWidth}x${img.naturalHeight}`,
          anim: cs.animationName,
          willChange: cs.willChange,
          transform: cs.transform,
          fit: cs.objectFit,
          pos: cs.objectPosition,
          want,
          preload: pre ? { type: pre.getAttribute('type'), prio: pre.getAttribute('fetchpriority') ?? 'auto' } : null,
          bgCovers: bgBox.width >= window.innerWidth && bgBox.height >= window.innerHeight,
          cardVisible: !!document.querySelector('.auth-card form, .auth-card [role="tabpanel"], .auth-card h2'),
        };
      });
      const label = `${route} @${w}`;
      const motionOk = reduced ? s.anim === 'none' && s.transform === 'none' && s.willChange === 'auto' : /auth-ken-burns/.test(s.anim) && s.willChange === 'transform';
      check(
        s.overflow <= 0 &&
          s.src.endsWith(s.want) &&
          s.fit === 'cover' &&
          s.bgCovers &&
          s.cardVisible &&
          motionOk &&
          s.preload?.type === 'image/webp' &&
          s.preload?.prio === (w < 768 ? 'auto' : 'high'),
        `${label.padEnd(26)} overflow=${s.overflow} src=${s.src.split('/').pop()} ${s.natural} anim=${s.anim} will-change=${s.willChange} pos=${s.pos} preload=${JSON.stringify(s.preload)}`,
      );
      if (!reduced) {
        let lowest = Infinity;
        // Pin the photo to both ends of the Ken Burns motion so the worst frame is measured, not a random one.
        for (const kf of ['0%', '100%']) {
          await page.evaluate((k) => {
            const img = document.querySelector('.auth-bg-image');
            img.style.animationPlayState = 'paused';
            img.style.animationDelay = k === '0%' ? '0s' : '-32s';
          }, kf);
          for (const r of await textContrast(page)) {
            const need = r.large ? 3 : MIN_TEXT_CONTRAST;
            lowest = Math.min(lowest, r.worst / need);
            if (r.worst < need) check(false, `${label} [${kf}] contrast ${r.worst.toFixed(2)} < ${need} for "${r.text}" (${r.sel})`);
          }
        }
        await page.evaluate(() => {
          const img = document.querySelector('.auth-bg-image');
          img.style.animationPlayState = '';
          img.style.animationDelay = '';
        });
        console.log(`      text contrast headroom ×${lowest.toFixed(2)} of the AA minimum`);
      }
      if (SHOTS && route === '/login') await page.screenshot({ path: path.join(SHOT_DIR, `login-${w}${reduced ? '-reduced' : ''}.png`) });
    }
  }
  check(errors.length === 0, `console errors: ${errors.length}${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

// Compositor-only check: trace 4 s of the running animation on an idle page.
console.log('\n== performance trace (1440x900, 4 s idle while animating) ==');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.animations,cc', transferMode: 'ReportEvents' });
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        const t = [];
        const tick = (now) => {
          t.push(now);
          if (now - t[0] < 4000) requestAnimationFrame(tick);
          else {
            const d = t.slice(1).map((v, i) => v - t[i]);
            res({ frames: d.length, avg: 1000 / (d.reduce((a, b) => a + b, 0) / d.length), worstMs: Math.max(...d) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await cdp.send('Tracing.end');
  await done;
  const count = (n) => events.filter((e) => e.name === n).length;
  const failed = events.filter((e) => e.name === 'Animation' && e.args?.data?.compositeFailed).map((e) => e.args.data.compositeFailed);
  const paints = count('Paint');
  const layouts = count('Layout');
  console.log(`  rAF: ${fps.frames} frames, avg ${fps.avg.toFixed(1)} fps, worst frame ${fps.worstMs.toFixed(1)} ms`);
  console.log(`  trace: Layout=${layouts} Paint=${paints} compositeFailed=${failed.length ? JSON.stringify([...new Set(failed)]) : 0}`);
  check(layouts === 0, 'no Layout during the animation');
  check(paints === 0, 'no Paint during the animation (compositor-only)');
  check(failed.length === 0, 'animation runs on the compositor (no compositeFailed)');
  check(fps.avg >= 55, `frame rate ≥ 55 fps (got ${fps.avg.toFixed(1)})`);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll auth background checks passed');
process.exit(failures ? 1 : 0);
