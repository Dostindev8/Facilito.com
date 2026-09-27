# Facilito — Audit report (Inventario + Facturación, full-stack)

Date: 2026-09-26 · Scope: `apps/api`, `apps/web`, `packages/*`, `services/*`, `apps/mobile` (dependencies only) · Reference: login/registro and dashboard mockups, palette green `#0E8A5F` / orange `#F5871F`.

All results below come from runs on this date against the production web build (`next build` + `next start`) and the API on PGlite.

## ✅ Modules

| Module | Status | Evidence |
|---|---|---|
| Auth (login / registro split layout, recuperar, restablecer) | Done | `e2e/auth.spec.ts` 4/4, API auth suite |
| Dashboard (KPIs, sales chart 7/14/30, activity tabs, quick actions, business card, notifications) | Done | `responsive.spec.ts`, Lighthouse |
| Módulo 6 — Inventario (catalogue, auto SKU, margin, price ≥ cost, adjustments with reason, kardex, low stock, CSV import/export) | Done | API integration tests, smoke checks 10–21 |
| Módulo 7 — Facturación (new invoice, NCF sequences, ITBIS, idempotent submit, PDF, void with stock restore, list/detail) | Done | `invoice.int.test.ts`, `invoice-flow.spec.ts` |
| Shell (sidebar, icon-only tablet rail, mobile drawer, global search, 404, error boundary) | Done | `responsive.spec.ts` drawer test |

## 🔧 Bugs found and fixed

| # | Before | After |
|---|---|---|
| 1 | A new business could not issue its first sale: `ncf_tipo_default` was NOT NULL and pointed to a type with no sequence | Migration `005_ncf_default_optional.sql`: default NULL, CHECK on format; the first active sequence becomes the default; test covers the whole path |
| 2 | "Sin comprobante" option conflicted with the NOT NULL column | Same migration; PATCH to `null` allowed and tested |
| 3 | `/auth/refresh` shared the strict login rate limit — several devices behind one shop IP got logged out | Separate `AUTH_REFRESH_RATE_LIMIT_MAX` bucket |
| 4 | Spoofed `X-Forwarded-For` could pick a fresh rate-limit bucket through the Next rewrite | `TRUST_PROXY=0` default; smoke check proves a spoofed header shares the caller's bucket (ADR-010) |
| 5 | API listened on `0.0.0.0` | `API_HOST=127.0.0.1` default |
| 6 | Closed mobile drawer stayed reachable by keyboard | `visibility: hidden` when closed, Escape closes, focus moves in/out |
| 7 | Payment segmented control overflowed on phones and cut "Crédito" | Two equal `minmax(0,1fr)` columns |
| 8 | Value cards on the login panel ran title and subtitle together | Flex column |
| 9 | "1 productos activos" / "1 clientes" | Singular/plural |
| 10 | Chart used `role="img"` over interactive buttons | `role="group"`, compact axis labels, stacked weekday labels ≤479px |
| 11 | Contrast failures (muted grey, green text on white) | `--muted #5f6d82`, text uses `--green-600`; Lighthouse a11y 100 |
| 12 | Search input had invalid ARIA; logo `aria-label` without role | `role="combobox"` + `aria-autocomplete`; logo `role="img"` |
| 13 | Anonymous visit logged a 401 in the console (blind refresh) | `fc_s` hint cookie; no refresh call without it |
| 14 | Login page was `noindex` | Indexable with description |
| 15 | Mobile login form started below the fold | Compact brand header on ≤767px |
| 16 | Render-blocking CSS; shimmer + backdrop blur paint cost | `inlineCss`, pulse skeleton, solid header, `prefers-reduced-motion` |
| 17 | Dashboard layout shift (CLS 0.21 desktop): skeletons shorter than loaded cards | Skeletons render real labels with transparent placeholder text of the same shape; CLS ≈ 0 at 1280/1350/375 px |
| 18 | NCF hint link distinguishable only by colour | In-text links underlined |
| 19 | Proxy/gateway failure showed a generic "Ocurrió un error" | 5xx without problem+json → "El servicio no respondió…" |
| 20 | Vulnerable `sharp` (high), `@xmldom/xmldom`, `postcss`, `vitest` | Upgraded / overridden; 0 findings outside `apps/mobile` |

