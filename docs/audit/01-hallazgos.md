# Fase 1 — Hallazgos

Fecha: 2026-10-12 · Rama: `audit/facilito-prod-ready` · Base: `c850700`
Severidad: 🔴 crítico (bloquea producción o expone datos) · 🟡 alto · 🟢 medio · ⚪ bajo.
Esfuerzo: S (<2 h, quick win) · M (2–8 h) · L (>8 h, refactor estratégico).
Columna «Estado» se actualiza al cerrar cada fase; «🔒» = requiere acción o dato del dueño.

## 1.1 Funcionalidad y negocio

| ID | Sev | Hallazgo → riesgo | Evidencia | Fix propuesto | Esf. | Estado |
|----|-----|-------------------|-----------|---------------|------|--------|
| F-01 | 🔴 | Registro público abierto: cualquiera crea un negocio sin pagar ni ser aprobado → contradice el modelo de negocio. | `apps/api/src/routes/auth.routes.ts` (`POST /v1/auth/register`), `apps/web/src/app/login/login-card.tsx` (pestaña «Crear cuenta»), CTAs en `components/marketing/*` vía `site.registerPath` | Retirar endpoint, UI y textos; 301 de `/register`, `/registro`, `/signup`, `/onboarding` a `/suscribirme`. El alta pasa por suscripción + autorización. | M | Fase 3 |
| F-02 | 🔴 | No existe cobro ni suscripción: no hay forma de pagar, ni estados, ni renovación. | No hay tablas ni rutas de billing en `main` | Máquina de estados (`packages/domain/src/subscription.ts`), migración `009_billing_subscriptions.sql`, adaptador `PaymentProvider`, checkout por transferencia con comprobante, webhook firmado e idempotente, gracia → suspensión de solo lectura. | L | Fase 3 |
| F-03 | 🔴 | El panel de plataforma no tiene cola de autorización, finanzas ni salud. | `apps/web/src/app/(platform)` solo tiene usuarios/negocios/actividad | Cola Autorizar/Rechazar/Reenviar con confirmación, suscripciones, MRR, ledger, salud. | L | Fase 3 |
| F-04 | 🟡 | Botón «Enviar por correo» de una factura siempre responde 501 → elemento muerto. | `apps/api/src/routes/invoice.routes.ts:50-58`, `apps/web/src/app/(app)/facturacion/[id]/page.tsx:105` | Implementar con el mailer existente si SMTP está configurado; si no, 503 con mensaje claro y ocultar el botón. | S | Fase 2 |
| F-05 | 🟡 | Botón «Continuar con Google» responde 501 → elemento muerto. | `auth.routes.ts` (`GET /v1/auth/google`), `login-card.tsx` | Retirar botón y ruta. | S | Fase 3 |
| F-06 | 🟡 | Precios públicos en USD con plan «Gratis» y `PRICES_CONFIRMED=false`; contradicen pago obligatorio. | `apps/web/src/content/pricing.ts` | Planes desde `billing.plan` (DOP, centavos enteros) vía API pública; precios marcados «por confirmar» hasta que el dueño los fije. | M | Fase 3/4 · 🔒 precios |
| F-07 | 🟡 | El dueño no puede invitar empleados desde la app (solo existe en pruebas vía SQL). | `apps/api/src/tests/helpers.ts` `addStaff()`; no hay ruta | Reutilizar la invitación de un solo uso de Fase 3 para empleados. | M | Estratégico — ver 06-qa |
| F-08 | 🟢 | Copilot responde en modo `stub` (sin LLM). No está expuesto en la web → no es elemento muerto. | `apps/api/src/services/copilot.service.ts` (`stubLlm`) | Mantener oculto hasta elegir proveedor LLM. | — | 🔒 decisión |
| F-09 | 🟢 | Reportes 606/607/608 y e-CF pendientes; la UI lo declara con aviso honesto. | `reportes/page.tsx:200`, ADR-011 | Integración con proveedor `ef2` (decidido) en fase propia. Nunca afirmar certificación DGII. | L | 🔒 credenciales ef2 |

