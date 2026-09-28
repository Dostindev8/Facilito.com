-- Business profile: free-text business type (the vertical profile stays in `verticales`), optional Instagram,
-- and verified email changes. Expand-only: existing rows are backfilled, nothing is dropped.
BEGIN;

ALTER TABLE app.negocio
  ADD COLUMN IF NOT EXISTS tipo_negocio text,
  ADD COLUMN IF NOT EXISTS tipo_negocio_source text NOT NULL DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS instagram_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS instagram_last_synced_at timestamptz;

UPDATE app.negocio
   SET tipo_negocio = CASE verticales->>0 WHEN 'ferreteria' THEN 'Ferretería' WHEN 'farmacia' THEN 'Farmacia' ELSE 'Colmado' END
 WHERE tipo_negocio IS NULL;

ALTER TABLE app.negocio DROP CONSTRAINT IF EXISTS negocio_tipo_negocio_check;
ALTER TABLE app.negocio ADD CONSTRAINT negocio_tipo_negocio_check
  CHECK (tipo_negocio IS NULL OR (char_length(tipo_negocio) BETWEEN 2 AND 60 AND tipo_negocio !~ '[<>]'));
ALTER TABLE app.negocio DROP CONSTRAINT IF EXISTS negocio_tipo_negocio_source_check;
ALTER TABLE app.negocio ADD CONSTRAINT negocio_tipo_negocio_source_check
  CHECK (tipo_negocio_source IN ('catalog', 'custom'));
ALTER TABLE app.negocio DROP CONSTRAINT IF EXISTS negocio_instagram_handle_check;
ALTER TABLE app.negocio ADD CONSTRAINT negocio_instagram_handle_check
  CHECK (instagram_handle IS NULL OR instagram_handle ~ '^[a-z0-9._]{1,30}$');

-- Email change requests (hashed, single use). The current email keeps working until the new one is confirmed.
CREATE TABLE IF NOT EXISTS identity.email_change (
  id uuid PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES identity.persona(id),
  new_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_change_persona_idx ON identity.email_change (persona_id);
ALTER TABLE identity.email_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.email_change FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_change_self ON identity.email_change;
CREATE POLICY email_change_self ON identity.email_change
  FOR ALL
  USING (persona_id = app.current_persona_id() OR current_setting('app.auth_bootstrap', true) = '1')
  WITH CHECK (persona_id = app.current_persona_id() OR current_setting('app.auth_bootstrap', true) = '1');
GRANT SELECT, INSERT, UPDATE ON identity.email_change TO facilito_app;

COMMIT;
