-- Platform administration: an audited authority above tenants that can list accounts and businesses and
-- block or reactivate them. Expand-only. Every cross-tenant read goes through app.is_platform_admin(), which is
-- true only when the transaction opted in (app.platform = '1') AND the current persona is a provisioned admin.
BEGIN;

ALTER TABLE identity.persona
  ADD COLUMN IF NOT EXISTS bloqueado_at timestamptz,
  ADD COLUMN IF NOT EXISTS bloqueado_motivo text;
ALTER TABLE identity.persona DROP CONSTRAINT IF EXISTS persona_bloqueado_motivo_check;
ALTER TABLE identity.persona ADD CONSTRAINT persona_bloqueado_motivo_check
  CHECK (bloqueado_motivo IS NULL OR char_length(bloqueado_motivo) <= 500);

ALTER TABLE app.negocio
  ADD COLUMN IF NOT EXISTS es_plataforma boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspendido_motivo text;
ALTER TABLE app.negocio DROP CONSTRAINT IF EXISTS negocio_suspendido_motivo_check;
ALTER TABLE app.negocio ADD CONSTRAINT negocio_suspendido_motivo_check
  CHECK (suspendido_motivo IS NULL OR char_length(suspendido_motivo) <= 500);
CREATE UNIQUE INDEX IF NOT EXISTS negocio_plataforma_uidx ON app.negocio (es_plataforma) WHERE es_plataforma;

-- Membership is granted only by the privileged provisioning script: the app role can read, never write.
-- RLS is enabled but NOT forced so the owner-run SECURITY DEFINER check below can read it without recursion.
CREATE TABLE IF NOT EXISTS identity.platform_admin (
  persona_id uuid PRIMARY KEY REFERENCES identity.persona(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE identity.platform_admin ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT current_setting('app.platform', true) = '1'
     AND EXISTS (
       SELECT 1 FROM identity.platform_admin
        WHERE persona_id = NULLIF(current_setting('app.persona_id', true), '')::uuid
     )
$$;
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO facilito_app;

DROP POLICY IF EXISTS platform_admin_read ON identity.platform_admin;
CREATE POLICY platform_admin_read ON identity.platform_admin
  FOR SELECT
  USING (persona_id = app.current_persona_id() OR app.is_platform_admin());
GRANT SELECT ON identity.platform_admin TO facilito_app;

DROP POLICY IF EXISTS persona_platform_read ON identity.persona;
CREATE POLICY persona_platform_read ON identity.persona FOR SELECT USING (app.is_platform_admin());
DROP POLICY IF EXISTS persona_platform_update ON identity.persona;
CREATE POLICY persona_platform_update ON identity.persona
  FOR UPDATE USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

DROP POLICY IF EXISTS negocio_platform_read ON app.negocio;
CREATE POLICY negocio_platform_read ON app.negocio FOR SELECT USING (app.is_platform_admin());
DROP POLICY IF EXISTS negocio_platform_update ON app.negocio;
CREATE POLICY negocio_platform_update ON app.negocio
  FOR UPDATE USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

DROP POLICY IF EXISTS acceso_platform_read ON app.acceso;
CREATE POLICY acceso_platform_read ON app.acceso FOR SELECT USING (app.is_platform_admin());

DROP POLICY IF EXISTS refresh_platform_read ON identity.refresh_token;
CREATE POLICY refresh_platform_read ON identity.refresh_token FOR SELECT USING (app.is_platform_admin());
DROP POLICY IF EXISTS refresh_platform_revoke ON identity.refresh_token;
CREATE POLICY refresh_platform_revoke ON identity.refresh_token
  FOR UPDATE USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

-- Platform actions have no tenant, so they get their own append-only log.
CREATE TABLE IF NOT EXISTS audit.platform_log (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES identity.persona(id),
  action text NOT NULL
    CHECK (action IN ('persona.block', 'persona.unblock', 'negocio.suspend', 'negocio.reactivate')),
  target_id uuid NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_log_created_idx ON audit.platform_log (created_at DESC);
ALTER TABLE audit.platform_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.platform_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_log_read ON audit.platform_log;
CREATE POLICY platform_log_read ON audit.platform_log FOR SELECT USING (app.is_platform_admin());
DROP POLICY IF EXISTS platform_log_insert ON audit.platform_log;
CREATE POLICY platform_log_insert ON audit.platform_log
  FOR INSERT WITH CHECK (app.is_platform_admin() AND actor_id = app.current_persona_id());
REVOKE UPDATE, DELETE ON audit.platform_log FROM PUBLIC;
GRANT SELECT, INSERT ON audit.platform_log TO facilito_app;
DROP TRIGGER IF EXISTS platform_log_no_update ON audit.platform_log;
CREATE TRIGGER platform_log_no_update
  BEFORE UPDATE OR DELETE ON audit.platform_log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

COMMIT;
