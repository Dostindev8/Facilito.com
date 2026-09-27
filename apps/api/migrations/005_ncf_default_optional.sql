-- A business can only issue NCF after DGII authorizes a sequence, so the default comprobante type
-- starts empty and is filled when the first sequence is registered. Expand-only.
BEGIN;

ALTER TABLE app.negocio ALTER COLUMN ncf_tipo_default DROP NOT NULL;
ALTER TABLE app.negocio ALTER COLUMN ncf_tipo_default SET DEFAULT NULL;
ALTER TABLE app.negocio DROP CONSTRAINT IF EXISTS negocio_ncf_tipo_default_check;
ALTER TABLE app.negocio ADD CONSTRAINT negocio_ncf_tipo_default_check
  CHECK (ncf_tipo_default IS NULL OR ncf_tipo_default ~ '^[BE][0-9]{2}$');

UPDATE app.negocio n SET ncf_tipo_default = NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM app.ncf_secuencia s WHERE s.tenant_id = n.id AND s.tipo = n.ncf_tipo_default
 );

COMMIT;
