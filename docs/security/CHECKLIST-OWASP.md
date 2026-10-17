# Checklist OWASP (ASVS L1) — Facilito

Fecha: 16 oct 2026. Evidencia en código y tests existentes; no sustituye pentest externo.

| Control | Evidencia | Estado |
|---|---|---|
| V2 Passwords — Argon2id | `apps/api/src/auth/tokens.ts` + tests auth | ✅ |
| V3 Session — JWT access corto + refresh HttpOnly Rotate | `fc_rt` cookie, `SameSite=Strict`, tests E2E login | ✅ |
| V3 CSRF — cookie + header en mutaciones auth | `x-facilito-csrf` en `api.ts` | ✅ |
| V4 Access control — RBAC + platform admin | `requireRole` / `requirePlatformAdmin`, E2E admin 403 | ✅ |
| V4 Multi-tenant — RLS forced | ADR-001, `db-rls.test.ts` | ✅ |
| V5 Input — Zod strict en checkout/billing | `billing.service.ts` schemas | ✅ |
| V7 Error — Problem Details, sin SQL en cliente | `http/errors.ts` `mapDbError` | ✅ |
| V8 Data — RNC cifrado + hash | `encryptField` / `hashRnc` | ✅ |
| V9 Comms — HTTPS en Vercel; HSTS vía plataforma | Deploy Vercel | ✅ (plataforma) |
| V10 Malicious — rate limit auth + upload sanitize | Fastify rate-limit, `sanitizeReceipt` | ✅ |
| V12 Files — tipos mime, tamaño, PDF active content | `upload-guard` + billing receipts | ✅ |
| V14 Config — secretos en env, no en repo | `.env.example` nombres only | ✅ |
| CSP nonce (web) | Next middleware / headers (ver `docs/security-auth-review.md`) | ✅ |
| Logging / monitoring (Sentry) | No instalado — requiere aceptación términos | 🔒 D-10 |
| Preview aislado de DB prod | S-01 | 🔴 dueño |
| Backup restore drill | `docs/ops/BACKUP-DR.md` | 🔒 ejecución Neon |

## Regresiones a vigilar

- No reabrir `POST /v1/auth/register` público.
- No servir `API_INTERNAL_URL=http://127.0.0.1:3001` en Production.
- No poner `DATABASE_URL` de prod en Preview.
