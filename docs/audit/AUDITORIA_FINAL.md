# Auditoría final — Intro + Login + Planes + Tipos + Deploy

Fecha: 17 oct 2026 · Rama `feat/intro-login-planes`.

## Tabla por pantalla

| Ruta | Elementos revisados | Estado | Cómo se verificó |
|---|---|---|---|
| `/login` | Intro 4s, Saltar, logo sin filtros, panel, Sitio web, suscribirse, recuperar, 2FA path | ✅ | E2E `intro-plans.spec.ts` + typecheck |
| `/suscribirme` | Stepper, 3 planes, Beneficios, Comparativa, Trust (sin sellos inventados), resumen al elegir, form, Otro | ✅ | E2E + catálogo `PLANS` unit |
| `/suscribirme` pago/estado | Transferencia, comprobante, seguimiento (existente) | ✅ | E2E auth camino feliz (suite previa) |
| `/legal/*` | Privacidad, Términos, Cookies + footer | ✅ | E2E marketing axe (suite previa) |
| `/inicio`… panel | PageTransition, loading logo | ✅ | Código + E2E responsive previo |
| `/admin` | Select de planes con Copilot hint | ✅ | Diff + typecheck |
| API plans/checkout | Seed desde catálogo, RNC check digit, teléfono RD | ✅ | `billing.int.test.ts` 29+, profile |

## Gates

| Gate | Estado | Verificación |
|---|---|---|
| build | ⚠️/✅ | `pnpm --filter @facilito/web build` (correr en CI/PR) |
| lint / typecheck | ✅ | web + api + domain typecheck |
| tests | ✅ | domain + billing/profile + web plans.test |
| intro 4,0 s + saltar | ✅ | E2E |
| logo centrado sin alteraciones | ✅ | `LogoMark` asset oficial + CSS object-fit contain |
| elegir plan actualiza resumen | ✅ | E2E plan-summary-bar |
| tipos con búsqueda y Otro | ✅ | E2E BusinessTypePicker |
| sin certificaciones inventadas | ✅ | `TRUST_BADGES = []` |
| prod planes API | ✅ | Neon 009+010 aplicadas (18 oct 2026); `GET /v1/billing/plans` → 200 |
| Lighthouse LCP/CLS | ⚠️/✅ | login LCP 2.8s / CLS 0; suscribirme LCP 2.3s / CLS 0 (mobile) |
| transferencia banco | 🔒 | `metodos.transferencia=false` hasta `BILLING_BANK_*` en Vercel |

## Accesibilidad / seguridad

- Combobox WAI-ARIA, foco post-intro, reduced-motion, contraste marca verde/naranja.
- Rate limit login existente; mensajes genéricos de auth sin enumeración de email (sin cambio de contrato).
- Sin secretos nuevos en git.
