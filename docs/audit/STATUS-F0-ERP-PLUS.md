# STATUS F0 — Facilito ERP+ (auditoría previa)

**Fecha:** 18 oct 2026 · **Rama objetivo:** `feat/erp-plus` (aún no creada; F0 sin código de producción)  
**Protocolo:** GOD-STACK-ING · Super Prompt ERP+ · **Compuerta:** esperar `OK F0` de Dostin

---

## ✅ COMPLETADO (solo lectura)

Auditoría del monorepo sin modificar producción. Mapa de rutas, API, migraciones, roles, tokens UI, matriz de brechas vs FactP/objetivo, deuda y plan de migraciones aditivas.

### Mapa web (sidebar actual — flat, sin grupos)

Fuente: `apps/web/src/components/shell/sidebar.tsx`

| Ítem | Ruta | Estado |
|---|---|---|
| Inicio | `/inicio` | ✅ |
| Ventas | `/ventas` | ✅ (incluye modo POS en editor) |
| Inventario | `/inventario` | ✅ |
| Facturación | `/facturacion` | ✅ |
| Clientes | `/clientes` | ✅ |
| Proveedores | `/proveedores` | ✅ |
| Reportes | `/reportes` | ✅ (DGII disclaimer; API stub) |
| Configuración | `/configuracion` | ✅ (Negocio, cuenta, facturación, NCF, seguridad/2FA) |
| Admin plataforma | `/admin` | ✅ (solo `platformAdmin` + MFA) |
| Suscripción | `/suscripcion` | ✅ (owner/manager) |
| Notificaciones | `/notificaciones` | ✅ (fuera del nav principal) |

Auth/marketing: `/login`, `/activar`, `/recuperar`, `/restablecer`, `/suscribirme`, `/legal/*`, `/catalogo`.

**INTOCABLES (ley prompt):** splash/intro + login — no tocar en F1+.

### Móvil

`apps/mobile` = stub Expo (outbox local “Facilito POS”). **Sin router, sin pantallas ERP.** Prioridad F7.

### API (prefijos)

| Módulo rutas | Prefijos |
|---|---|
| auth | `/v1/auth/*`, `/v1/me` |
| business | `/v1/dashboard`, `/v1/customers`, `/v1/suppliers`, `/v1/settings`, `/v1/notifications`, `/v1/search` |
| inventory | `/v1/products*`, `/v1/inventory/*`, import CSV/TXT, export |
| invoice | `/v1/invoices*`, `/v1/reports/invoices` |
| billing | `/v1/billing/*` |
| platform | `/v1/platform/*` |
| legacy | `/v1/sales`, `/v1/copilot/ask`, `/v1/branches`, `/v1/reports/606\|607\|608` (stub), counts, studio, audit |

Cron: Vercel `0 10 * * *` → `/v1/billing/cron/sweep` (`CRON_SECRET`).

### Migraciones existentes (`apps/api/migrations/`)

`001` … `010` (identity/app/audit → negocio/inventario/facturas → auth → NCF → platform admin → billing).  
Últimas aplicadas en prod (STATUS-AREAS): 009 + 010.

### Roles

`owner | manager | cashier | warehouse | accountant | viewer` (`packages/domain/src/types.ts` + `app.acceso`).  
Guards: `requireAuth` / `requireRole` / `requirePlatformAdmin` (+ MFA).  
**Sin** UI tenant de “Usuarios y roles” / matriz de permisos personalizada.  
Roles del prompt (RRHH, Contador dedicado UI) = extensión futura; `accountant` ya existe en enum.

### Feature flags

`FEATURE_ECF_ENABLED` (default false), `FEATURE_COPILOT_ENABLED` (default true), `FEATURE_INSTAGRAM_OAUTH_ENABLED`.  
Plan `copilot` en `@facilito/domain/plans`. Flags ECF/Copilot **poco cableados** en paths (deuda 🟡).

### Tokens UI (fuente de verdad visual)

