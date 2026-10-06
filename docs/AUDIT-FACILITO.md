# AUDIT-FACILITO — Matriz de reconciliación (Fase 0, super prompt v2.0)

Fecha: 2026-10-05 · Rama: `chore/fase-0-auditoria` · Base: `main` @ `03fa51f` · Alcance: secciones 5 a 14 del prompt.
Complementa (no reemplaza) `docs/audit/2026-09-28-fase0.md` (hallazgos H-01…H-23) y `docs/tech-debt.md` (TD-001…TD-016).

**Leyenda.** EXISTE = implementado y con prueba o verificación en vivo · PARCIAL = existe con brechas · FALTA = no existe.
Confianza: **A** verificado en código y con prueba o petición real hoy · **M** leído en código, sin prueba dedicada · **B** inferido (ausencia en búsquedas).

---

## 1. Mapa del repositorio (§0.2)

| Pieza | Tecnología / ubicación |
|---|---|
| Gestor | pnpm 9.15.9 + Turborepo; Node 22.23.2 local |
| `apps/web` | Next 15.5.26 (App Router), React 19. Grupos: `(app)` panel, páginas públicas `catalogo`, `login`, `recuperar`, `restablecer`, `confirmar-correo` |
| `apps/api` | Fastify 5 + `pg` (Neon en producción) / PGlite (local y tests). Rutas en `apps/api/src/routes/*`, servicios en `src/services/*`, migraciones SQL en `apps/api/migrations/001…008` |
| `apps/mobile` | Expo 52 offline-first con outbox |
| `packages/*` | `domain` (dinero, factura, `formatNcf`), `verticals`, `copilot`, tipos compartidos |
| `services/ecf` | Motor e-CF desacoplado con contingencia; sin firma ni proveedor |
| CI | `.github/workflows/ci.yml`: typecheck → lint → tests → build → E2E → aislamiento → gitleaks → `pnpm audit --audit-level=high` |
| Despliegue | Vercel: proyecto web y proyecto API separados; Neon Postgres; migraciones manuales con `DATABASE_ADMIN_URL` |

**Rutas web del panel:** `/inicio`, `/ventas`, `/facturacion` (+`[id]`, `nueva`), `/inventario`, `/clientes`, `/proveedores`, `/reportes`, `/notificaciones`, `/configuracion`, `/admin`.

**Rutas API (`/v1`):** auth (`register`, `login`, `refresh`, `logout`, `forgot/reset-password`, `password`, `email-change`, `totp/*`, `switch-tenant`, `google`→501), `me`, `settings`, `settings/ncf`, `products` (+`import`, `categories`, `low-stock`, `kardex`, `adjust`, `image`), `inventory/*`, `counts`, `invoices` (+`pdf`, `void`, `pay`, `whatsapp`, `email`→501), `sales`, `customers`, `suppliers`, `reports/invoices`, `reports/606|607|608` (stub), `dashboard`, `notifications`, `search`, `audit`, `branches`, `investments/roi`, `copilot/ask`, `studio/content`, `verticals`, `public/catalog/:id`, `exports/products.csv`, `platform/*` (super admin).

**Variables de entorno — solo nombres.** En `.env.example`: `NODE_ENV, API_PORT, API_HOST, API_INTERNAL_URL, WEB_PUBLIC_URL, DATABASE_DRIVER, PGLITE_DATA_DIR, AUTO_MIGRATE, DATABASE_URL, APP_DATABASE_URL, DATABASE_POOL_MAX, DATABASE_ADMIN_URL, APP_DB_PASSWORD, REDIS_URL, JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY_PATH, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_ACCESS_TTL_SECONDS, JWT_REFRESH_TTL_SECONDS, COOKIE_SECURE, COOKIE_PATH, FIELD_ENCRYPTION_KEY, CORS_ORIGINS, TRUST_PROXY, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, AUTH_REFRESH_RATE_LIMIT_MAX, LOGIN_MAX_FAILURES, LOGIN_LOCK_SECONDS, UPLOAD_DIR, UPLOAD_MAX_BYTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_REPLY_TO, APP_PUBLIC_URL, LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, COPILOT_SERVICE_URL, ECF_SERVICE_URL, PSFE_PROVIDER, PSFE_BASE_URL, PSFE_API_KEY, FEATURE_INSTAGRAM_OAUTH_ENABLED, META_APP_ID, META_APP_SECRET, META_GRAPH_API_VERSION, CLAMAV_HOST, CLAMAV_PORT, FEATURE_ECF_ENABLED, FEATURE_COPILOT_ENABLED`.
Usadas en código pero **ausentes** de `.env.example`: `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD` (`apps/api/src/db/provision-platform-admin.ts`), `NEXT_PUBLIC_SUPPORT_URL` (`apps/web`), `DATABASE_URL_UNPOOLED` (presente en Vercel).

