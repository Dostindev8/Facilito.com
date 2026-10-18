# Status por área — Facilito (18 oct 2026)

Evidencia de este turno: migraciones Neon aplicadas, smoke API/UI, Lighthouse mobile.

**Agente listo:** `AGENTS.md` · `.cursor/rules/facilito.mdc` · skill proyecto `.cursor/skills/facilito-ops` · GOD-STACK-ING v8.3 (`DIGEST` + `references/facilito-ops.md` + `agent-toolkit.md`).

## ¿Listo para producción?

| Modo | Veredicto | Motivo |
|---|---|---|
| Soft launch (ver planes, login, solicitar datos) | ✅ Sí | Planes API 200, UI/intro/legales rutas OK |
| Cobrar / cerrar checkout transferencia | ❌ No | `metodos.transferencia=false` — faltan `BILLING_BANK_*` en Vercel |
| Lanzamiento legal “final” | ⚠️ Parcial | Textos legales aún como borrador |

Sin secretos en git: solo nombres de variables; valores solo en Vercel.

## Neon / API planes

| Ítem | Estado | Evidencia |
|---|---|---|
| Migración `009_billing_subscriptions.sql` | ✅ | `pnpm --filter @facilito/api migrate` → Applied |
| Migración `010_billing_plans_seed_audit.sql` | ✅ | Idem |
| Seed planes (Inicial / Profesional / Negocio) | ✅ | Incluido en 009 |
| `GET https://api-facilito.vercel.app/v1/billing/plans` | ✅ **200** | 3 items, precios 69000 / 149000 / 249000 |
| Proxy web `/api/v1/billing/plans` | ✅ **200** | Mismo payload |
| Banner «lista desactualizada» | ✅ | Ya no aparece (UI lee API live) |
| `DATABASE_ADMIN_URL` en Vercel | ⚠️ | No estaba; migrate usó `DATABASE_URL_UNPOOLED` local. Conviene fijarla en Production para ops futuras |

## Performance (Lighthouse mobile, este turno)

| Página | Perf | LCP | CLS | Notas |
|---|---|---|---|---|
| `/login` | 95 | **2.8 s** ⚠️ | **0** ✅ | Objetivo LCP &lt; 2.5 s; fondo lomas + intro pesan LCP |
| `/suscribirme` | 91 | **2.3 s** ✅ | **0** ✅ | TBT 340 ms (aceptable) |

## Pago / banco

| Ítem | Estado | Notas |
|---|---|---|
| Código transferencia + comprobante | ✅ | Implementado |
| `metodos.transferencia` en API | ❌ **false** | Faltan vars en Vercel API |
| `BILLING_BANK_NAME` / `ACCOUNT` / `HOLDER` (+ tipo / ID) | 🔒 Dostin | Sin inventar datos. Ver `.env.example` y `docs/ops/PROD-BILLING.md` |
| Tarjeta | 🔒 | Fuera de alcance (sin pasarela) |

## Confianza / legales

| Ítem | Estado | Notas |
|---|---|---|
| Trust points acordados (sin ISO/PCI inventados) | ✅ | `TRUST_POINTS` + `PLAN_CONDITIONS` |
| `TRUST_BADGES[]` | ✅ vacío | Listo para sellos reales; 🔒 Dostin si existen |
| `/legal/privacidad` `/terminos` `/cookies` | ✅ rutas | Copy marcado borrador |
| Revisión legal final / abogado | 🔒 Dostin | No automatizable |

## Producto UX (ciclo previo, verificado en prod)

| Área | Tenemos | Falta |
|---|---|---|
| Intro cinemático 4 s + Saltar | ✅ | — |
| Login a11y / Sitio web / suscribirse | ✅ | LCP −0.3 s opcional |
| Planes fuente única + beneficios/comparativa | ✅ | — |
| Tipos de negocio combobox + Otro | ✅ | — |
| Validación RNC / teléfono RD | ✅ | — |
| Admin Copilot hint en planes | ✅ | — |
| CI / PR #16 / prod web+API | ✅ | Redeploy si cola Vercel se traba |

## Qué debe aportar Dostin (bloqueantes de negocio)

1. **Banco (obligatorio para cobrar):** en Vercel proyecto `api-facilito` → Production:
   - `BILLING_BANK_NAME`
   - `BILLING_BANK_ACCOUNT`
   - `BILLING_BANK_ACCOUNT_TYPE` (ej. Corriente)
   - `BILLING_BANK_HOLDER`
   - `BILLING_BANK_HOLDER_ID` (opcional)
   - Luego redeploy API. Smoke: `metodos.transferencia === true`.
2. **Sellos reales** (opcional): texto/URL → se añaden a `TRUST_BADGES` en `packages/domain/src/plans.ts`.
3. **OK legal** de Privacidad / Términos / Cookies (quitar “borrador”).
4. (Recomendado) `DATABASE_ADMIN_URL` = connection string Neon **unpooled/owner** solo en Production (no Preview).
