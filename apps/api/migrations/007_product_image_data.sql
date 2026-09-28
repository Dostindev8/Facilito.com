-- Product images live in the row (already sanitized to WebP ≤ 2 MB) so they inherit tenant RLS and survive
-- stateless hosts with ephemeral disks. Expand-only: images previously written to UPLOAD_DIR stay readable.
BEGIN;

ALTER TABLE app.producto ADD COLUMN IF NOT EXISTS imagen_data bytea;

COMMIT;
