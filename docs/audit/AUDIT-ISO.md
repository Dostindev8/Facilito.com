# Facilito — Auditoría ISO modular (ciclo crítico)

Fecha: 16 oct 2026 · Rama `fix/suscripcion-planes` · Norma de referencia: ISO/IEC 25010 (calidad), 12207 (ciclo de vida), 29119 (pruebas), 27001 (controles) + OWASP ASVS L1.

Evidencia de comandos de este ciclo: ver sección **Smoke y calidad**. Hallazgos priorizados 🔴→⚪. Blockers de tercero = 🔒.

## Smoke producción (evidencia)

| Probe | Resultado |
|---|---|
| `GET https://facilitord.vercel.app/api/v1/billing/plans` | **HTTP 500** `code=internal` (2026-10-16) |
| `GET https://api-facilito.vercel.app/v1/billing/plans` | **HTTP 500** `code=internal` (mismo cuerpo) |
| `GET …/v1/health` (web rewrite y API directa) | **404** `route_not_found` (no hay health público en esa ruta) |

**Causa raíz probable (orden):** (1) migración `009_billing_subscriptions.sql` no aplicada en Neon prod → `billing.plan` inexistente; (2) menos frecuente: rewrite/`API_INTERNAL_URL` mal apuntado (aquí ambos orígenes fallan igual, apunta a schema); (3) planes `activo=false` daría 200 con `items: []`, no 500.

Desbloqueo: dueño corre `pnpm --filter @facilito/api migrate` contra prod (ver `docs/ops/PROD-BILLING.md`). Seed admin: `POST /v1/platform/billing/plans/seed` si la tabla existe pero está vacía.

## Matriz por módulo

| Módulo | ISO 25010 foco | Estado | Hallazgos / notas |
|---|---|---|---|
| Web auth (`/login`, cookies JWT, CSRF) | Security, Usability | ⚠️ | Argon2id + RS256 HttpOnly + CSP nonce en código. Login pulido en este ciclo. S-01 Preview→DB prod 🔴 abierto (dueño). |
| Suscripción pública (`/suscribirme`) | Reliability, Usability | 🔴→⚠️ | Prod 500 planes. UI: errores específicos, backoff, cache, banners `ver=estado` aislados, empty state (este ciclo). |
| App panel (`(app)`) | Usability, Maintainability | ⚠️ | PageTransition + splash coherente. F-07 invitaciones personal abierto (backlog). |
| Admin plataforma | Security (RBAC) | ✅ | `requirePlatformAdmin` + TOTP; rutas billing de cola. Seed planes admin añadido. |
| API billing | Functional suitability, Security | 🔴 ops | Código + tests locales OK; prod sin migración 009. Webhook tarjeta 🔒 D-04. |
| API auth / identity | Security | ✅ | Rate limit, lockout, refresh rotation. Registro público retirado. |
| Mobile (Expo) | Portability | 🔒 | Scaffold; paridad POS fuera de este ciclo. |
| CI / ops | Maintainability, Reliability | ⚠️ | CI quality en PR #8 verde histórico. Backup/DR documentado; restore drill Neon 🔒. Sentry 🔒 D-10. |

## Prioridad de hallazgos (este ciclo)

| ID | Sev | Hallazgo | Acción |
|---|---|---|---|
| P-01 | 🔴 | `/api/v1/billing/plans` → 500 en prod | Migración 009 + seed (dueño) · UI resiliente (código) |
| P-02 | 🟠 | Banner `ver=estado` puede coexistir con error de planes | Separar jerarquía de banners (código) |
| P-03 | 🟠 | Errores genéricos en carga de planes | Mensajes por red/timeout/5xx/vacío + backoff (código) |
| P-04 | 🟡 | `API_INTERNAL_URL` bakeado en rewrite Vercel | Documentar checklist Production+Preview |
| P-05 | 🟡 | Sin restore drill medido | `docs/ops/BACKUP-DR.md` procedimiento; ejecución 🔒 |
| P-06 | ⚪ | Sentry / Expo / tarjeta / SMTP real | 🔒 blockers de tercero |

## Enlaces

- Estado previo: [`STATUS_FINAL.md`](./STATUS_FINAL.md)
- Decisiones: [`DECISIONES_PENDIENTES.md`](./DECISIONES_PENDIENTES.md)
- Ops billing: [`../ops/PROD-BILLING.md`](../ops/PROD-BILLING.md)
- OWASP: [`../security/CHECKLIST-OWASP.md`](../security/CHECKLIST-OWASP.md)
