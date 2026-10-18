# FACILITO — STATUS DE ENTREGA (feat/intro-admin-hardening)

Fecha: 2026-10-18 · PR [#17](https://github.com/Dostindev8/Facilito.com/pull/17) · CI quality ✅ · Preview Vercel ✅ (Deployment Protection bloquea smoke anónimo)

## 1. RESUMEN

Fases 1–2 cerradas. Continuación: enlace de solicitud por query `?s=` (emails ya no pierden el token en el `#hash`), CORS de tests fijado, smoke prod (plans 200, CSP/HSTS/XFO), auth/platform tests 47/48 (1 flake CORS por env local → corregido). Admin/tickets/CMS y cobro transferencia siguen ⚠️/🔒.

## 2. BARRA BLANCA

Causa raíz + fix en commits previos (`e67b672`). Evidencia local `docs/audit/intro-at-*.png` ✅. Preview anónimo: página “Login – Vercel” (protección de deployment) → intro no verificable sin bypass 🔒.

## 3. INTRO v2.0

Local ✅ · Preview smoke DOM ❌ (Vercel auth) · reduced-motion código ✅ · fps/CLS ❌ no re-medidos

## 4. SEGURIDAD

| Pase | Estado |
|---|---|
| Estático | ✅ registro público ausente · MFA admin `requirePlatformAdmin` + `mfa_required` · Argon2/JWT en código |
| Dependencias | ⚠️ 3 vulns prod (2 ignored mobile) |
| Dinámico | ⚠️ headers prod verificados; IDOR suite no re-ejecutada completa |

- Prod API plans: **200**, `transferencia:false` 🔒 banco  
- Prod web login CSP nonce + `frame-ancestors 'none'` + HSTS + `X-Frame-Options: DENY` ✅  
- API CSP `frame-ancestors 'none'` + HSTS ✅  
- MFA admin: gate UI + guard servidor ✅ (código + platform.int)  
- Backups restore: 🔒 no probado  
- gitleaks historial: ❌ no corrido

## 5. PANEL ADMIN

| Módulo | Estado |
|---|---|
| Dashboard / solicitudes / tenants / users / finance / health / activity | ⚠️ parcial funcional (código) |
| Soporte tickets | ❌ no existe — no inventar |
| CMS website | ❌ no existe — no inventar |
| Banco / config pago | 🔒 `BILLING_BANK_*` |

## 6. PERMISOS

`requireRole` / `requirePlatformAdmin` / MFA ✅ código · matriz E2E exhaustiva ❌ · límites plan en domain/API ⚠️

## 7. SUSCRIPCIÓN → LOGIN

- Plans prod 200 ✅  
- “solicitud guardada”: **fix** — `statusLink` y `readSaved` usan `?s=id.token` (hash legacy aún leído) + test E2E nuevo  
- Transferencia checkout: ❌ `metodos.transferencia=false` hasta banco  
- E2E camino feliz: no re-corrido este turno (API local)

## 8. RESPONSIVE / A11Y / PERF

390 local ✅ · Preview protegido · axe/Lighthouse no re-corridos

## 9. PRUEBAS

- `auth.int` + `platform.int` + `tokens`: 47 passed; CORS flake local → `vitest.config` pin `CORS_ORIGINS`  
- `tsc` web ✅  
- E2E CI: quality job del PR ✅ (run previo)

## 10. GITHUB / VERCEL

- PR: https://github.com/Dostindev8/Facilito.com/pull/17  
- Preview web: `https://facilito-i8jpx5t2r-dostindevs-projects.vercel.app` (requiere login Vercel)  
- Prod: `facilitord.vercel.app` / `api-facilito.vercel.app` — **no** promocionado este turno (falta merge + banco)

## 11. RIESGO RESIDUAL

F4 módulos soporte/CMS · gitleaks · restore Neon · intro Preview sin Deployment Protection · cobro  
Logo PNG (no SVG partes) · mobile intro paridad

## 12. DECISIÓN HUMANA

1. `BILLING_BANK_*` en Vercel API  
2. Desactivar/bypass Preview Protection para QA anónimo o smoke con cookie  
3. Merge PR #17 → prod  
4. Legal / TRUST_BADGES

## 13. SIGUIENTE PASO

Merge PR #17 cuando apruebes; configurar banco; smoke prod `/login` intro (sessionStorage limpio).