## 🔒 Security controls (verified)

- Passwords: Argon2id. Access JWT RS256 short-lived in memory; refresh `fc_rt` httpOnly + SameSite=Strict + path `/api/v1/auth`, rotated each use; reuse revokes the whole family (smoke checks 3–7).
- CSRF header `x-facilito-csrf` required on refresh/logout.
- Rate limiting: login/brute-force lockout (429), separate refresh bucket, socket-keyed by default.
- Validation: Zod on every route; errors in RFC 9457 problem+json without stack traces.
- Injection: parameterised SQL only; NoSQL not used; React escaping + strict CSP with per-request nonce, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
- Tenant isolation: Postgres RLS with `facilito_app` (NOBYPASSRLS); cross-tenant read returns 404 (smoke) and CI isolation suite.
- RNC encrypted at rest (field encryption key from `.env`); secrets only in `.env`, documented in `.env.example`; gitleaks in CI.
- Open-redirect protection on `?next=` (E2E).
- Dependencies: `pnpm audit` → 0 findings in api/web/services/packages. 16 remain in `apps/mobile` (Expo 52 toolchain: `tar` 1 critical + 10 high, `image-size` high, `uuid` moderate) — see TD-008.

## 📱 Breakpoints

Automated in `e2e/responsive.spec.ts`: 9 pages × 320 / 375 / 768 / 1024 / 1440 / 1920 px with a horizontal-overflow detector, plus the drawer keyboard test. Mobile uses the drawer, tablet the icon-only rail, tables become cards below 768px. Screenshots: `E2E_SCREENSHOTS=1 pnpm e2e` → `test-results/shots/`.

## 📊 Tests and quality gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | 11/11 tasks |
| `pnpm lint` | 11/11 tasks |
| `pnpm test` (vitest 4) | 145 passed (API 94, domain 36, verticals 6, ecf 4, copilot 4, mobile 1) |
| `pnpm build` | Web + 7 other tasks, no warnings |
| `pnpm e2e` (Playwright) | 10/10 — auth, product → invoice → stock 10→7 → void → stock 10, network failure + retry (single invoice), over-stock, responsive, drawer |
| `pnpm e2e:smoke` | 34/34 checks through the web origin |
| Lighthouse (authenticated) | `/inicio` 91–100 / 100 / 100; `/inventario` 99–100 / 100 / 100; `/facturacion/nueva` 100 / 100 / 100 (Perf / A11y / BP, mobile–desktop) |
| Lighthouse (public) | `/login` 94–100 perf, 100 a11y/BP/SEO; `/recuperar` SEO 63 by design (`noindex`) |

CI (`.github/workflows/ci.yml`) now also installs Chromium and runs `pnpm e2e`, uploading the report on failure.

## ⚠️ Pending and third-party blockers

These are not marked done:

- 🔒 Google OAuth — needs client ID/secret and consent screen.
- 🔒 Transactional email provider (reset/invite) — TD-014.
- 🔒 WhatsApp Business API — only `wa.me` links today.
- 🔒 DGII / PSFE e-CF certification and 606/607/608 layouts — `TODO: VERIFICAR EN VIVO` (TD-001, TD-005, TD-012).
- 🔒 NCF types and ITBIS rates must be confirmed against current DGII rules — `TODO: VERIFICAR EN VIVO`.
- 🔒 Production vault, TLS and an edge proxy that overwrites `X-Forwarded-For` before `TRUST_PROXY=1` (TD-003, TD-004, TD-016).
- 🔒 Support channel URL (`NEXT_PUBLIC_SUPPORT_URL`).
- Expo SDK upgrade for the mobile audit findings (TD-008) — CI's `pnpm audit --audit-level=high` step stays red until then.
- Remaining internal debt: TD-009 … TD-015 in `docs/tech-debt.md`.

---

# Login / Register — animated background (Ken Burns) and auth audit

Date: 2026-09-26 · Measured against the production build (`next build` + `next start`) with the API running.

## Files involved

