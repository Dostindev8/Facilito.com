# Backup y recuperación (DR)

Objetivos propuestos (confirmar con el dueño): **RPO 24 h**, **RTO 4 h**. Hoy el procedimiento está documentado; el ensayo real en Neon es 🔒 (acceso consola del dueño).

## Capas

1. **PITR Neon (primera línea)**  
   Historial según plan Neon. Recuperar: crear rama desde instante T, apuntar un Preview a esa rama, verificar, decidir cutover.

2. **`pg_dump` cifrado (segunda línea)**  
   Diario, misma major de Postgres:

   ```bash
   pg_dump --format=custom --no-owner --file=facilito-AAAAMMDD.dump "$DATABASE_ADMIN_URL"
   age -r <clave-pública> -o facilito-AAAAMMDD.dump.age facilito-AAAAMMDD.dump
   ```

   Guardar solo el `.age` en bucket versionado (retención ≥ 30 días). Clave aparte del bucket. Nunca subir dump en claro (RNC/cédulas).

3. **Ensayo de restauración (mensual) — 🔒 ejecución**  
   - Restaurar a rama Neon vacía: `pg_restore --no-owner --dbname "$URL_RAMA_PRUEBA" …`  
   - `pnpm --filter @facilito/api migrate` (sin pendientes).  
   - Comparar conteos: `app.factura`, `app.producto`, `billing.pago`, `audit.bitacora`.  
   - Anotar fecha, duración (= RTO medido), resultado.

## Billing / migración 009

Antes de migrar prod: punto de restauración Neon. Tras migrate, verificar `billing.plan` (ver `PROD-BILLING.md`).

## Qué no hacer

- Restaurar dump sobre producción sin confirmación expresa del dueño.
- Usar backup para “limpiar” ledger o comprobantes (append-only).
- Compartir `DATABASE_ADMIN_URL` en chats o tickets.

Ver también la sección Respaldos en [`docs/MAINTENANCE.md`](../MAINTENANCE.md).