## 2. Versiones y fin de soporte (§0.3) — verificado en vivo el 2026-10-05

| Componente | Repo | Estado | Acción |
|---|---|---|---|
| Next.js | 15.5.26 | 15.x en Maintenance LTS hasta **21-oct-2026**. **15.5.27** (30-sep-2026) corrige 1 vulnerabilidad crítica y 1 alta | **P0 Fase 1:** subir a 15.5.27 ya; planificar Next 16 (Active LTS, 16.3.x) antes del 21-oct |
| Node.js | 22.x | Maintenance, EOL 30-abr-2027; 24 es Active LTS | Migrar a 24 en 2026-Q4/2027-Q1 |
| React | 19 | Vigente | — |
| Expo | 52 | Legado (vigentes SDK 55–57) | Plan de actualización en Fase 5 |
| `pnpm audit --audit-level=high` | — | 0 abiertas (2 altas ignoradas por config documentada, 1 moderada `sprintf-js` en mobile) | Revisar ignoradas con fecha y dueño (Fase 1) |

## 3. Línea base (§0.5) — ejecutada hoy

| Paso | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK |
| `turbo typecheck lint test --force` | 27/27 tareas OK |
| Pruebas | 207 antes de esta fase (api 136, domain 56, verticals 6, mobile 1, ecf 4, copilot 4) + 3 de caracterización nuevas |
| Build | 8/8 OK; First Load JS compartido 103 kB |
| Gitleaks | Sin fugas |
| Cobertura | **No medida** (no hay reporte de cobertura configurado) — PARCIAL |
| Fallos preexistentes | Ninguno en la línea base |

## 4. Producción verificada con peticiones reales (hoy)
- `/` → 307 a `/inicio`; `/inicio` 200 con `noindex, nofollow` y contenido inicial "Cargando".
- `/robots.txt`, `/sitemap.xml`, `/precios`, `/manifest.webmanifest` → **404**.
- Cabeceras web: CSP con nonce, HSTS 2 años con preload, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, COOP, **`Permissions-Policy: camera=()`** (bloquea el escáner de código de barras de la web, `apps/web/next.config.ts:10`).
- API: health OK, CSP + HSTS + Permissions-Policy; peticiones anónimas al panel de plataforma → 401.

---

## 5. Matriz

### §5 — Fase 0
| Ítem | Estado | Evidencia | Conf. |
|---|---|---|---|
| 0.1 Rama `chore/fase-0-auditoria`; tag `pre-facilito-v2` | PARCIAL | Rama creada; el tag espera autorización del dueño | A |
| 0.2 Mapa del repo y nombres de variables | EXISTE | Sección 1 de este documento | A |
| 0.3 Versiones y EOL | EXISTE | Sección 2 | A |
| 0.4 Esta matriz | EXISTE | Este archivo | A |
| 0.5 Línea base | EXISTE | Sección 3 | A |
| 0.6 Pruebas de caracterización | EXISTE | Ya cubiertos: `invoice.int.test.ts` (factura→stock→anulación, NCF, PDF, reportes), `sales.int.test.ts`, `inventory.int.test.ts`. Nuevo: `characterization.int.test.ts` (200 emisiones concurrentes, estado actual de 606/607/608) | A |
| 0.7 Benchmark | EXISTE | `docs/BENCHMARK.md` (sin capturas; "Cabal" no identificado) | M |
| 0.8 ADR ruta fiscal | EXISTE | `docs/adr/011-ecf-fiscal-route.md` (la carpeta del repo es `docs/adr/` en minúsculas) | A |
| 0.9 `.env.example` / `.gitignore` | PARCIAL | `.gitignore` cubre `.env`, `.env.*`, `*.pem`, `*.key`, `secrets`. Faltantes en `.env.example` listados en sección 1 y en §12 | A |

