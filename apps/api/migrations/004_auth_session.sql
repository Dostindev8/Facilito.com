-- Session hardening: refresh tokens remember the active business and the "remember me" choice.
BEGIN;

ALTER TABLE identity.persona ADD COLUMN IF NOT EXISTS nombre text;

ALTER TABLE identity.refresh_token
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS remember boolean NOT NULL DEFAULT false;

-- A person may READ the businesses where they hold an active access (business switcher),
-- without widening the bootstrap bypass. Writes still require the tenant context.
DROP POLICY IF EXISTS negocio_member_read ON app.negocio;
CREATE POLICY negocio_member_read ON app.negocio
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM app.acceso a
     WHERE a.tenant_id = negocio.id
       AND a.persona_id = app.current_persona_id()
       AND a.estado = 'active'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS refresh_token_hash_uidx ON identity.refresh_token (token_hash);
CREATE INDEX IF NOT EXISTS factura_tenant_estado_idx ON app.factura (tenant_id, estado);
CREATE INDEX IF NOT EXISTS factura_linea_producto_idx ON app.factura_linea (tenant_id, producto_id);

COMMIT;
