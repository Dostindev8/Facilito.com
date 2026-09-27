-- Sprint 0 bootstrap: roles that cannot bypass RLS.
-- The API process MUST connect as facilito_app (NOBYPASSRLS).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_migrator') THEN
    CREATE ROLE facilito_migrator LOGIN PASSWORD 'CHANGE_ME_MIGRATOR' NOSUPERUSER CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_app') THEN
    CREATE ROLE facilito_app LOGIN PASSWORD 'CHANGE_ME_APP' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'facilito_master') THEN
    -- Panel maestro: audited, separate from day-to-day app role. Still NOBYPASSRLS.
    CREATE ROLE facilito_master LOGIN PASSWORD 'CHANGE_ME_MASTER' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE facilito TO facilito_app, facilito_migrator, facilito_master;