## 1.2 Seguridad (OWASP Top 10 2021)

| ID | Sev | Hallazgo → riesgo | Evidencia | Fix propuesto | Esf. | Estado |
|----|-----|-------------------|-----------|---------------|------|--------|
| S-01 | 🔴 | Credenciales **dueño** de Neon (producción) presentes en entornos Preview y Development de Vercel → cualquier preview puede leer/escribir producción (A05/A01). | Vercel API `env` del proyecto API (nombres y targets, valores no leídos) | Quitar `DATABASE_*` de Preview/Development o apuntarlos a una rama Neon de staging. Cambia env de producción → requiere confirmación del dueño. | S | 🔒 confirmación |
| S-02 | 🔴 | Admin de plataforma sin 2FA obligatorio; la contraseña actual es débil. Un robo de credencial da control total (A07). | `auth.service.ts` (TOTP opcional), `platform.routes.ts` | TOTP obligatorio para SUPER_ADMIN/ADMIN: sin TOTP el token queda limitado a enrolarse (`mfa_required`). Rotar la contraseña. | M | Fase 3 · 🔒 rotación |
| S-03 | 🟡 | Sin Redis en producción: rate limit y bloqueo de login viven por instancia serverless → un atacante distribuye intentos (A07). | Vercel env sin `REDIS_URL`; `utils/cache.ts` cae a `Map()` | Provisionar Upstash Redis (`REDIS_URL`). El código ya lo soporta. | S | 🔒 cuenta Upstash |
| S-04 | 🟡 | Bloqueo de login fijo, no progresivo. | `auth.service.ts` (`LOGIN_LOCK_SECONDS`) | Duración del bloqueo creciente por reincidencia (x2, tope 24 h). | S | Fase 3 |
| S-05 | 🟡 | Sin listado ni revocación remota de sesiones por el usuario. | `identity.refresh_token` sin UA/IP | Columnas `user_agent`/`ip` (migración 009), `GET/DELETE /v1/auth/sessions`. | M | Fase 3 |
| S-06 | 🟡 | GitHub Actions sin fijar por SHA y sin Dependabot → riesgo de cadena de suministro (A08). | `.github/workflows/ci.yml` | Fijar a SHA y añadir `.github/dependabot.yml`. | S | Fase 5 |
| S-07 | 🟢 | `Permissions-Policy: camera=()` bloquea el escáner de códigos de barras propio. | `apps/web/next.config.ts` | `camera=(self)`. | S | Fase 2 |
| S-08 | ⚪ | Verificado correcto: Argon2id, JWT RS256, cookie `fc_rt` HttpOnly+Secure+SameSite, `trust proxy` antes de middlewares, zod en endpoints, RLS FORCE con rol sin BYPASSRLS, helmet/CSP, logs sin secretos (redacción pino). | `auth/`, `app.ts`, `db/` | — | — | OK |

## 1.3 UI/UX (375 · 390 · 768 · 1024 · 1280 · 1536)

| ID | Sev | Hallazgo → riesgo | Evidencia | Fix propuesto | Esf. | Estado |
|----|-----|-------------------|-----------|---------------|------|--------|
| U-01 | 🟡 | `fetch` sin timeout: si la API se cuelga, «Cargando tu negocio» queda infinito, sin reintento. | `apps/web/src/lib/api.ts` (sin `AbortSignal`), `app-shell.tsx` | Timeout de 15 s en peticiones; pantalla de carga con «Reintentar» tras el timeout. | S | Fase 2 |
| U-02 | 🟢 | Pestaña «Crear cuenta» y CTAs «Empieza gratis» en hero, header, pricing, CTA final y botón flotante. | `components/marketing/*` | Sustituir por «Suscribirme» → `/suscribirme`. | S | Fase 3/4 |
| U-03 | ⚪ | Verificación visual por viewport. | — | Capturas en 6 viewports en Fase 4. | M | Fase 4 |