| File | Role |
|---|---|
| `apps/web/src/components/auth/auth-layout.tsx` | Shared layout of `/login` (both tabs), `/recuperar`, `/restablecer`; now renders `<AuthBackground />` |
| `apps/web/src/components/auth/auth-background.tsx` (new) | `<picture>`: phone WebP (`media` ≤767px), full WebP, JPG fallback; `preload()` hoisted to `<head>` |
| `apps/web/src/components/auth/login-bg.meta.ts` (generated) | Intrinsic size used for `width`/`height` |
| `apps/web/src/app/globals.css` L970–1031, L1149–1157, L2663–2670 | `.auth-bg` layer, `.auth-bg-image` animation, keyframes, scrim, reduced motion, contrast fixes, phone keyframes |
| `apps/web/src/app/login/login-card.tsx` L14–23, L88–121 | ARIA tabs, focus on first invalid field |
| `apps/web/src/components/auth/brand-panel.tsx` | Deterministic headline line break |
| `apps/web/brand-src/login-bg-source.jpg` | Reference photo as supplied (1024×727) |
| `scripts/build-login-bg.mjs` (`pnpm assets:login-bg`) | Encodes the assets, never enlarges |
| `scripts/verify-auth-bg.mjs` | Breakpoints, preload, motion, measured contrast, performance trace |
| `e2e/auth.spec.ts` | +2 tests: keyboard tabs/validation focus, background motion/reduced motion |

## State before

`.auth-bg` was `position: absolute` behind the page with `next/image` of `hills-bg.webp`. That was a **different photo**, a 1280×720 source enlarged to 1920×1080 and hidden behind `filter: blur(3px)`. It had no animation. The white scrim lived in `.auth-page::before` and scrolled with the page. Stacking: `.auth-page` has `isolation: isolate`; the background was at `z-index: -2`, the scrim at `-1`, and the brand panel and card in normal flow above. The auth flow worked (E2E auth 4/4 at the start).

## Findings

| Severity | Finding | Result |
|---|---|---|
| Alto | The supplied photo is **1024×727**, below the 1920×1080 minimum. The only way to reach 1920 would be to enlarge it, which the brief forbids | Shipped at native resolution, **not enlarged**. The script warns and the new photo drops in with one command. 🔒 Needs the original file (≥1920, ideally 2560) |
| Alto (pre-existing) | Previous background was an enlarged 1280×720 source masked by blur | Replaced by the reference photo, no blur |
| Medio (pre-existing) | Mobile CLS 0.032 (`/login`), 0.029 (`/recuperar`): the headline wrapped to 2 lines in Poppins but 1 in the fallback font, pushing the card 28px | Explicit break "Tu negocio, más fácil / cada día" (also removes the orphan "día" at 375px) → CLS **0** |
| Medio (pre-existing) | Orange script line "Más tiempo para lo importante" at 2.0–2.4:1 over the photo — Lighthouse can't measure text over images | Deeper brand orange `#b45709` inside the auth panel only |
| Medio | Footer muted text 1.8–3.4:1 over the dark leaves (bottom-left) | `--ink-2` + a soft white radial in the scrim's bottom-left corner |
| Medio (pre-existing) | Tabs declared `tablist/tab` but had no `tabpanel`, `aria-controls`, roving tabindex or arrow keys | Full ARIA tabs pattern (←/→/Home/End) |
| Bajo (pre-existing) | Validation errors didn't move focus | Focus goes to the first `aria-invalid` field (client and server errors) |
| Bajo | Brand panel shrink-to-fit width shifted 0.003 on font swap (stacked layout) | `width: 100%` (still capped at 640px) |
| Conflict | `fetchpriority="high"` on phones raised mobile LCP 2.7–2.9s → 3.2–3.4s. Chrome never counts a full-viewport image as LCP; the LCP is the headline text | Phones get a 47 KB variant at normal priority; ≥768px keeps the high-priority preload |
| Info | Register has no "términos" checkbox | 🔒 Needs the legal terms document/URL; not invented |

## Implementation

