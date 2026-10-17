# Auditoría Fase 0 — Facilito website

Fecha: 7 de octubre de 2026. Comandos ejecutados en este turno. El workspace abierto (`Facilito-web`) estaba vacío. El frontend vive en el monorepo `C:\Users\UserGPC\OneDrive\Desktop\DS Projects\Projects2\Facilito`. El sitio se construyó ahí.

## 1. Estructura

Monorepo pnpm + Turbo. Frontend: `apps/web` (`@facilito/web`). API: `apps/api`. Móvil: `apps/mobile`. Paquetes: `packages/domain`, `packages/ui`, `packages/config`, `packages/verticals`. Servicios: `services/copilot`, `services/ecf`.

## 2. Next.js

Instalado: **15.5.27** (App Router, `src/app`, `next.config.ts`). `middleware.ts` sigue vigente (este repo no usa `proxy.ts`). Build de producción, sin Turbopack en el script. `npm view next version` el 7 oct 2026: **16.4.0**. La línea 15 pierde soporte el 21 oct 2026. La migración a 16 no se mezcló con este trabajo.

## 3. Estilos

No hay Tailwind. CSS global en `apps/web/src/app/globals.css` más tokens en `packages/ui/src/tokens.css`. Paleta real: verde `#0d855b` / `#0b7a53`, naranja `#f5871f`, tinta `#15233a`. El sitio nuevo reutiliza esas variables. Fuentes ya cargadas en el layout raíz: Poppins y Dancing Script (`next/font`, `display: swap`).

## 4. Auth

Propia, no NextAuth. JWT RS256 en la API, cookie httpOnly `fc_rt` (`COOKIE_PATH=/api/v1/auth`). El web llama `/api/v1/auth/*` por rewrite. Sesión en cliente: `src/lib/auth.tsx`. Rutas: `/login` (pestañas iniciar sesión y registro vía `?tab=registro`), `/recuperar`, `/restablecer`, `/confirmar-correo`. No existe `/register`; `/onboarding` ya redirige a `/login?tab=registro`. El botón «Continuar con Google» llama `/v1/auth/google` y, si falla, muestra que Google aún no está disponible. El middleware no protege rutas: el guard está en `AppShell` (cliente) y manda a `/login?next=`.

## 5. Ruta `/` y panel

Antes de este trabajo, `src/app/page.tsx` hacía `redirect('/inicio')`. El panel vive en el route group `(app)`: `/inicio`, `/ventas`, `/inventario`, `/facturacion`, `/clientes`, `/proveedores`, `/reportes`, `/configuracion`, `/notificaciones`, `/admin`. Público aparte: `/catalogo`, `/login`.

## 6. Módulos reales

Existen en el panel: ventas, inventario (ajustes, kardex, importación CSV), facturación (estados, PDF, anulación, secuencias de comprobantes en configuración), clientes, proveedores, reportes, roles (owner, manager, cashier, warehouse, accountant). e-CF: `FEATURE_ECF_ENABLED=false` y `PSFE_PROVIDER=stub`. Instagram: flag apagado. Copilot: flag encendido con `LLM_PROVIDER=stub`. El copy público no promete e-CF, Instagram ni IA.

Cifrado verificado: `encryptField` (AES-256-GCM) sobre RNC/cédula y secreto TOTP (`apps/api/src/utils/crypto.ts`).

## 7. Planes

No hay precios publicados en el código commiteado. `packages/domain/src/subscription.ts` está sin commitear y modela estados de suscripción, no tarifas. Los precios del sitio quedan marcados `CONFIRMAR PRECIOS` y con aviso visible.

## 8. Entorno (nombres)

Base de datos: `DATABASE_DRIVER` (pglite o pg), `DATABASE_URL`. Redis opcional: `REDIS_URL`. Correo: SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). No hay Resend ni analítica en el web. API interna: `API_INTERNAL_URL`.

## 9. Assets

`Fondofacilito.mp4` no está en el repo ni en `Downloads` (la ruta adjunta no existe en disco). ffmpeg no está instalado. Poster usado: el paisaje que ya sirve el login, copiado a `apps/web/public/media/facilito-hero-poster.webp` (97 524 bytes, 1024×727). Cielo muestreado con sharp: rgb(88, 183, 246) = `#58B7F6`. Logo: `public/brand/facilito-mark.png` (256) y `facilito-icon.png` (512). `apple-icon.png` copiado del icono 512. Maskable generado con padding sobre fondo verde.

## 10. Scripts y línea base de build

`apps/web`: `dev`, `build`, `start`, `typecheck` = `lint` = `tsc --noEmit`. El test del web era un echo. Build inicial de `next build` (antes de este sitio): exit 0, Next 15.5.27, todas las rutas dinámicas por `headers()` en el layout raíz (CSP nonce). `/login` First Load JS 128 kB. Shared 102 kB.

## 11. Git

Rama de partida: `audit/facilito-prod-ready`. Había cambios sin commitear en API, dominio y mobile (billing). No se tocaron. Rama de este trabajo: `feat/website-3ds`, creada desde ese HEAD.

## 12. Lighthouse móvil de `/login` (antes)

Medido con Lighthouse 12, headless Chrome, form-factor mobile, contra `next start` de la build previa:

| Perf | A11y | BP | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|
| 88 | 100 | 100 | 100 | 3,2 s | 0 | 240 ms |

INP no sale en laboratorio. El login no se rediseñó.
