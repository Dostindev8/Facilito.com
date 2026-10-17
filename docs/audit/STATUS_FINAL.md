# Facilito — Estado final (ciclo crítico + UX app)

Fecha: 16 oct 2026 · Rama `fix/suscripcion-planes` · Plan F1–F8 pragmático.

## Veredicto

**Código del ciclo listo para merge.** Producción (`facilitord.vercel.app`) **sigue bloqueada para planes** hasta que el dueño aplique la migración `009` (+ `010`) en Neon y confirme `API_INTERNAL_URL` en Vercel web (ver `docs/ops/PROD-BILLING.md`). Smoke previo a este deploy: `GET /api/v1/billing/plans` → **500**.

## Entregado en este ciclo

| Ítem | Estado |
|---|---|
| `docs/audit/AUDIT-ISO.md` modular + smoke prod | ✅ |
| Docs `API_INTERNAL_URL` / migrate 009 / seed admin | ✅ `docs/ops/PROD-BILLING.md` + `POST /v1/platform/billing/plans/seed` |
| Subscribe-flow: errores, backoff, cache, banners, empty | ✅ |
| Idempotency-Key en checkout | ✅ |
| Tests API billing + E2E planes / `ver=estado` | ✅ (billing 29/29; E2E catálogo 3/3) |
| Login polish + `PageTransition` en `(app)` | ✅ |
| OWASP checklist + threat model + BACKUP-DR | ✅ |
| Sentry / restore Neon real / Expo POS / SMTP real | 🔒 |

## Evidencia (este turno)

| Verificación | Resultado |
|---|---|
| Smoke prod `GET …/api/v1/billing/plans` | 500 `internal` (schema/migración) |
| `pnpm --filter @facilito/api test -- billing.int.test.ts` | 29/29 |
| `pnpm --filter @facilito/{api,web} typecheck` | pass |
| `pnpm --filter @facilito/web build` | pass |
| E2E `catálogo de planes y banner de estado` | 3/3 |

## Gates de producción (dueño)

| Gate | Estado |
|---|---|
| Migración 009 (+ 010 audit/seed) en Neon prod | 🔴 abierto |
| `API_INTERNAL_URL` Production+Preview → host API | Verificar en Vercel |
| S-01 Preview ≠ DB prod | 🔴 abierto |
| `BILLING_BANK_*`, `SMTP_*`, `REDIS_URL`, `CRON_SECRET` | Abierto |
| Restore drill Neon medido | 🔒 |
| Sentry | 🔒 D-10 |

## Enlaces

- Auditoría: [`AUDIT-ISO.md`](./AUDIT-ISO.md)
- Ops billing: [`../ops/PROD-BILLING.md`](../ops/PROD-BILLING.md)
- DR: [`../ops/BACKUP-DR.md`](../ops/BACKUP-DR.md)
- OWASP: [`../security/CHECKLIST-OWASP.md`](../security/CHECKLIST-OWASP.md)