- **Layers (back to front):** `.auth-bg` is `position: fixed`, height `100lvh` so mobile toolbars never resize it, `contain: strict`, `z-index: -1` inside the isolated `.auth-page`. Then `.auth-bg-image` (animated), then `.auth-bg::after` (static scrim), then the untouched brand panel and card.
- **Motion:** `auth-ken-burns 32s cubic-bezier(0.4,0,0.2,1) infinite alternate`, `translate3d(0,0,0) scale(1)` → `translate3d(-1.2%,-0.8%,0) scale(1.06)`. Phones use `scale(1.04)`, `-0.9%/-0.6%`. It is transform-only, with `will-change: transform` on the image only. The scale margin `(s−1)/2` always exceeds the pan, so no edge is ever revealed. `alternate` gives no jump at the loop.
- **Reduced motion:** `animation: none; transform: none; will-change: auto` (layer released).
- **CSS rather than the Web Animations API:** CSS keyframes start before hydration without JavaScript and run on the same compositor path. WAAPI would add client JS to a server-rendered layout for no gain.
- **`object-position: 50% 70%`:** keeps the hills and the valley in frame from 320px to 1920px; wide screens crop sky, not hills.
- **Loading:** `preload(login-bg.webp, { as: 'image', type: 'image/webp', fetchPriority: 'high', media: '(min-width: 768px)' })` and `preload(login-bg-sm.webp, { media: '(max-width: 767px)' })`. `decoding="async"`, `width`/`height` set. A sky-blue `background` on the layer avoids a white flash before decode.

## Assets

| File | Size | Dimensions |
|---|---|---|
| `login-bg.webp` (q88) | 95.2 KB | 1024×727 |
| `login-bg-sm.webp` (q80, phones) | 47.2 KB | 820×582 |
| `login-bg.jpg` (q88 mozjpeg, fallback) | 103.4 KB | 1024×727 |
| source | 135.9 KB | 1024×727 |

## Performance and quality (evidence)

| Metric | Before | After |
|---|---|---|
| LCP desktop (`/login`, registro, recuperar) | 0.6–0.7 s | 0.8 s (score 100) |
| LCP mobile | 2.7–2.9 s | 2.7–2.9 s |
| CLS mobile | 0.032 / 0 / 0.029 | **0 / 0 / 0** |
| CLS desktop | 0 | 0 |
| Lighthouse mobile perf | 94–96 | 93–96 |
| Lighthouse a11y / best practices | 100 / 100 | 100 / 100 |

The desktop +0.2 s comes from fetching the full photo at high priority, so it is visible with the first paint. Desktop still scores 100.

The animation trace, recorded for 4 s at 1440×900 while animating, showed 241 frames at **60.0 fps average**, a worst frame of 16.8 ms, **Layout 0, Paint 0**, and 0 compositor failures.

`scripts/verify-auth-bg.mjs` passes on `/login` and the register tab at 320/375/414/768/1024/1440/1920:

- no horizontal overflow;
- the correct file is chosen at each width;
- the preload is present;
- the animation is active, and fully stopped under reduced motion;
- zero console errors;
- measured text contrast is at least ×1.14 of the AA minimum at both ends of the motion.

## Auth flow (confirmed after the change)

- `pnpm e2e`: 12/12 passed. That covers UI registration, invalid then valid login with reload persistence and the httpOnly/Strict cookie, the protected-route redirect with `next`, open-redirect protection, keyboard tabs with validation focus, the background under both motion preferences, invoice flows and responsive checks.
- `pnpm e2e:smoke`: 34/34.
- `pnpm typecheck` / `pnpm lint`: 11/11 tasks.
- `pnpm test`: 145 passed.
- `next build`: no warnings.

## How to verify

```bash
pnpm assets:login-bg                        # re-encode (pass a path to a higher-resolution original)
pnpm --filter @facilito/web build && pnpm --filter @facilito/web start
node scripts/verify-auth-bg.mjs             # SHOTS=1 saves screenshots to test-results/auth-bg/
E2E_BASE_URL=http://localhost:3000 pnpm e2e
```

In Chrome DevTools on `/login`:

- **Performance:** record 5 s idle. The background produces only compositor frames: no purple Layout and no green Paint.
- **Rendering → Frame Rendering Stats:** steady ~60 fps.
- **Rendering → Paint flashing:** the background never flashes.
- **Rendering → Emulate `prefers-reduced-motion: reduce`:** the photo is static.
- **Layers:** `.auth-bg-image` sits on its own layer.
- **Network:** at ≥768px `login-bg.webp` loads at High priority; on a phone viewport `login-bg-sm.webp` loads at normal priority.
