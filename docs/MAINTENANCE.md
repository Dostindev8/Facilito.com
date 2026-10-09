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

No cambies `src/lib/auth.tsx`, cookies, callbacks ni validaciones del login para “mejorar” el sitio. El registro de verdad es `/login?tab=registro`.
