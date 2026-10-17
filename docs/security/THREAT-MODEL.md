# Threat model corto — Facilito

Alcance: app web + API (checkout transferencia, panel, admin). Fuera: marketing `facilitord-web`, Expo POS, pasarela tarjeta.

## Activos

- Credenciales y sesiones (refresh HttpOnly).
- Datos de negocio (facturas, inventario, RNC).
- Ledger de pagos y comprobantes.
- Cola de autorización (platform admin).

## Actores

| Actor | Objetivo |
|---|---|
| Anónimo | Ver planes, iniciar checkout, subir comprobante con token |
| Dueño / staff | Operar negocio dentro del tenant |
| Platform admin | Autorizar/rechazar, finanzas |
| Atacante | Cuenta ajena, fuga cross-tenant, fraude de pago, DoS |

## Amenazas → mitigaciones

| Amenaza | Mitigación |
|---|---|
| Credential stuffing | Rate limit + lockout + Argon2id |
| Session theft (XSS) | HttpOnly refresh, CSP nonce, sin token en `document.cookie` |
| IDOR solicitud | `acceso_token_hash` + header `x-solicitud-token` |
| Cross-tenant read/write | RLS `FORCE` + `withTenant` |
| Checkout duplicado | Unique email/RNC abiertos + `Idempotency-Key` → `proveedor_ref` |
| Comprobante malicioso | Sanitize mime/size/PDF + opcional ClamAV |
| Webhook forjado | HMAC `x-facilito-signature`; cerrado sin secret |
| Admin abuse | TOTP platform + audit `platform_log` append-only |
| Preview → prod data | S-01: DB distinta en Preview |

## Residual / 🔒

- SMTP real y cuenta bancaria: secretos del dueño.
- Tarjeta RD: D-04 contrato.
- Observabilidad Sentry: D-10.
- Restore drill medido: dueño Neon.