### §6 — Fase 1, seguridad
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| 1.1 JWT asimétrico con expiración corta | EXISTE | RS256, `JWT_ACCESS_TTL_SECONDS`; ADR-009/010 | A |
| 1.1 Refresh rotativo con detección de reuso | EXISTE | `auth.service.ts:306` (el reuso revoca la familia) | A |
| 1.1 Argon2id | EXISTE | `auth.service.ts` | A |
| 1.1 Cookies HttpOnly/Secure/SameSite; nada en localStorage | EXISTE | `fc_rt` HttpOnly SameSite=Strict (ADR-010); localStorage solo guarda ids de notificaciones leídas (`notifications.tsx:36`) | A |
| 1.1 Verificación de email al registrarse | **FALTA** | Solo existe confirmación de *cambio* de email (`/v1/auth/email-change/confirm`); sin columna de verificación | A |
| 1.1 Recuperación con token de un solo uso | EXISTE | `forgot-password` / `reset-password` | M |
| 1.1 Mensajes que no revelan si la cuenta existe | EXISTE | `auth.int.test.ts` | M |
| 1.1 Login con Google | **FALTA** | `GET /v1/auth/google` → 501 | A |
| 1.1 Lista de sesiones activas con cierre remoto | **FALTA** | Sin endpoint; refresh tokens por familia en `identity.refresh_token` permiten construirlo | A |
| 1.2 Revocación: BD como verdad, Redis acelera, fallo cerrado | PARCIAL | La revocación vive en BD (correcto). Redis opcional (`utils/cache.ts`) y **sin `REDIS_URL` en producción** (H-10): rate limit en memoria por instancia serverless | M |
| 1.3 Máx. 5 intentos, bloqueo progresivo, por IP y por cuenta | PARCIAL | Bloqueo por cuenta (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_SECONDS`, `auth.service.ts:251`); bloqueo fijo, no exponencial | M |
| 1.3 Claves IPv6 y proxy confiable antes de la seguridad | EXISTE | `trustProxy` por saltos (`app.ts:27`, ADR-010) | M |
| 1.4 RBAC en una capa reutilizable, rol nunca del cliente | EXISTE | `requireRole` + constantes `ROLES_*`; rol derivado del token y revalidado en BD | A |
| 1.4 Matriz RBAC de §12 | PARCIAL | Roles reales: owner, manager, cashier, warehouse, accountant, viewer (`packages/domain/src/types.ts:7`) — superconjunto del prompt. Diferencias: anulación por cajero "con aprobación" no existe (hoy no puede anular); compras/gastos no existen | A |
| 1.5 Aislamiento multi-tenant probado | EXISTE | RLS FORCE + rol `facilito_app` NOBYPASSRLS; `isolation.test.ts`, `isolation-contract.test.ts`, `db-rls.test.ts` en CI con Postgres real | A |
| 1.6 Validación zod, SQL parametrizado, magic bytes | EXISTE | Zod `.strict()` en rutas; `upload-guard.test.ts` | A |
| 1.7 CSRF / origen | EXISTE | SameSite=Strict + CORS con allowlist + cabecera `x-facilito-csrf` (`app.ts:40-48`) | M |
| 1.8 Cabeceras en producción | PARCIAL | Todas presentes (sección 4); `Permissions-Policy: camera=()` rompe el escáner web | A |
| 1.9 NCF atómico; 200 emisiones = 200 números consecutivos | EXISTE | `invoice.service.ts:307`; **probado hoy** en `characterization.int.test.ts` (200/200 únicos y sin saltos) | A |
| 1.9 Registro append-only de comprobantes | PARCIAL | Bitácora con cadena de hashes (`migrations/001_sprint0.sql`); la factura emitida aún no es inmutable a nivel BD (H-02) | M |
| 1.10 Auditoría de dependencias, 0 críticas/altas | EXISTE | `pnpm audit` en CI, 0 abiertas | A |
| 1.10 Dependabot | **FALTA** | No hay `.github/dependabot.yml` | A |
| 1.10 Actions fijadas por SHA | **FALTA** | `ci.yml` usa `@v4`/`@v2` | A |
| 1.10 Escaneo de secretos en CI | EXISTE | gitleaks + `.gitleaksignore` con huellas justificadas | A |
| 1.11 Logs sin secretos, con id de solicitud/tenant/usuario | PARCIAL | Redacta `authorization`, `cookie`, `set-cookie` (`app.ts:24`); no redacta cuerpos (`password`, `totp`) por campo; tenant/usuario no están en cada línea | M |
| 1.12 Errores sin stack traces | EXISTE | Problem+JSON (`type/title/detail/code`) | A |
| 1.13 Secretos expuestos en el repo | EXISTE (ninguno) | Gitleaks limpio; la contraseña del super admin nunca se escribió en el repo | A |

### §7 — Fase 2, fiscal
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| 2.1 Adaptador de proveedor fiscal | PARCIAL | `services/ecf` desacoplado + `PSFE_*` en `.env.example`; sin proveedor real (ADR-011) | A |
| 2.2 Tipos E31…E47 | **FALTA** | Solo NCF `B01`/`B02` (`formatNcf`, padding de 8) | A |
| 2.3 Flujo de emisión con firma, TrackId y QR | **FALTA** | Sin XMLDSig, sin QR (`invoice-pdf.ts:166` marca TODO), sin código de seguridad | A |
| 2.4 Contingencia | PARCIAL | Cola de contingencia en `services/ecf/src/engine.ts` (con prueba); no conectada al panel | M |
| 2.5 Cola/cron de reintentos con DLQ | **FALTA** | — | B |
| 2.6 Reportes 606/607/608 correctos | **FALTA** | Stub fijado por prueba (`legacy.routes.ts:180`) | A |
| 2.7 Configuración fiscal en el panel | PARCIAL | Secuencias NCF con rangos, vencimiento y anti-reuso (`/v1/settings/ncf`); sin modalidad e-CF, certificado ni alertas de agotamiento | A |
| 2.8 Pruebas por tipo de comprobante + 200 concurrentes | PARCIAL | 200 concurrentes ✔; casos por tipo e-CF no existen | A |
| 2.9 `docs/FISCAL.md` y no afirmar certificación | PARCIAL | No existe `docs/FISCAL.md`; el código no afirma certificación | M |
| Compras y gastos | **FALTA** | Sin tablas ni endpoints (solo el motivo `compra` en movimientos de inventario) | A |

### §8 — Fase 3, responsive y experiencia
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| 3.1 QA visual en 6 breakpoints | **FALTA** (sin evidencia) | No hay capturas ni pruebas visuales | B |
| 3.3 Skeletons y estados vacíos | PARCIAL | Presentes en varias vistas; no auditados uno a uno | B |
| 3.4 Logos `object-contain` | EXISTE | Verificado en la marca en fases previas | M |
| 3.5 Escáner con cámara real | PARCIAL | `product-picker.tsx`, `product-form.tsx`; **bloqueado en web por `camera=()`**; no probado en móvil físico | A |
| 3.7 Navegación inferior en móvil | **FALTA** | Sin componente de barra inferior | B |
| 3.8 `prefers-reduced-motion` | EXISTE | `apps/web/src/app/globals.css` | M |
| 3.9 PWA (manifest, instalación, offline web) | **FALTA** | `/manifest.webmanifest` 404 | A |

### §9 — Fase 4, sitio público
| Ítem | Estado | Evidencia | Conf. |
|---|---|---|---|
| 4.1 `/`, `/funciones`, `/como-funciona`, `/precios`, `/e-cf`, `/contadores`, `/faq`, `/contacto`, `/estado`, `/legal/*` | **FALTA** | `/` redirige a `/inicio`; `/precios` 404 | A |
| 4.2 Metadatos, OG, datos estructurados, sitemap, robots | **FALTA** | `robots.txt` y `sitemap.xml` 404 | A |
| 4.3 i18n (es-DO base, en-US preparado) | **FALTA** | Sin librería ni textos externalizados | B |
| 4.4 Contenido inicial SSR en vez de "Cargando" | **FALTA** | `/inicio` sirve "Cargando" | A |

### §10 — Fase 5, panel self-service y módulos
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| 5.1 Registro y onboarding | PARCIAL | Registro con perfil y vertical; sin verificación de email ni Google | A |
| 5.2 Perfil de negocio adaptable | PARCIAL | Verticales colmado/ferretería/farmacia (`/v1/verticals`); faltan los demás preestablecidos | M |
| Administración: usuarios e invitaciones | **FALTA** | **No hay endpoints para invitar o gestionar empleados**; los roles solo se asignan por BD (los tests usan `addStaff` directo a BD) | A |
| Administración: sucursales | PARCIAL | `POST /v1/branches`; stock por sucursal no expuesto en el panel | M |
| Ventas: POS, facturas, cobros, PDF, WhatsApp | PARCIAL | Facturas, cobro de crédito, PDF y WhatsApp ✔; email → 501; sin cotizaciones ni notas de crédito/débito; PDF sin QR | A |
| Catálogo: categorías, imágenes, códigos de barra, importación | EXISTE | `/v1/products/*` incl. `import` y `categories`; variantes no | A |
| Inventario: entradas, ajustes, alertas de mínimo, trazabilidad | EXISTE | `adjust`, `kardex`, `low-stock`, `inventory/movements` | A |
| Conteo físico + cierre de caja por turno | PARCIAL | Conteos con aprobación (`/v1/counts`); sin cierre de caja | A |
| Aseguramiento / Inversión | PARCIAL | `investments/roi`; aseguramiento sin UI dedicada | M |
| Clientes y proveedores | EXISTE | `/v1/customers`, `/v1/suppliers`; sin estados de cuenta | A |
| Reportes exportables | PARCIAL | Ventas en JSON/CSV/PDF; 606/607/608 stub; sin filtros guardados | A |
| 5.4 Tablero | PARCIAL | `/v1/dashboard`; faltan alertas de certificado y envíos rechazados (dependen de e-CF) | M |
| 5.5 Exportación completa del negocio | PARCIAL | Solo `exports/products.csv` | A |
| 5.6 `docs/ONBOARDING.md` | **FALTA** | — | A |

### §11 — Fase 6, Centro de Mando
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| 6.1 Super Admin por proceso controlado, nunca por registro público | EXISTE | `provision-platform-admin.ts` (variables de entorno), migración 008, `requirePlatformAdmin` | A |
| 6.1 MFA obligatorio, step-up, alerta de login, cuenta break-glass | **FALTA** | El admin entra solo con contraseña; TOTP existe pero no se exige | A |
| 6.1 `/admin` fuera del panel de negocio | PARCIAL | `/admin` está dentro del grupo `(app)` con la misma sesión | A |
| 6.2 Auditoría inmutable de cada acción | PARCIAL | Bloqueo/desbloqueo/suspensión escriben bitácora (`/v1/platform/activity`); falta "antes/después" y exportación | M |
| 6.3 Resumen, negocios, usuarios | PARCIAL | Stats, listas, bloquear/habilitar, suspender/reactivar ✔ (PRs #4/#5 en producción); sin forzar cierre de sesión, planes, fiscal, salud, respaldos, soporte, banderas, mantenimiento | A |
| 6.4 Suplantación controlada | **FALTA** | — | A |
| 6.6 Pruebas de acceso denegado | PARCIAL | `platform.int.test.ts` (no-admin → 403, anónimo → 401); MFA/step-up no aplican aún | A |

### §12 — Referencia transversal
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| Roles y matriz RBAC | PARCIAL | Ver §6 1.4 | A |
| Mapa de rutas | PARCIAL | Panel usa `/facturacion`, `/configuracion`, `/login` en vez de `/facturas`, `/ajustes`, `/entrar`: se añadirán redirecciones, sin romper enlaces. Faltan `/registro`, `/verificar-email`, `/compras`, `/fiscal`, `/conteo`, `/ayuda` | A |
| Variables §12 | PARCIAL | Equivalentes existentes: `JWT_*` ≈ `AUTH_JWT_*`, `PSFE_*` ≈ `FISCAL_PROVIDER*`, `MAIL_FROM` ≈ `EMAIL_FROM`, `APP_PUBLIC_URL` ≈ `APP_URL`. **Faltan:** `DATABASE_URL_UNPOOLED`, `AUTH_COOKIE_DOMAIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `FISCAL_ENV`, `CERT_ENCRYPTION_KEY`, `BILLING_PROVIDER`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`, `EMAIL_API_KEY`, `WHATSAPP_API_TOKEN`, `SUPERADMIN_BOOTSTRAP_EMAIL` (hoy `PLATFORM_ADMIN_EMAIL`), `NEXT_PUBLIC_APP_URL`, `SENTRY_DSN`, `BACKUP_STORAGE_URL`, `BACKUP_ENCRYPTION_KEY` | A |
| i18n, moneda, zona horaria | PARCIAL | Dinero entero con `Money` (ADR-005); textos no externalizados | M |

### §13 — Fases 7, 8 y 9
| Ítem | Estado | Evidencia / brecha | Conf. |
|---|---|---|---|
| 7.1–7.4 Backups diarios, copia propia cifrada, RPO/RTO, ensayo de restauración | **FALTA** (sin evidencia) | Solo el PITR propio de Neon según plan; sin respaldo propio ni acta de restauración | B |
| 7.5 Bitácora inmutable | PARCIAL | Cadena de hashes ✔; consultas de factura no se registran | M |
| 7.6 Migraciones expand/contract con reversa | PARCIAL | SQL versionado; sin scripts de reversa | M |
| 8.x Cobros, límites por plan, contadores | **FALTA** | Sin adaptador de cobros ni planes | A |
| 8.8 Plan de Vercel apto para uso comercial | Sin verificar | Requiere revisar el plan de la cuenta | B |
| 9.1 Observabilidad (logs estructurados, métricas, trazas) | PARCIAL | Logs pino estructurados; sin métricas ni trazas; Sentry no instalado (requiere confirmación) | M |
| 9.3 Página `/estado` | **FALTA** | — | A |
| 9.4 Runbooks | **FALTA** | No existe `docs/runbooks/` | A |
| 9.5 E2E de flujos críticos | PARCIAL | E2E en CI de venta/inventario; faltan registro→primera factura→reporte y Centro de Mando | M |
| 15.1 `main` protegida | Sin verificar | Requiere revisar la configuración de GitHub | B |
| 15.3 CI con acciones por SHA | PARCIAL | Ver §6 1.10 | A |

### §14 — Formato de reporte
| Ítem | Estado | Evidencia |
|---|---|---|
| Reporte por fase con estados y marcador | EXISTE | Se entrega al cerrar esta fase |

---

## 6. Prioridades para las fases siguientes

**P0 (antes del 21-oct / 15-nov-2026)**
1. Next 15.5.27 (CVE crítico) y plan de Next 16 antes del 21-oct.
2. Ruta e-CF (ADR-011): adaptador de proveedor + E31/E32/E34.
3. Reportes 606/607/608 reales; compras y gastos.
4. MFA obligatorio para el Super Admin.
5. Gestión de empleados (invitar, asignar rol, revocar) — hoy imposible sin BD.

**P1**
- Redis en producción (H-10); bloqueo progresivo de login.
- `Permissions-Policy: camera=(self)` para el escáner web.
- Dependabot y acciones fijadas por SHA.
- Verificación de email, Google, lista de sesiones.
- Sitio público, robots, sitemap y precios.
- Backups propios con ensayo de restauración.

**Sin cambios de comportamiento en esta fase.** Las brechas se corrigen en la fase indicada, cada una con su prueba de regresión.
