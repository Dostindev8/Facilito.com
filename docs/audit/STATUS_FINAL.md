# Facilito — Estado final de la auditoría y cierre a producción

Fecha: 14 oct 2026 · Rama `audit/facilito-prod-ready` (41 commits sobre `main`, 160 archivos) · PR [#8](https://github.com/Dostindev8/Facilito.com/pull/8).

## Veredicto

**Listo para merge en código; NO listo para producción.** El PR pasa todos los checks de CI y los previews de Vercel compilan. El despliegue a producción queda detenido por bloqueos externos (credenciales, migración 009, variables de entorno, precios), que no se resuelven desde el código y requieren confirmación del dueño.

## Evidencia (este cierre)

| Verificación | Resultado |
|---|---|
| CI `quality` en PR #8 (typecheck, lint, unit + integración, build, E2E, aislamiento, gitleaks, audit) | pass (7m17s), run 38665450882 |
| Vercel preview web y API | pass |
| API (Vitest + PGlite) | 190/190 |
| Dominio | 82/82 |
| Web unitarias | 14/14 |
| E2E Playwright | 43/43 |
| Smoke de API | 37/37 |
| Cobertura API / dominio (líneas) | 83,9 % / 94,7 % |
| Lighthouse móvil local, páginas públicas indexables | Perf 90–96, A11y/BP/SEO 100 |
| CLS | ≤ 0,003 en todas las rutas medidas |

El primer run de CI falló solo en gitleaks por un falso positivo (contraseña de prueba `OtraClave12345` en `billing.int.test.ts`). Se resolvió con una huella en `.gitleaksignore`, igual que los dos casos previos; no se reescribió historia.

Detalle de pruebas, cobertura y Lighthouse: `docs/audit/06-qa.md`. Hallazgos con su estado: `docs/audit/01-hallazgos.md`.

## Gates de producción pendientes

| Gate | Responsable | Estado |
|---|---|---|
| S-01: credenciales de la DB de producción presentes en Vercel Preview/Development | Dueño (Vercel) | Abierto 🔴 |
| Migración 009 en producción, previa rama de respaldo en Neon | Dueño confirma; se ejecuta con `pnpm --filter @facilito/api migrate` | Abierto |
| Variables de producción: `BILLING_BANK_*`, `CRON_SECRET`, `SMTP_*`, `REDIS_URL` | Dueño | Abierto (sin ellas el checkout responde 503 y los correos no salen) |
| Rotar la contraseña del super admin (D-08) | Dueño | Abierto |
| Confirmar precios e ITBIS (D-01) | Dueño + asesor fiscal | Abierto. TODO: VERIFICAR EN VIVO |
| PageSpeed sobre el preview (protegido por SSO de Vercel) | Dueño comparte acceso o desactiva protección | NO VERIFICADO |

## No verificado

- LCP < 2,5 s: la simulación móvil da ≈ 3,0–3,2 s; falta medición de campo.
- WebKit/Firefox, envío real de correo, ensayo de restauración de respaldo, cobro con tarjeta (deshabilitado), carga más allá de 200 emisiones concurrentes.
- Producción actual (`facilitord.vercel.app`) sirve el build anterior: `robots.txt` y `sitemap.xml` dan 404 hasta el despliegue.

## Pendiente opcional

- F-07: invitaciones de personal (único hallazgo de código abierto).
- Quitar la dependencia `motion`, ya sin uso (DECISIONS #22).
- Migrar a Next 16 antes del fin de soporte de Next 15 (21 oct 2026).
