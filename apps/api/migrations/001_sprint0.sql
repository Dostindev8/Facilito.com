-- Sprint 0: schemas, roles grants, isolation probe, identity, audit
-- Expand → migrate → contract pattern; this file is expand+migrate.

BEGIN;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS vectors;

GRANT USAGE ON SCHEMA identity, app, audit, vectors TO facilito_app, facilito_master;
GRANT USAGE ON SCHEMA identity, app, audit, vectors TO facilito_migrator;

-- Helper: current tenant / persona from session GUCs
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_persona_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.persona_id', true), '')::uuid
$$;

-- Isolation probe (exists BEFORE business modules)
CREATE TABLE IF NOT EXISTS app.isolation_probe (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS isolation_probe_tenant_idx ON app.isolation_probe (tenant_id);

ALTER TABLE app.isolation_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.isolation_probe FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isolation_probe_tenant ON app.isolation_probe;
CREATE POLICY isolation_probe_tenant ON app.isolation_probe
  FOR ALL
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.isolation_probe TO facilito_app;

-- Identity: Persona
CREATE TABLE IF NOT EXISTS identity.persona (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_enc text,
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS persona_email_lower_uidx ON identity.persona (lower(email));

ALTER TABLE identity.persona ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.persona FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persona_self ON identity.persona;
CREATE POLICY persona_self ON identity.persona
  FOR ALL
  USING (id = app.current_persona_id() OR current_setting('app.auth_bootstrap', true) = '1')
  WITH CHECK (id = app.current_persona_id() OR current_setting('app.auth_bootstrap', true) = '1');

GRANT SELECT, INSERT, UPDATE ON identity.persona TO facilito_app;

CREATE TABLE IF NOT EXISTS identity.refresh_token (
  id uuid PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES identity.persona(id),
  family_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  reused_at timestamptz
);

CREATE INDEX IF NOT EXISTS refresh_token_persona_idx ON identity.refresh_token (persona_id);
CREATE INDEX IF NOT EXISTS refresh_token_family_idx ON identity.refresh_token (family_id);

ALTER TABLE identity.refresh_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.refresh_token FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refresh_self ON identity.refresh_token;
CREATE POLICY refresh_self ON identity.refresh_token
  FOR ALL
  USING (persona_id = app.current_persona_id() OR current_setting('app.auth_bootstrap', true) = '1')
  WITH CHECK (persona_id = app.current_persona_id() OR current_setting('app.auth_bootstrap', true) = '1');

GRANT SELECT, INSERT, UPDATE ON identity.refresh_token TO facilito_app;

CREATE TABLE IF NOT EXISTS identity.device (
  id uuid PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES identity.persona(id),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE identity.device ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.device FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_self ON identity.device;
CREATE POLICY device_self ON identity.device
  FOR ALL
  USING (persona_id = app.current_persona_id())
  WITH CHECK (persona_id = app.current_persona_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.device TO facilito_app;

-- Business: Negocio (tenant)
CREATE TABLE IF NOT EXISTS app.negocio (
  id uuid PRIMARY KEY,
  razon_social text NOT NULL,
  rnc_enc text NOT NULL,
  rnc_hash text NOT NULL,
  verticales jsonb NOT NULL DEFAULT '[]'::jsonb,
  moneda text NOT NULL DEFAULT 'DOP',
  zona_horaria text NOT NULL DEFAULT 'America/Santo_Domingo',
  plan text NOT NULL DEFAULT 'starter',
  costing_method text NOT NULL DEFAULT 'weighted_average'
    CHECK (costing_method IN ('fifo', 'weighted_average')),
  costing_locked boolean NOT NULL DEFAULT false,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT negocio_rnc_hash_unique UNIQUE (rnc_hash)
);

ALTER TABLE app.negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.negocio FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS negocio_tenant ON app.negocio;
CREATE POLICY negocio_tenant ON app.negocio
  FOR ALL
  USING (id = app.current_tenant_id() OR current_setting('app.auth_bootstrap', true) = '1')
  WITH CHECK (id = app.current_tenant_id() OR current_setting('app.auth_bootstrap', true) = '1');
GRANT SELECT, INSERT, UPDATE ON app.negocio TO facilito_app;

-- Acceso: persona × negocio × rol
CREATE TABLE IF NOT EXISTS app.acceso (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  persona_id uuid NOT NULL REFERENCES identity.persona(id),
  rol text NOT NULL CHECK (rol IN ('owner','manager','cashier','warehouse','accountant','viewer')),
  estado text NOT NULL DEFAULT 'active' CHECK (estado IN ('active','suspended','invited')),
  pin_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceso_persona_negocio_unique UNIQUE (persona_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS acceso_tenant_idx ON app.acceso (tenant_id);

ALTER TABLE app.acceso ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.acceso FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acceso_tenant ON app.acceso;
CREATE POLICY acceso_tenant ON app.acceso
  FOR ALL
  USING (
    tenant_id = app.current_tenant_id()
    OR persona_id = app.current_persona_id()
    OR current_setting('app.auth_bootstrap', true) = '1'
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    OR current_setting('app.auth_bootstrap', true) = '1'
  );
GRANT SELECT, INSERT, UPDATE ON app.acceso TO facilito_app;

-- At least one owner per business (deferred constraint via trigger)
CREATE OR REPLACE FUNCTION app.ensure_owner_exists() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owners int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.rol = 'owner' AND NEW.rol <> 'owner' THEN
    SELECT count(*) INTO owners FROM app.acceso
      WHERE tenant_id = OLD.tenant_id AND rol = 'owner' AND estado = 'active' AND id <> OLD.id;
    IF owners < 1 THEN
      RAISE EXCEPTION 'business must keep at least one owner';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.rol = 'owner' THEN
    SELECT count(*) INTO owners FROM app.acceso
      WHERE tenant_id = OLD.tenant_id AND rol = 'owner' AND estado = 'active' AND id <> OLD.id;
    IF owners < 1 THEN
      RAISE EXCEPTION 'business must keep at least one owner';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS acceso_owner_guard ON app.acceso;
CREATE TRIGGER acceso_owner_guard
  AFTER UPDATE OR DELETE ON app.acceso
  FOR EACH ROW EXECUTE FUNCTION app.ensure_owner_exists();

-- Audit append-only (hash chain per tenant)
CREATE TABLE IF NOT EXISTS audit.bitacora (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  author_id uuid NOT NULL,
  device_id text,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit.bitacora_2026_01
  PARTITION OF audit.bitacora
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')
  PARTITION BY HASH (tenant_id);

CREATE TABLE IF NOT EXISTS audit.bitacora_2026_01_p0 PARTITION OF audit.bitacora_2026_01 FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE IF NOT EXISTS audit.bitacora_2026_01_p1 PARTITION OF audit.bitacora_2026_01 FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE IF NOT EXISTS audit.bitacora_2026_01_p2 PARTITION OF audit.bitacora_2026_01 FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE IF NOT EXISTS audit.bitacora_2026_01_p3 PARTITION OF audit.bitacora_2026_01 FOR VALUES WITH (MODULUS 4, REMAINDER 3);

CREATE TABLE IF NOT EXISTS audit.bitacora_default PARTITION OF audit.bitacora DEFAULT;

CREATE INDEX IF NOT EXISTS bitacora_tenant_created_idx ON audit.bitacora (tenant_id, created_at);

ALTER TABLE audit.bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.bitacora FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bitacora_tenant ON audit.bitacora;
CREATE POLICY bitacora_tenant ON audit.bitacora
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY bitacora_insert ON audit.bitacora
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

REVOKE UPDATE, DELETE ON audit.bitacora FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit.bitacora FROM facilito_app;
GRANT SELECT, INSERT ON audit.bitacora TO facilito_app;

CREATE OR REPLACE FUNCTION audit.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.bitacora is append-only';
END;
$$;

-- Append-only enforced by REVOKE UPDATE/DELETE + reject trigger on default partition
DROP TRIGGER IF EXISTS bitacora_no_update ON audit.bitacora_default;
CREATE TRIGGER bitacora_no_update
  BEFORE UPDATE OR DELETE ON audit.bitacora_default
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

-- Vector store probe
CREATE TABLE IF NOT EXISTS vectors.embedding (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  collection text NOT NULL,
  content text NOT NULL,
  embedding vector(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS embedding_tenant_idx ON vectors.embedding (tenant_id, collection);

ALTER TABLE vectors.embedding ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectors.embedding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS embedding_tenant ON vectors.embedding;
CREATE POLICY embedding_tenant ON vectors.embedding
  FOR ALL
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON vectors.embedding TO facilito_app;

COMMIT;