- App: `apps/web/src/app/globals.css` — verde `#0d855b`, naranja `#f5871f`, ink `#15233a`, bg `#f4f7f6`, radius 16/10/22, Poppins, sidebar 256/80.
- Package: `packages/ui/src/tokens.css` + `tokens.ts` (verde/naranja ligeramente distintos — **dual source 🟡** a unificar en F1, no paleta paralela FactP dark).
- Componentes: en `apps/web/src/components/*` — **no** hay library completa en `@facilito/ui` (solo tokens).
- Íconos: `lucide-react` (línea) — bueno para ícono único por ítem.

### Packages

`domain`, `ui`, `verticals`, `config`, + `copilot-service`, `ecf` (paquetes presentes; e-CF flag off).

---

## Matriz de brechas (repo manda)

| Módulo objetivo | Estado | Notas |
|---|---|---|
| Dashboard / Inicio | ✅ EXISTE | Mejorar KPIs salud/NCF/caja/RRHH |
| Clientes | ✅ EXISTE | + CRM |
| Productos (catálogo separado) | ⚠️ PARCIAL | Dentro de Inventario |
| Inventario | ✅ EXISTE | CSV/TXT import; **falta** foto/IA, wizard perfil, staging, salud, FEFO UI, multi-almacén completo |
| CRM | ❌ FALTA | |
| Automatización | ⚠️ PARCIAL | DB `regla_copilot` + `/v1/copilot/ask`; sin UI flujos |
| Ventas / Facturación | ✅ EXISTE | **No tocar** lógica NCF/e-CF/ITBIS |
| Cotizaciones | ❌ FALTA | |
| Proveedores | ✅ EXISTE | Mejorar |
| Órdenes de compra | ❌ FALTA | |
| Cuadre de caja | ⚠️ PARCIAL | Tabla `turno_caja`; sin API/UI |
| POS | ⚠️ PARCIAL | Web en Ventas; móvil stub; sin offline-first PWA |
| Gastos | ❌ FALTA | |
| Contabilidad | ❌ FALTA | |
| Empleados / Nómina / Vacaciones / Reportes RRHH | ❌ FALTA | |
| NCF / secuencias | ✅ EXISTE | Panel dashboard secuencias = mejora |
| Reportes 606/607/608/609 | ⚠️ STUB | `status: 'stub'` — no usar en prod fiscal |
| Sucursales | ⚠️ PARCIAL | API `/v1/branches`; sin UI |
| Usuarios y roles (tenant) | ⚠️ PARCIAL | Roles en JWT; sin matriz UI |
| Planes | ✅ EXISTE | No cambiar precios |
| Guía de inicio | ⚠️ PARCIAL | Empty states / tips; no checklist rubro |
| Notificaciones | ✅ EXISTE | Unificar severidades/alertas inventario-caja-RRHH |
| Menú usuario rico | ⚠️ PARCIAL | Switch negocio, cuenta, config; falta actividad/versión/último acceso |
| Command palette ⌘K | ❌ FALTA | Hay search-box global |
| Copilot UI | ⚠️ PARCIAL | API stub LLM; sin FAB/chat contextual |

---

## 🧪 VERIFICACIÓN (este turno)

| Check | Resultado |
|---|---|
| `pnpm --filter @facilito/domain test` | ✅ **94/94** |
| `pnpm --filter @facilito/api test` | ✅ **192/192** |
| `pnpm --filter @facilito/web typecheck` | ✅ |
| `pnpm --filter @facilito/api typecheck` | ✅ |
| `pnpm typecheck` (turbo root) | ❌ `@facilito/verticals` — `Cannot find module 'vitest'` |
| `pnpm test` (turbo root) | ❌ mismo fallo vitest en `packages/verticals` |
| Lighthouse / axe / E2E este turno | ⚠️ no re-ejecutados (STATUS-AREAS: login Perf 95 LCP 2.8s) |
| Build web prod este turno | ⚠️ no corrido (F0) |

---

## 🔐 SEGURIDAD (scan rápido)

| Sev | Hallazgo |
|---|---|
| 🟠 | Superficies públicas (checkout, catálogo, plans) — revisar abuse/rate limit al crecer |
| 🟡 | Flags ECF/Copilot no enforceados de forma uniforme |
| 🟡 | Reportes DGII stub — riesgo si UI no deja claro “no oficial” |
| 🟡 | CSP `style-src 'unsafe-inline'` |
| 🟢 | JWT + cookies, MFA platform admin, RLS tenant, cron 404 sin secret, CSV neutralize |

