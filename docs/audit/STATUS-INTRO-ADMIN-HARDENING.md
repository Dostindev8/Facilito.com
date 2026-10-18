# FACILITO — STATUS DE ENTREGA (feat/intro-admin-hardening)

Fecha: 2026-10-18 · Entorno verificado: local `localhost:3000` (NODE_ENV=development) + evidencia Playwright DOM/capturas · Prod no redeployada en este turno.

## 1. RESUMEN

Fase 1 y 2 cerradas con evidencia: causa raíz de la barra blanca corregida (track no se monta antes del logo; splash ya no hereda `visibility:hidden` del card). Login sin título “Facilito” duplicado y CTA en verde de marca `#00A651`. Fases 3–8 (seguridad completa, admin punta a punta, E2E CI, deploy prod) **no** están cerradas en este turno — ver §11.

## 2. BARRA BLANCA

- **Causa raíz:** `login-intro.tsx` + `globals.css` — track `.login-intro-bar` (`rgba(255,255,255,…)`) montado en t=0 con fill mínimo `scaleX(0.02)` mientras el logo tenía `opacity: 0` hasta 0.4s. Parche adicional hallado en v2: `visibility:hidden` en `.auth-card:has(.login-intro)` ocultaba el splash fijo por herencia.
- **Corrección:** barra solo tras logo (+120ms); unmount al salir (3.6s); card transparente sin `visibility:hidden`; Motion `animate()` para logo/fill.
- **Evidencia:** `docs/audit/intro-at-*.png` + DOM samples (bars=0 antes de logo; logoOpacity→1 con bar; post-handoff bars=0, heading=true) → ✅ local. Viewports 768/1440 y fps 4× → ❌ no medidos este turno.

## 3. INTRO v2.0

- Duración medida (aprox. desde splash visible): handoff login ~4.4–4.6s wall → dentro de 4.8–5.6 con margen de hidratación · fps: ❌ no perfilado · reduced-motion: código ✅ / E2E suite ❌ (API globalSetup) · StrictMode: cleanup timers/anims ✅ · CLS: no medido con Lighthouse este turno.

## 4. SEGURIDAD (pases)

| Pase | Estado |
|---|---|
| Estático (código) | ⚠️ parcial — Argon2/JWT/TOTP/rate-limit ya en API; no re-auditoría completa F3 |
| Dependencias | ⚠️ `pnpm audit --prod`: 3 vulns (previas; 2 ignored mobile) |
| Dinámico | ❌ no corrido este turno (IDOR/bruteforce/CSP headers live) |

- Secretos en historial: no escaneado gitleaks este turno → **pendiente**
- MFA admin: existe `MfaGate` ⚠️ no re-probado · Rate limit: en rutas auth ✅ código · IDOR: suite int existente, no re-ejecutada · CSP: headers en repo, no verificados en prod este turno · Backups: 🔒 política Neon / no restore probado

## 5. PANEL ADMIN

| Módulo | Estado | Evidencia |
|---|---|---|
| Dashboard KPIs | ⚠️ parcial | `admin/page.tsx` stats |
| Solicitudes/pagos | ⚠️ | `SubscriptionsPanel` |
| Clientes/tenants | ⚠️ | listados en admin page |
| Usuarios/roles | ⚠️ | platform users |
| Planes/límites | ⚠️ | API+domain; no CMS completo |
| Feature flags plan | ⚠️ | límites en domain/API |
| e-CF / NCF | ⚠️ | settings NCF; sin afirmar DGII live |
| Soporte tickets | ❌ | no módulo dedicado hallado |
| Seguridad (sesiones/IP) | ⚠️ | parcial |
| Auditoría | ⚠️ | activity feed |
| Sistema/health | ⚠️ | `HealthPanel` |
| Contenido/CMS | ❌ | no inventar |
| Config global / banco | 🔒 | `BILLING_BANK_*` humano |

## 6. PERMISOS

Matriz roles automatizada completa ❌ · límites de plan en servidor ⚠️ (código existe; no re-suite este turno)

## 7. FLUJO SUSCRIPCIÓN → PAGO → APROBACIÓN → LOGIN

- E2E camino feliz: existe (`e2e/auth.spec.ts`) — **no ejecutado** (globalSetup requiere API/admin).
- “Ocurrió un error” en Plan: mitigado previamente con fallback catálogo + backoff; prod plans 200 en sesión anterior. Re-smoke prod este turno ❌
- “no tiene una solicitud guardada”: mensaje esperado sin `localStorage` ni hash `#s=id.token`; enlace privado ya soportado → ⚠️ UX OK / no bug si falta token

## 8. RESPONSIVE / A11Y / RENDIMIENTO

- Capturas 390×844 ✅ · 768/1440 ❌ · axe ❌ · Lighthouse este turno ❌ (prev: login Perf 95 / LCP 2.8s)

## 9. PRUEBAS

- Unit/int: no re-corridas · E2E intro suite: añadidos asserts; run falló en globalSetup (API) · Script Playwright ad-hoc intro: ✅

## 10. GITHUB / VERCEL

- Rama: `feat/intro-admin-hardening` · commit splash: ver git · PR/CI/prod: pendiente push/PR si se aprueba
- Rollback: redeploy Vercel previous + no migraciones destructivas en este diff

## 11. RIESGO RESIDUAL / PENDIENTE

- F3–F7 completas (MFA enforce, IDOR live, axe, Lighthouse, gitleaks)
- Paridad intro en `apps/mobile` (anotada, fuera de Fase 2)
- Logo oficial es PNG (`facilito-mark.png`), no SVG separable check/hand
- `NODE_ENV=production` en shell rompe `next dev` (EvalError middleware) — ops local

## 12. REQUIERE DECISIÓN HUMANA

1. `BILLING_BANK_*` en Vercel API (cobro)
2. Revisión legal textos
3. Rotación si gitleaks halla secretos
4. Aprobar push/PR → Preview → Prod

## 13. SIGUIENTE PASO RECOMENDADO

Push de `feat/intro-admin-hardening` + PR a `main` con Preview Vercel; smoke intro en Preview; luego Fase 3 (auth/subscription) con API local + E2E.
