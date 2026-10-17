# Decisiones pendientes — Facilito

Estado al 12 oct 2026, rama `audit/facilito-prod-ready`. Cada punto dice qué está implementado, qué falta decidir y quién lo decide. Nada de esta lista se simula en producción.

## Bloqueantes para cobrar

| # | Decisión | Estado en el código | Qué hace falta |
|---|---|---|---|
| D-01 | **Precios e ITBIS** | Planes sembrados en `migrations/009` en centavos DOP: Inicial 69 000 (RD$690), Profesional 149 000, Negocio 249 000. El checkout (`/suscribirme`) los lee de `billing.plan` vía API. La landing de marketing vive en `facilitord-web`. Los precios se muestran sin desglose de ITBIS. | El dueño confirma montos y si incluyen ITBIS 18 %. Un asesor fiscal confirma si la suscripción debe facturarse con NCF/e-CF. TODO: VERIFICAR EN VIVO. Cambiar precios = `UPDATE billing.plan` (no migración destructiva). |
| D-02 | **Cuenta bancaria para transferencias** | `BILLING_BANK_*` vacías ⇒ el checkout responde 503 `billing_unavailable` y la UI lo explica. No hay datos bancarios inventados. | El dueño entrega banco, número, tipo, titular y RNC/cédula; se cargan como variables en Vercel (proyecto de la API). |
| D-03 | **Correo saliente (SMTP)** | Sin `SMTP_*` las invitaciones no salen por correo: el admin recibe el enlace de activación y lo comparte por WhatsApp desde el panel. Recuperar contraseña no funciona sin SMTP. | Contraseña de aplicación de Gmail (con 2FA de Google) o proveedor transaccional. Para un dominio propio: registros SPF, DKIM y DMARC en el DNS del dominio (TODO: VERIFICAR EN VIVO con el proveedor elegido). |
| D-04 | **Pasarela de tarjeta en RD** | Desactivada (`metodos.tarjeta = false`). Existe la abstracción `PaymentProvider` y un webhook firmado (HMAC `x-facilito-signature`, idempotente, tolera eventos fuera de orden) que queda cerrado (404) sin `BILLING_WEBHOOK_SECRET`. | NO VERIFICADO qué pasarela da servicio a este negocio en RD (Azul, CardNet, PayPal u otra) y con qué comisión. Requiere contrato del dueño; no se aceptaron términos de terceros. |

## Legales y operativas

| # | Decisión | Estado | Qué hace falta |
|---|---|---|---|
| D-05 | **Términos y privacidad** | Se añadieron secciones de cuenta, pago, gracia, solo lectura, cancelación, retención del ledger y aviso de que el recibo no es comprobante fiscal. | Revisión por un abogado en RD (Ley 172-13 de datos personales, Ley 358-05 de protección al consumidor). TODO: VERIFICAR EN VIVO. |
| D-06 | **Reembolso al rechazar** | El texto de rechazo promete devolver la transferencia. El sistema no mueve dinero: el admin registra el reembolso manual en el ledger (asiento inmutable). | El dueño fija plazo y medio de devolución; se publica en términos. |
| D-07 | **Recuperación de 2FA de un admin** | `PLATFORM_ADMIN_RESET_TOTP=1 pnpm --filter @facilito/api platform:admin` quita el segundo factor, cambia la contraseña y cierra sesiones. Solo con `DATABASE_ADMIN_URL`; no existe vía HTTP. | Definir quién custodia `DATABASE_ADMIN_URL` y dejar un segundo admin con 2FA como respaldo. |
| D-08 | **Contraseña del super admin** | La cuenta creada antes tiene una contraseña débil compartida por chat. | Rotarla (mismo comando de aprovisionamiento) y enrolar 2FA en el primer ingreso: el panel ya lo exige. |
| D-09 | **Redis en producción** | Sin `REDIS_URL` los bloqueos de login, límites y la protección anti-replay de TOTP viven en memoria por instancia (Vercel puede tener varias). | Upstash u otro Redis administrado. Riesgo aceptado mientras haya poco tráfico. |
| D-10 | **Monitoreo** | Sin Sentry ni similar (no se instaló sin confirmación). `/health` de la API y la pestaña Salud del panel cubren el estado básico. | Elegir herramienta y presupuesto. |

## Hallazgos cerrados como falso positivo

- **S-07 `Permissions-Policy: camera=()`**: la web no usa `getUserMedia`; el lector de código de barras es un escáner USB que actúa como teclado. Se mantiene `camera=()`, que es lo más restrictivo.
