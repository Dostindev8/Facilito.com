# Producción — billing y planes públicos

Checklist operativo para que `/suscribirme` muestre los tres planes. Sin secretos en este archivo.

## 1. `API_INTERNAL_URL` (proyecto Vercel **web**)

El rewrite de Next (`apps/web/next.config.ts`) bakea el destino en **build time**:

```
/api/:path*  →  ${API_INTERNAL_URL}/:path*
```

| Check | Valor |
|---|---|
| Nombre | `API_INTERNAL_URL` |
| Formato | `https://<host-api-facilito>` **sin** slash final |
| Entornos | Production **y** Preview (y Development si aplica) |
| Turbo | Ya listado en `turbo.json` → `env` del build web |

Si falta o apunta a `127.0.0.1:3001`, el navegador recibe error de red/proxy al pedir `/api/v1/billing/plans`.

Smoke tras redeploy web:

```bash
curl -sS -o - -w "\nHTTP:%{http_code}\n" "https://facilitord.vercel.app/api/v1/billing/plans"
```

Esperado: HTTP 200 y `items` con `inicial`, `profesional`, `negocio`.

## 2. Migración `009_billing_subscriptions.sql` (API / Neon)

La API en `DATABASE_DRIVER=pg` **no** auto-migra en cada request; hay que aplicar migraciones con el rol migrator.

1. Confirmar backup / punto de restauración Neon (ver `BACKUP-DR.md`).
2. Con `DATABASE_ADMIN_URL` en el entorno local seguro (si no existe, usar el connection string **unpooled/owner** de Neon, p. ej. el valor de `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` — nunca lo subas a git). Recomendado: guardar `DATABASE_ADMIN_URL` solo en Vercel Production del API para ops futuras (no en Preview).

```bash
# PowerShell ejemplo (tras `vercel env pull` al API, sin imprimir secretos):
# $env:DATABASE_ADMIN_URL = $env:DATABASE_URL_UNPOOLED
pnpm --filter @facilito/api migrate
```

3. Verificar:

```sql
SELECT id FROM app.schema_migrations WHERE id LIKE '009%';
SELECT id, activo, precio_mensual_centavos FROM billing.plan ORDER BY orden;
```

La migración 009 ya inserta los tres planes (`ON CONFLICT DO NOTHING`).

## 3. Re-sembrar planes (tabla vacía, sin migración destructiva)

Si `billing.plan` existe pero no hay filas activas (o alguien las desactivó por error):

- Como platform admin (Bearer + 2FA según el panel):

```http
POST /v1/platform/billing/plans/seed
Authorization: Bearer <access>
```

Respuesta: `{ inserted: number, total: number, items: [...] }`. Idempotente: no pisa precios existentes (`ON CONFLICT DO NOTHING`).

También visible en salud admin: `GET /v1/platform/health` → `baseDeDatos.planes`.

## 4. Variables relacionadas (recordatorio)

| Variable | Dónde | Si falta |
|---|---|---|
| `BILLING_BANK_*` | API | Checkout transferencia → 503 |
| `CRON_SECRET` | API | Sweep diario cerrado |
| `SMTP_*` / `MAIL_FROM` | API | Correos de activación no salen |
| `REDIS_URL` | API | Rate limit / caché en memoria (OK en single-instance; multi-instance peor) |
| `BILLING_WEBHOOK_SECRET` | API | Webhook tarjeta 404 (esperado sin pasarela) |

## 5. S-01 (seguridad)

No reutilizar la misma `DATABASE_URL` de producción en Vercel **Preview**. Preview debe apuntar a una rama Neon aparte.
