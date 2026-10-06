# Benchmark competitivo — Facilito vs. alternativas en RD

Fecha de consulta: 2026-10-05 (Fase 0, super prompt v2.0 §0.7). Fuentes: páginas públicas de cada producto y de la DGII consultadas ese día. **Precios y funciones son lo que cada empresa publica; no se verificaron con ellas.** Se volverán a verificar antes de usarlos en precios o marketing (Ley de verificación viva). No se copiaron activos ni textos.

Limitación: el prompt pide capturas; esta fase no tomó capturas de productos de terceros (requieren crear cuentas y aceptar términos, cosa que no se hace sin autorización). La matriz se basa en la información pública.

## Productos comparados
| Producto | Qué es | Estado de la verificación |
|---|---|---|
| **Alegra RD** | Suite en la nube (Facturación, POS, ERP) con e-CF | Página de precios RD consultada |
| **Treinta (DO)** | App móvil de ventas, inventario y fiados para microempresas | Página de precios DO consultada |
| **Cabal** | — | **No identificado.** Ninguna búsqueda devolvió un software de facturación/POS dominicano con ese nombre. Confirmar con el dueño a cuál producto se refiere. |
| **Facturador Gratuito DGII** | Portal gratuito de la DGII para emitir e-CF | Portal y requisitos consultados en dgii.gov.do |
| **Facilito** (hoy) | Este repositorio, en producción | Verificado en código y en producción este día |

## Matriz por eje
| Eje | Alegra RD | Treinta | Facturador Gratuito | Facilito hoy |
|---|---|---|---|---|
| Onboarding | Registro web con prueba | Registro en la app, muy rápido | Requiere RNC, alta NCF, Oficina Virtual y certificado digital | Registro con RNC/cédula y perfil de negocio; sin verificación de email ni login con Google (501) |
| POS / ventas | Módulo POS aparte (planes POS) | Ventas rápidas en móvil | No es POS: solo emite comprobantes | Facturación web con escáner, ventas con idempotencia; sin pantalla POS dedicada |
| Inventario | Sí (más completo en ERP) | Sí, básico | No | Sí: kardex, PEPS/promedio/FEFO, stock atómico, conteos con constraint |
| e-CF | Sí (E31/E32 y más), modo offline | Sin evidencia pública de e-CF DGII | Sí, oficial y gratis; volumen orientativo ~150/mes | **No**: solo NCF heredado; motor e-CF sin firma ni proveedor (ADR-011) |
| Reportes 606/607/608 | Sí (606/607 en plan Pro, 608 en suites) | No | No genera formatos de envío | **Stub** (`/v1/reports/606…608` devuelve `status: 'stub'`) |
| Roles | Sí, por plan | Limitado | Usuario del contribuyente | 6 roles (owner, manager, cashier, warehouse, accountant, viewer) con RLS por negocio |
| Móvil | Apps + web | Móvil primero | Web | Web responsive + Expo offline-first (Expo 52, legado); sin PWA |
| Precio publicado | Facturación US$15 / 29 / 45; POS US$25 / 39 / 55; ERP US$79 / 129 / 199 por mes | Esencial US$9.99, Pro US$19.99 por mes | Gratis (el certificado puede tener costo) | Sin página de precios (`/precios` → 404) ni cobro |
| Soporte | Chat/email, centro de ayuda | En la app | Centro de asistencia DGII | WhatsApp de soporte en el panel; sin base de conocimiento |

Proveedores PSFE locales que pueden ser socios de integración (no competidores directos del panel de gestión): ef2 (API desde ~RD$2,499/mes con 10 tipos e-CF y sandbox), EmiteF (gratis hasta 30, luego desde ~RD$5,000), Factoa (~RD$1,000 por 150), Factura Dominicana (~RD$1,380 por 250).

## Brechas que importan para vender antes del 15-nov-2026
1. **e-CF real** (bloqueante comercial): sin él Facilito no sirve a quien está obligado. Ruta en ADR-011.
2. **606/607/608** reales: hoy son stub; Alegra los cobra en planes altos.
3. **Compras y gastos**: no existen (necesarios para el 606 y para utilidad real).
4. **Sitio público y precios**: `/`, `/precios`, `robots.txt`, `sitemap.xml` no existen; `/inicio` público solo muestra "Cargando".
5. **Onboarding sin fricción**: verificación de email y login con Google.

## Ventajas defendibles
1. **Precio de entrada por debajo de Alegra con e-CF incluido**, si el costo del PSFE se negocia por volumen (Treinta es más barato pero sin e-CF).
2. **Inventario serio en el plan de entrada** (kardex, FEFO para farmacia, conteos con constraint): Alegra lo reserva a ERP; Treinta lo tiene básico.
3. **Seguridad verificable**: RLS forzado por negocio con rol sin BYPASSRLS, bitácora con cadena de hashes, NCF atómico probado con 200 emisiones concurrentes.
4. **Verticales dominicanos** (colmado, ferretería, farmacia) y offline-first en móvil.
5. **WhatsApp como canal de envío y soporte**, natural para el mercado.

## Siguiente paso
Re-verificar precios y alcance e-CF de Alegra y Treinta antes de fijar los planes de Facilito (Fase 8), y aclarar a qué producto se refiere "Cabal".
