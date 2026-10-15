# Mantenimiento del sitio público

## Qué puede cambiar el equipo sin tocar código de auth

- Textos: `apps/web/src/content/copy.es.ts`, `features.ts`, `pricing.ts`.
- Precios: `content/pricing.ts`. Poner `PRICES_CONFIRMED = true` solo cuando la oferta sea real y quitar el aviso. Hoy debe seguir en `false`.
- Marca pública: `apps/web/src/lib/site.ts` y las variables de abajo.
- Video: cuando exista `Fondofacilito.mp4` y ffmpeg, `node scripts/build-hero-video.mjs <ruta>`. Los loops tienen que llamarse `facilito-hero-1080-loop.mp4`, `facilito-hero-720-loop.mp4` y, si se puede, `facilito-hero-1080-loop.webm` dentro de `apps/web/public/media/`. No copies el original a `public/`. El componente monta el video solo si esos mp4 existen.

## Variables

Ver `.env.example`.

- `NEXT_PUBLIC_SITE_URL` — origen canónico (metadata, sitemap, robots).
- `NEXT_PUBLIC_CONTACT_EMAIL` — mailto. Vacío lo oculta.
- `NEXT_PUBLIC_WHATSAPP_E164` — dígitos con código de país. Vacío oculta WhatsApp.
- `CONTACT_TO_EMAIL` — buzón que recibe el formulario. Si falta, usa `MAIL_REPLY_TO` y luego `SMTP_USER`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — los mismos nombres que la API. Tienen que estar en el entorno del proceso Next, no solo en el de la API.
- `CONTACT_DELIVERY=sink` — solo pruebas. En producción no se define.

## Dominio

Cuando exista el dominio propio, `NEXT_PUBLIC_SITE_URL=https://facilito.do` (o el que se compre). En Vercel, redirige los hosts viejos (`facilitord.vercel.app`, `facilito-tau.vercel.app`) al canónico con una redirección 308 de dominio. No se hizo aquí: no hay proyecto de Vercel modificado en este turno.

## Legal

`/legal/privacidad`, `/legal/terminos` y `/legal/cookies` son borradores del 7 de octubre de 2026 alineados con la Ley 172-13 en lo que el código hace hoy. **Un asesor legal tiene que revisarlos antes del lanzamiento.** No son asesoría.

## Next.js 16

`npm view next version` el 7 oct 2026 devolvió 16.4.0. Este repo está en 15.5.27. El soporte de la línea 15 termina el **21 de octubre de 2026**. La migración (`npx @next/codemod@canary upgrade latest`) es un commit aparte, después de que build y e2e de auth queden verdes. No se hizo en esta rama.

## Auth

No cambies `src/lib/auth.tsx`, cookies, callbacks ni validaciones del login para “mejorar” el sitio. No hay registro público: una cuenta nace en `/suscribirme` (plan, datos y comprobante de transferencia), un administrador la autoriza en `/admin` y el dueño crea su contraseña en `/activar` con el enlace de un solo uso. `/register`, `/registro`, `/signup` y `/onboarding` responden 301 a `/suscribirme`.

### Pruebas sin registro

E2E, `scripts/e2e-api-smoke.mjs` y `scripts/lighthouse-authed.mjs` crean dueños por ese mismo flujo (`scripts/lib/e2e-accounts.mjs`). Playwright arranca la API con datos bancarios de prueba y un administrador E2E sin 2FA (`E2E_PLATFORM_ADMIN_*`, rechazado en producción); el setup global le enrola un TOTP nuevo en cada corrida. Si reutilizas una API ya levantada, arráncala con esas mismas variables. Los scripts se niegan a correr contra un host que no sea local porque cada autorización registra un cobro en el ledger.

## Respaldos (D-01)

Objetivo propuesto, a confirmar por el dueño: **RPO 24 h** (como mucho se pierde un día) y **RTO 4 h** (en cuatro horas el servicio vuelve con datos). Hoy no hay ensayo de restauración registrado: el objetivo no está demostrado.

1. **PITR de Neon (primera línea).** Neon guarda el historial de la rama según el plan (ventana de restauración: TODO: VERIFICAR EN VIVO en la consola de Neon del proyecto). Para recuperar sin tocar producción: crea una rama Neon desde un instante anterior, apunta un preview a esa rama, verifica y solo entonces decide.
2. **Copia propia cifrada (segunda línea, fuera de Neon).** Diaria, con un `pg_dump` de la misma versión mayor que Postgres:
   `pg_dump --format=custom --no-owner --file=facilito-AAAAMMDD.dump "$DATABASE_ADMIN_URL"`, cifrada antes de salir de la máquina (`age -r <clave-pública>` o `gpg --symmetric`) y guardada en un bucket con versionado y retención mínima de 30 días. La clave de cifrado no se guarda junto a los respaldos. Nunca subas un dump sin cifrar: contiene RNC, cédulas y datos fiscales.
3. **Ensayo de restauración (mensual).** Restaura el último dump en una rama Neon vacía con `pg_restore --no-owner --dbname "$URL_RAMA_PRUEBA" facilito-AAAAMMDD.dump`, corre `pnpm --filter @facilito/api migrate` contra ella (debe decir que no hay migraciones pendientes) y compara conteos de `app.factura`, `app.producto`, `billing.pago` y `audit.bitacora` con producción. Anota fecha, duración real y resultado; esa duración es el RTO medido.

Los datos fiscales y el ledger son de solo inserción: un respaldo nunca se usa para «limpiar» comprobantes. Restaurar sobre producción requiere confirmación expresa del dueño.

### Recuperar el 2FA de un administrador

Si un administrador pierde el teléfono: `PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_PASSWORD=<nueva> PLATFORM_ADMIN_RESET_TOTP=1 pnpm --filter @facilito/api platform:admin` con `DATABASE_ADMIN_URL`. Quita el segundo factor, cambia la contraseña y cierra todas sus sesiones; al entrar, el panel le pide enrolar un autenticador nuevo. No existe vía HTTP para esto a propósito.
