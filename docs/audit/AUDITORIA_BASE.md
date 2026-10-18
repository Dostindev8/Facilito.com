# Auditoría base — Facilito (pre–intro/planes)

Fecha: 17 oct 2026 · Rama de trabajo `feat/intro-login-planes` · Estado previo a Fases 1–7 del mega-prompt.

## Inventario (rutas clave)

| Área | Rutas / piezas |
|---|---|
| Auth | `/login`, `/recuperar`, `/restablecer`, `/activar` |
| Checkout | `/suscribirme` (Plan → datos → pago → aprobación) |
| Legales | `/legal/privacidad`, `/terminos`, `/cookies` |
| App | `/inicio`, inventario, facturación, ventas, clientes, reportes, configuración, suscripción |
| Admin | `/admin` (solicitudes, finanzas, salud) |
| Assets | `/brand/facilito-mark.png`, `/brand/login-bg.webp` (+ jpg/sm) |
| API billing | `GET /v1/billing/plans`, checkout, comprobante, platform subscriptions |
| Precios (antes) | Migración 009 SQL + `DEFAULT_PLANS` en `billing.service.ts` (duplicado) |
| Tipos negocio (antes) | Lista corta en `business-profile.ts` + Combobox libre |

## Evidencia de calidad (baseline este turno)

| Comando | Resultado |
|---|---|
| `pnpm --filter @facilito/domain test` | 82/82 (antes de nuevos tests RNC/planes) |
| `pnpm --filter @facilito/web typecheck` | pass |
| Smoke prod `GET …/api/v1/billing/plans` | **503** `plans_unavailable` (migración Neon pendiente) |
| Planes en UI prod (capturas) | Visibles vía fallback/cache o preview previo |

## Gaps identificados para este ciclo

1. Sin intro cinemático en login.
2. Precios duplicados (SQL + API + UI hardcode parcial).
3. Tipos de negocio: catálogo corto, sin categorías ni “Otro” explícito.
4. RNC: solo formato 9/11, sin dígito verificador.
5. Admin: planes leídos de API sin catálogo de beneficios unificado.
