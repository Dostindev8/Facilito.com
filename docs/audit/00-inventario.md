# 00 — Inventario y línea base (Fase 0)

Fecha: 2026-10-12 · Rama: `audit/facilito-prod-ready` @ `c850700` (incluye el sitio público del PR #7, aún sin mergear) · Producción: `https://facilitord.vercel.app` = `main` @ `1b4c671`.
Documentos previos que este inventario extiende: `docs/AUDIT-FACILITO.md` (matriz v2.0), `docs/audit/2026-09-28-fase0.md` (H-01…H-23), `docs/AUDIT_FASE0.md` y `docs/DECISIONS.md` (sitio público), `docs/tech-debt.md`.

## 0. Estado del árbol de trabajo al empezar (incidente)

Al abrir la sesión, el árbol de trabajo estaba en `feat/website-3ds` y en un estado mixto que **no compilaba**:
- 10 archivos rastreados (`package.json`, `apps/web/package.json`, `next.config.ts`, `layout.tsx`, `middleware.ts`, `globals.css`, `not-found.tsx`, `.env.example`, `e2e/playwright.config.ts`, `apps/mobile/tsconfig.json`) tenían el contenido **anterior** al sitio público. Faltaban `motion`, `lenis` y los overrides de `sharp`, y había resucitado `app/page.tsx`, que choca con `(marketing)/page.tsx` en `/`.
- 4 archivos de cobros sin commitear (`009_billing_subscriptions.sql`, `billing-providers.ts`, `subscription.ts` y su test) habían perdido sus integraciones: `billing-providers.ts` usa `BILLING_*`, que no existe en `env.ts`.
- `git reflog` no registra ninguna operación a la hora de esas escrituras (todos los archivos con fecha 2026-10-12 21:20, en 27 s, con finales de línea LF), así que no las hizo git. Causa probable: una restauración externa (sincronización de OneDrive u otra herramienta). **No verificado.**

Acciones: respaldo íntegro en `%USERPROFILE%\facilito-wip-backup-2026-10-12` (patch + archivos), restauración de los 10 archivos a lo commiteado y avance rápido de `audit/facilito-prod-ready` hasta `c850700`. Los 4 archivos de cobros se reincorporan en la Fase 3. `apps/mobile/tsconfig.json` sigue como cambio local que no se commitea.

## 1. Stack real (leído del repo, no asumido)

| Pieza | Versión / detalle |
|---|---|
| Gestor | pnpm 9.15.9 + Turborepo; Node 22.x |
| Web | Next.js **15.5.27** (App Router), React 19, TypeScript 5.8, sin Tailwind (CSS propio + tokens en `packages/ui`) |
| API | Fastify 5, zod, `pg` (Neon) / PGlite (local y tests), argon2id, JWT RS256 (`jose`), `otplib`, `nodemailer` |
| Móvil | Expo 52 (legado) |
| Paquetes | `domain`, `ui`, `config`, `verticals`; servicios `services/ecf`, `services/copilot` |
| Base de datos | Postgres en Neon, RLS **FORCE** en todas las tablas de negocio, rol `facilito_app` NOBYPASSRLS |
| Hosting | Vercel: proyecto `facilito` (web) y `api-facilito` (API) |

Scripts raíz: `dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `test:isolation`. API: `dev`, `migrate`, `db:bootstrap`, `platform:admin`, `test`, `test:isolation`.

## 2. Línea base (ejecutada hoy sobre `c850700`)

| Paso | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK |
| `turbo typecheck lint test build --force` | **32/32 tareas OK**, 0 errores, **0 warnings** |
| Pruebas | **230**: api 139, domain 65, web 11, verticals 6, ecf 4, copilot 4, mobile 1 |
| Build web | 37 páginas generadas; First Load JS compartido **103 kB**; middleware 34.4 kB; `/` 159 kB, `/login` 128 kB, `/inventario` 138 kB |
| E2E Playwright | No ejecutado en la línea base local (requiere API + build en marcha); en CI pasa en el PR #7 |
| Cobertura | **No configurada** (no hay reporte) |

## 3. Mapa de rutas web

Leyenda: ✅ funciona · ⚠️ parcial · ❌ roto · 🕳️ vacío/placeholder. "Auth" = requiere sesión (guard en cliente, `AppShell`).

| Ruta | Estado | Auth / rol | Nota |
|---|---|---|---|
| `/` (marketing) | ✅ en rama / ❌ en producción | Pública | En producción aún redirige a `/inicio` (shell "Cargando", `noindex`) |
| `/features`, `/precios`, `/nosotros`, `/contacto`, `/legal/{terminos,privacidad,cookies}` | ✅ en rama | Pública | Precios **no confirmados** (USD 0/16/39); el contacto falla cerrado sin SMTP en web |
| `/login` | ⚠️ | Pública | Pestaña "Registrarse" (a eliminar); botón Google **muerto** (501) |
| `/register` | ⚠️ | — | Redirige a `/login?tab=registro` (a cambiar) |
| `/recuperar`, `/restablecer` | ⚠️ | Pública | Funcionan, pero **en producción no llega el correo** (falta `SMTP_PASS`) |
| `/confirmar-correo` | ⚠️ | Pública | Mismo problema de correo |
| `/catalogo` | ✅ | Pública | Catálogo SSR por negocio |
| `/inicio`, `/ventas`, `/facturacion` (+`[id]`, `nueva`), `/inventario`, `/clientes`, `/proveedores`, `/reportes`, `/notificaciones`, `/configuracion` | ✅ | Auth + rol | Guard en cliente; la API revalida rol y tenant en cada endpoint |
| `/admin` | ⚠️ | Admin de plataforma | Sin 2FA obligatorio; vive dentro de `(app)` |
| `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, OG images | ✅ en rama | Pública | **`NEXT_PUBLIC_SITE_URL` no existe en Vercel**: en producción apuntarían a `http://localhost:3000` |
| 404 / `error.tsx` | ✅ en rama | — | De marca |

## 4. Mapa de endpoints API (`/v1`)

| Grupo | Endpoints | Estado | Auth |
|---|---|---|---|
| Salud | `GET /health` | ✅ | Pública |
| Auth | `register` | ⚠️ a eliminar | Pública |
| Auth | `login`, `refresh`, `logout`, `switch-tenant`, `forgot-password`, `reset-password`, `password`, `email-change` (+`confirm`), `totp/setup`, `totp/verify`, `me` | ✅ (correo ⚠️ en producción) | Mixta |
| Auth | `GET auth/google` | 🕳️ 501 | Pública |
| Configuración | `settings`, `settings/ncf`, `access/pin` | ✅ | owner/manager |
| Catálogo e inventario | `products` (+`import`, `categories`, `low-stock`, `kardex`, `adjust`, `image`), `inventory/*`, `counts` (+`approve`), `exports/products.csv` | ✅ | Por rol |
| Ventas y facturas | `sales` (+`void`), `invoices` (+`pdf`, `void`, `pay`, `whatsapp`) | ✅ | Por rol |
| Ventas y facturas | `invoices/:id/email` | ⚠️ 501 sin proveedor de correo | Por rol |
| Terceros | `customers`, `suppliers` | ✅ | Por rol |
| Reportes | `reports/invoices` | ✅ | Por rol |
| Reportes | `reports/606`, `607`, `608` | 🕳️ stub | Por rol |
| Panel | `dashboard`, `notifications`, `search`, `audit` | ✅ | Por rol |
| Otros | `branches` | ⚠️ solo crear | owner/manager |
| Otros | `investments/roi`, `studio/content`, `verticals` | ✅ | Por rol |
| Otros | `copilot/ask` | ⚠️ LLM `stub` | Por rol |
| Público | `public/catalog/:id` | ✅ | Pública |
| Plataforma | `platform/stats`, `users` (+`block`/`unblock`), `businesses` (+`suspend`/`reactivate`), `activity` | ✅ (sin MFA) | Admin de plataforma |
| Gestión de empleados | — | ❌ no existe | — |
| Cobros y suscripciones | — | ❌ no existe en `main` | — |

## 5. Mapa de datos

- **Esquemas:** `identity`, `app`, `audit`, `vectors`.
- **Migraciones:** 8 (`001`–`008`); la `009_billing_subscriptions.sql` está sin aplicar ni commitear. Hay 22 índices declarados además de PK/UNIQUE.
- **Tablas:**
  - `identity`: `persona`, `refresh_token`, `password_reset`, `email_change`, `device`, `platform_admin`.
  - `app`: `negocio`, `acceso`, `sucursal`, `producto`, `lote`, `movimiento_inventario` (particionada), `factura`, `factura_linea`, `venta`, `cliente`, `proveedor`, `ncf_secuencia`, `comprobante_fiscal`, `secuencia`, `conteo`, `turno_caja`, `idempotency_key`, `contenido_studio`, `regla_copilot`, `copilot_approval_queue`, `isolation_probe`.
  - `audit`: `bitacora` (particionada, cadena de hashes), `platform_log`.
  - `vectors`: `embedding`.
- **Relaciones clave:**
  - `acceso` une `persona` con `negocio` y el rol.
  - Todas las tablas de negocio llevan `tenant_id` con política RLS por `app.tenant_id`.
  - La administración de plataforma pasa por `app.is_platform_admin()` (`SECURITY DEFINER`, con opt-in `app.platform`).
- **Migraciones pendientes en producción:** ninguna de `001`–`008`. La `009` se aplicará cuando el dueño lo autorice.

## 6. Integraciones (qué es real y qué es mock)

| Integración | Estado real |
|---|---|
| Pagos / suscripciones | **No existe en `main`.** Borrador de adaptador sin conectar (transferencia + pasarela firmada) |
| Correo | `nodemailer` SMTP implementado; **en producción no envía**: Vercel tiene `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` y `MAIL_FROM`, pero **no `SMTP_PASS`**. El proyecto web no tiene ninguna variable SMTP, así que el formulario de contacto falla cerrado |
| IA (Copilot) | `LLM_PROVIDER=stub`: respuestas simuladas, sin proveedor real |
| e-CF / DGII | `PSFE_PROVIDER=stub`, `FEATURE_ECF_ENABLED=false`; solo NCF heredado (ADR-011) |
| Validación RNC/cédula | Formato y dígito verificador local (`rncPlainSchema`); sin consulta en línea a la DGII |
| Storage | Imágenes de producto en Postgres (`bytea`); sin bucket externo |
| Analítica | Ninguna (decisión del sitio público) |
| Redis | Implementado con fallback a `Map()`; **no hay `REDIS_URL` en producción** |
| Observabilidad | Logs `pino` con redacción de cabeceras; sin Sentry ni métricas |

## 7. Variables de entorno (solo nombres)

**Usadas por el código y documentadas en `.env.example`:** ver `docs/AUDIT-FACILITO.md` §1.

**Usadas pero ausentes de `.env.example`:**
- `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_NAME`
- `NEXT_PUBLIC_SUPPORT_URL`
- `DATABASE_URL_UNPOOLED`

**Configuradas en Vercel — API (producción):**
- `APP_DATABASE_URL`, `APP_PUBLIC_URL`, `AUTO_MIGRATE`, `COOKIE_SECURE`, `CORS_ORIGINS`
- `DATABASE_DRIVER`, `DATABASE_POOL_MAX`, `FIELD_ENCRYPTION_KEY`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`
- `MAIL_FROM`, `NODE_ENV`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `TRUST_PROXY`
- Las de la integración de Neon: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`, `NEON_*`.

**Configuradas en Vercel — web:** solo `API_INTERNAL_URL`.

**Hallazgo de seguridad:** las variables de la integración de Neon (`DATABASE_URL`, `PGPASSWORD`, `POSTGRES_*`) están asignadas también a **Preview y Development**. Cualquier despliegue de vista previa recibe credenciales de dueño de la base de **producción**. No se modificó: cambiar variables de producción requiere tu confirmación. Ver `01-hallazgos.md` H-P01.

## 8. Producción observada (peticiones reales, hoy)

- `/` → 307 a `/inicio`.
- `/inicio` → 200 con `<meta name="robots" content="noindex, nofollow">` y el texto "Cargando".
- `/precios`, `/register`, `/registro`, `/robots.txt` → 404.
- `api-facilito.vercel.app/health` → 200.

**Diagnóstico de "Cargando tu negocio…":** `/inicio` es una página del panel (`'use client'` dentro de `(app)`). El HTML del servidor solo trae el shell; todo el contenido depende del cliente:
1. Se restaura la sesión con el refresh.
2. Se llama a `/v1/me`.
3. Se renderiza el panel o se redirige a `/login`.

Riesgos:
- Para un visitante anónimo la primera pintura es "Cargando" seguido de una redirección: mala percepción y nada indexable.
- Si la API tarda o falla, la pantalla depende del manejo de errores del `AppShell`.

El `noindex` es **intencional** en el panel (correcto) y es lo que se sirve en `/` solo porque `/` redirige al panel. El sitio público del PR #7 corrige esto: `/` pasa a ser la landing SSR indexable y el panel conserva `noindex`.

**Gate 0: cumplido.** Inventario completo y línea base registrada.