## 1.4 Rendimiento (Lighthouse)

| ID | Sev | Hallazgo | Evidencia | Fix | Esf. | Estado |
|----|-----|----------|-----------|-----|------|--------|
| P-01 | ⚪ | Build: 37 páginas, JS compartido 103 kB, 0 warnings. Lighthouse en vivo pendiente de medición. | `pnpm build` (Fase 0) | Medir en Fase 4 sobre preview. | S | Fase 4 |

## 1.5 Resiliencia

| ID | Sev | Hallazgo → riesgo | Evidencia | Fix propuesto | Esf. | Estado |
|----|-----|-------------------|-----------|---------------|------|--------|
| R-01 | 🔴 | Correo de producción roto (`SMTP_PASS` ausente): recuperación de contraseña e invitaciones no llegan. | Vercel env del API | Código listo; falta la App Password de Gmail o un proveedor (Resend/SES). Mitigación: el admin copia el enlace de activación y lo envía por WhatsApp. | S | 🔒 credencial |
| R-02 | 🟢 | `/v1/health` existe; no hay health de dependencias (DB, Redis, SMTP) visible para el admin. | `routes/health.routes.ts` | Panel «Salud» en plataforma. | S | Fase 3 |

## 1.6 Datos y respaldos

| ID | Sev | Hallazgo → riesgo | Evidencia | Fix propuesto | Esf. | Estado |
|----|-----|-------------------|-----------|---------------|------|--------|
| D-01 | 🟡 | Sin respaldo propio ni prueba de restauración; RPO/RTO sin definir. Neon solo ofrece PITR según plan. | No hay scripts ni docs | Documentar PITR Neon + `pg_dump` cifrado programado; prueba de restauración en rama Neon. | M | Fase 5 · 🔒 plan Neon |
| D-02 | ⚪ | Datos fiscales nunca se borran: append-only en `audit.*`, ledger y comprobantes; suspensión = solo lectura. | Migraciones 001–008, 009 | — | — | OK |

## 1.7 Legal y fiscal (RD)

| ID | Sev | Hallazgo → riesgo | Evidencia | Fix propuesto | Esf. | Estado |
|----|-----|-------------------|-----------|---------------|------|--------|
| L-01 | 🟡 | Términos y privacidad no mencionan suscripción, renovación, cancelación ni reembolsos. | `apps/web/src/app/(marketing)/legal/terminos`, `legal/privacidad` | Añadir cláusulas de suscripción (texto marcado «revisión legal pendiente»). | S | Fase 4 · 🔒 revisión legal |
| L-02 | 🟢 | Cobro de la suscripción requiere factura con NCF al cliente (Facilito como contribuyente). | Ley 32-23 / norma e-CF — TODO: VERIFICAR EN VIVO | Recibo interno descargable ahora; factura fiscal vía `ef2` cuando esté integrado. | M | 🔒 RNC de LCS |
| L-03 | ⚪ | Pasarelas de tarjeta disponibles en RD (Azul, CardNet, PayPal, Stripe vía entidad extranjera) — disponibilidad y requisitos NO VERIFICADOS en vivo. | — | Adaptador `gatewayProvider` deshabilitado hasta tener contrato y llaves reales; no se simulan cobros. | — | 🔒 decisión |

## Quick wins (<2 h)
F-04, F-05, S-04, S-06, S-07, U-01, U-02, R-02, L-01, S-01 (acción del dueño), S-03 (acción del dueño), R-01 (credencial).

## Refactors estratégicos
F-01/F-02/F-03 (alta por suscripción, Fase 3), F-07 (empleados), F-09 (e-CF con ef2), D-01 (respaldos), migración a Next 16 (Next 15 llega a EOL el 21-oct-2026; PR separado).

## Conteo
🔴 6 (F-01, F-02, F-03, S-01, S-02, R-01) · 🟡 10 · 🟢 6 · ⚪ 5.
