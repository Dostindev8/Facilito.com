# STATUS F1 — Fundaciones ERP+ (Facilito)

**Fecha:** 18 oct 2026 · **Rama:** `feat/erp-plus` · **Versión UI:** `1.1.0`  
**Compuerta previa:** OK F0 recibido · **Push/deploy:** no (espera OK explícito)

---

## ✅ COMPLETADO

| Entrega | Evidencia |
|---|---|
| Sidebar por dominios (Principal, Ventas, Compras, Caja, RRHH, Fiscal, Reportes, Admin) | `apps/web/src/lib/nav.ts` + `sidebar.tsx` |
| Rutas existentes intactas (`/inicio`, `/ventas`, `/inventario`, …) | EXTEND-NEVER-OVERWRITE |
| Módulos faltantes = páginas honestas `/modulos/[slug]` + fecha | `modulos/[slug]/page.tsx` |
| Soporte colapsable (no tapa el menú) | `support-card.collapsed` |
| Command palette ⌘/Ctrl+K | `command-palette.tsx` |
| Menú usuario: actividad, versión, último acceso, badge rol | `profile-menu.tsx` |
| Reloj RD en header | `header-clock.tsx` |
| Dashboard: salud + NCF + ingresos cobrados (API aditiva) | `dashboard.service.ts` + `inicio/page.tsx` |
| Feature flags | `lib/features.ts` |
| Fix typecheck verticals (exclude tests del `tsc`) | `packages/verticals/tsconfig.json` |
| Login / intro **no tocados** | — |

---

## 🧪 VERIFICACIÓN

| Check | Resultado |
|---|---|
| `pnpm typecheck` (root) | ✅ 11/11 |
| `pnpm --filter @facilito/api test` | ✅ **192/192** |
| `pnpm --filter @facilito/domain test` | ✅ **94/94** |
| `pnpm --filter @facilito/verticals test` | ✅ **6/6** |
| Login/intro regresion visual | ⚠️ no re-capturado este turno |
| Lighthouse | ⚠️ no re-corrido |

---

## 🔐 SEGURIDAD

- Nuevas rutas `/modulos/*` solo UI informativa (auth shell).
- Dashboard NCF: solo lectura de `ncf_secuencia` existente; **sin** cambio de emisión fiscal.
- Sin secretos nuevos.

---

## 📱 RESPONSIVE

- CSS mobile: health-strip apila; reloj se oculta &lt;900px.
- Sidebar drawer existente preservado; grupos scrolleables.

---

## ⚠️ RIESGOS / NO HECHO (honestidad)

- F2–F8 (Inventario IA, Caja real, RRHH, etc.) **no** implementados — solo estructura + Próximamente.
- `Productos` y `Inventario` unificados en un ítem (mismo `/inventario`) hasta separar catálogo.
- Push a GitHub/Vercel **no** ejecutado (Ley ⑨ / F8).
- `apps/mobile/tsconfig.json` local dirty — no incluir en commit.

---

## ⏳ SIGUIENTE

Con **`OK F1`**: F2 Inventario Inteligente (asistente + staging import) **o** F3 Caja (si priorizas cuadre).  
Para publicar: di explícitamente **push + deploy**.
