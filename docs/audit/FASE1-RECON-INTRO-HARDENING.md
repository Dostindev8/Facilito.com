# Fase 1 — Reconocimiento (feat/intro-admin-hardening)

Fecha: 2026-10-18 · Rama: `feat/intro-admin-hardening`

## 1.1 Mapa del repo (confirmado)

| Pieza | Realidad |
|---|---|
| Monorepo | Turborepo + pnpm · `apps/web` (Next 15.5), `apps/api` (Fastify), `apps/mobile` (Expo), `packages/domain` |
| Node / pnpm | Node 22 · pnpm 9.15.9 |
| Animación | Paquete `motion@14` en web (no GSAP; no Framer Motion clásico) |
| Login | `apps/web/src/app/login` + `LoginIntro` + `LoginCard` |
| Intro | `apps/web/src/components/auth/login-intro.tsx` + CSS en `globals.css` ~3688 |
| DB | Neon/Postgres · migraciones 001–010 (009/010 billing aplicadas en prod) |

## 1.2 Línea base

| Check | Resultado |
|---|---|
| `pnpm --filter @facilito/web exec tsc --noEmit` | ✅ (sin salida de error) |
| `pnpm audit --prod` | ⚠️ 3 vulns (1 moderate, 2 high ignored en mobile/expo paths) |
| Prod plans API | ✅ 200 (sesión previa) |
| Transferencia | ❌ `metodos.transferencia=false` (BILLING_BANK_* 🔒) |

## 1.3 Causa raíz — barra blanca

**Elemento:** `.login-intro-bar` (track `rgba(255,255,255,0.35)`) + fill `span` con `scaleX(max(0.02, progress))`.

**Por qué:**
1. El track blanco se monta en t=0 al entrar en `phase === 'intro'`.
2. El logo tiene `opacity: 0` hasta `0.4s` (`login-intro-logo-in` delay).
3. El fill fuerza mínimo `0.02` → punto verde/naranja visible sin logo.
4. La barra JS solo “avanza” desde 1.0s, pero el **track** ya está en pantalla.

**Archivos:** `login-intro.tsx` L108–110 · `globals.css` `.login-intro-bar` L3751–3766.

**Prohibido:** parche con `display:none` permanente / z-index. **Correcto:** no montar la barra hasta la fase de logo; desmontar del DOM al salir.

## 1.4 UI login (capturas)

| Hallazgo | Severidad |
|---|---|
| Barra blanca pre-logo | 🔴 Crítico UX |
| Marca duplicada (`Logo` + título “Facilito”) | 🟡 Alto |
| Botón verde apagado / contraste | 🟡 Alto (verificar disabled vs color) |
| Progress bar corta + jerarquía tipográfica | 🟢 Medio |
| Card “lavada” en frame intermedio | 🟢 Medio (animación) |

## 1.5 Prioridad

1. Splash v2 sin track prematuro (Fase 2)  
2. Login marca única + contraste CTA  
3. Auth/admin audit (fases 3–4) — sin inventar banco  

Continúa Fase 2.