Privacidad RRHH (Ley 172-13): **N/A hasta F4** — diseñar cifrado de campo desde migración 1.

---

## Deuda técnica relevante

1. `packages/verticals` sin vitest resoluble → rompe turbo root.  
2. Dual tokens `globals.css` vs `@facilito/ui`.  
3. `@facilito/ui` sin componentes (PageHeader, DataTable, …) — F1 debe crearlos **extendiendo** shell actual.  
4. Sidebar flat vs grupos FactP — capa visual nueva sin renombrar rutas.  
5. Mobile casi vacío vs promesa POS/campo.  
6. 🔒 Banco prod (`BILLING_BANK_*`) sigue bloqueando checkout transferencia (STATUS-AREAS).

---

## Plan migraciones aditivas propuesto (nombres; sin SQL hasta OK F0)

Orden sugerido alineado a fases:

1. `011_tenant_iam` — invitaciones equipo, permisos granulares (si hace falta)  
2. `012_feature_flags_plan` — flags por plan (RRHH, multi-sucursal, …)  
3. `013_inventory_intelligent` — profiles, import_batches/rows, alerts, warehouses extend  
4. `014_cash_ops` — cajas, sessions, movements, closings (sobre `turno_caja`)  
5. `015_purchasing` — PO + goods receipts  
6. `016_quotes` — cotizaciones  
7. `017_crm_automation` — pipeline + reglas ejecutables  
8. `018_expenses_ar_ap`  
9. `019_accounting_lite`  
10. `020_hr_payroll` — employees, leave, `payroll_parameters` versionada, runs  
11. `021_dgii_reporting_artifacts` — artefactos 606+ (formato 🔒 verificar dgii.gov.do)  
12. `022_notifications_center` — severidad/estado unificado  

Todas: `tenant_id`, índices, reversibles down donde aplique, RLS.

---

## Contradicciones reportadas (repo / instrucciones mandan)

| Conflicto | Resolución F0 |
|---|---|
| Pedido chat: “sube a GitHub/Vercel al terminar” vs Ley ⑨ + F8 del mega-prompt | **No push/deploy en F0.** Solo tras `OK F0`…`OK F8` explícitos. |
| `/loop` continuo vs “Detente y espera OK F0” | **Loop de implementación no armado.** Reanudar al recibir `OK F0`. |
| FactP dark vs Facilito claro | Conservar tema claro Facilito; no copiar shell oscuro FactP. |
| Íconos repetidos FactP | En F1: un Lucide distinto por ítem. |

---

## ⚠️ RIESGOS residuales

- Alcance ERP+ completo (F1–F8) es **multi-sprint**; un solo turno no cierra “todo sin fallas”.  
- Nómina/TSS/ISR: cifras del prompt son referencia — **verificar DGII/TSS** antes de hardcodear (tabla versionada).  
- Inventario por foto/IA: costo + threat model (prompt injection en imágenes).  
- Offline POS + NCF: decisión de diseño pendiente (reserva rangos vs bloqueo fiscal offline).  
- Typecheck root roto por verticals — arreglar en F1 foundations (diff mínimo).

---

## 💰 COSTO (proyección)

IA visión/import, almacenamiento fotos/docs, WhatsApp, cola Redis/BullMQ, Neon storage — **sin estimar $** hasta dimensionar F2/F4. Soft launch actual no depende de ERP+ modules.

---

## ⏳ SIGUIENTE

**Esperando tu `OK F0`.**  
Con OK: crear rama `feat/erp-plus`, commit local F1 (design system + nav por grupos + command palette + flags + notificaciones + fix vitest verticals), **sin push** hasta que lo pidas.

**Decisiones útiles en el OK (opcionales):**  
1) ¿Priorizar F2 Inventario Inteligente antes que F3 Caja, o Caja primero?  
2) ¿WhatsApp soporte URL ya lista (`NEXT_PUBLIC_SUPPORT_URL`)?  
3) Confirmar: intro/login intocables incluso si LCP 2.8s.
