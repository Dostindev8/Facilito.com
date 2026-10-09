# QA — sitio público Facilito

Fecha de medición: 8 oct 2026. Rama `feat/website-3ds`, build de producción local (`next start`), Windows, Node 22.23.2.

## Pruebas

| Suite | Resultado |
|---|---|
| `tsc --noEmit` (apps/web) | 0 errores |
| Vitest (`apps/web`, 4 archivos) | 11/11 |
| Playwright completo (auth, factura, responsive, marketing) | 30/30, Chromium escritorio |
| axe (`@axe-core/playwright`) en `/`, `/features`, `/precios`, `/contacto`, `/nosotros`, `/legal/*` | 0 violaciones serias o críticas |

La regresión de auth (6 pruebas de `e2e/auth.spec.ts`) se corrió contra la API de `HEAD` (594b050) en un worktree limpio. Contra la API del árbol de trabajo fallan 6 pruebas porque hay cambios sin commitear de facturación en `apps/api` que responden 410 `registration_closed` al registro. No vienen de este trabajo.

No cubierto: WebKit y Chromium móvil (Pixel) en Playwright; solo hay proyecto de escritorio con viewports 375/768/1280/1536 en las pruebas de desborde.

## Lighthouse (móvil, simulado, `next start` local)

| Ruta | Perf | A11y | BP | SEO | LCP sim. | LCP observado | CLS | TBT |
|---|---|---|---|---|---|---|---|---|
| `/` | 93 | 100 | 100 | 92 | 3169 ms | 372 ms | 0.0015 | 106 ms |
| `/features` | 97 | 100 | 100 | 92 | 2530 ms | 321 ms | 0 | 54 ms |
| `/precios` | 97 | 100 | 100 | 92 | 2564 ms | 372 ms | 0.0024 | 86 ms |
| `/nosotros` | 95 | 100 | 100 | 92 | 2756 ms | 262 ms | 0.0035 | 105 ms |
| `/contacto` | 95 | 100 | 100 | 92 | 2872 ms | 462 ms | 0 | 84 ms |

Línea base antes del cambio: `/login` Perf 88, LCP 3,2 s.

Por debajo de la meta (≥95 en todo, LCP < 2,5 s):

- Perf de `/` en 93 y LCP simulado de 2,5 a 3,2 s en todas. El elemento LCP es el texto del hero; en la traza real pinta a ~0,3–0,5 s. La simulación cuenta los ~159 kB de JS de la home (motion, Lenis, header con auth). Medir en Vercel/PageSpeed real antes de dar la meta por cumplida o no.
- SEO 92 en todas: «Document does not have a meta description». Next 15 transmite los metadatos al `<body>` para navegadores. Forzarlos al `<head>` (`htmlLimitedBots`) daba SEO 100 pero bajaba Perf hasta 84; se revirtió (ver `DECISIONS.md` #19). `facebookexternalhit` recibe la descripción en el `<head>`.

## Cabeceras (respuesta real de `/`)

`Content-Security-Policy` con nonce y `strict-dynamic` (enforce), `Strict-Transport-Security` (solo build de producción), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`. Sin issues de CSP en consola en `/contacto` tras sacar zod del cliente.

## Rutas

200: `/`, `/features`, `/precios`, `/nosotros`, `/contacto`, `/legal/privacidad`, `/legal/terminos`, `/legal/cookies`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/login`, `/inicio`, imágenes OG (PNG). 404 en ruta inexistente.

## Bundle (First Load JS)

| Ruta | Página | First Load |
|---|---|---|
| `/` | 47.9 kB | 159 kB |
| `/contacto` | 1.46 kB | 104 kB |
| `/features`, `/precios` | 168 B | 106 kB |
| `/nosotros`, `/legal/*` | 166 B | 103 kB |
| `/login` (sin cambios) | 5.91 kB | 128 kB |

## Video del hero

No producido. `Fondofacilito.mp4` no está en disco y ffmpeg no está instalado. El hero usa el póster (`/media/facilito-hero-poster.webp`). Con el mp4 y ffmpeg: `node scripts/build-hero-video.mjs <ruta-mp4>`; `HeroVideo` lo monta solo si existen los loops.

## Dependencias

`pnpm audit --audit-level=high` sale con 0: quedan 1 moderado y 2 altos ya ignorados en `pnpm.auditConfig`. Dos avisos nuevos, ajenos a las dependencias del sitio, rompían el paso de audit de CI: `sharp` < 0.35.5 (CVE-2026-96889) y `shell-quote` < 1.11.0 vía Expo (GHSA-pqg4-j6r4-53mv). Se corrigieron con overrides en `package.json` raíz.

CI del PR (`quality`): typecheck, lint, tests, build, e2e con Postgres, aislamiento, gitleaks y audit en verde. Preview de Vercel desplegado; está detrás de Vercel SSO, sin smoke anónimo.
