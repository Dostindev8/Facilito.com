-- Phase 1 business tables: producto, lote, movimiento, venta, comprobante, conteo, contenido, regla_copilot
BEGIN;

CREATE TABLE IF NOT EXISTS app.producto (
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  id uuid NOT NULL,
  sku text NOT NULL,
  nombre text NOT NULL,
  barcode text,
  uom text NOT NULL DEFAULT 'unidad',
  price_list jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_rate numeric(8,4) NOT NULL DEFAULT 0.18,
  vertical_attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT producto_sku_unique UNIQUE (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS producto_tenant_sku_idx ON app.producto (tenant_id, sku);
ALTER TABLE app.producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.producto FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS producto_tenant ON app.producto;
CREATE POLICY producto_tenant ON app.producto
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.producto TO facilito_app;

CREATE TABLE IF NOT EXISTS app.lote (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  producto_id uuid NOT NULL,
  codigo_lote text NOT NULL,
  vencimiento date,
  cantidad_recibida numeric(20,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT lote_unique UNIQUE (tenant_id, producto_id, codigo_lote),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES app.producto(tenant_id, id)
);

ALTER TABLE app.lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lote FORCE ROW LEVEL SECURITY;
CREATE POLICY lote_tenant ON app.lote
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.lote TO facilito_app;

CREATE TABLE IF NOT EXISTS app.movimiento_inventario (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  tipo text NOT NULL CHECK (tipo IN ('in','out','adjust','sale','void_sale','count')),
  producto_id uuid NOT NULL,
  lote_id uuid,
  cantidad numeric(20,4) NOT NULL,
  costo numeric(20,4) NOT NULL DEFAULT 0,
  motivo text,
  referencia text,
  author_id uuid NOT NULL,
  device_id text,
  client_uuid uuid NOT NULL,
  PRIMARY KEY (tenant_id, id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitioned tables cannot carry a UNIQUE that omits the partition key,
-- so device idempotency lives in its own guard table.
CREATE TABLE IF NOT EXISTS app.movimiento_client_uuid (
  tenant_id uuid NOT NULL,
  client_uuid uuid NOT NULL,
  movimiento_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, client_uuid)
);
ALTER TABLE app.movimiento_client_uuid ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.movimiento_client_uuid FORCE ROW LEVEL SECURITY;
CREATE POLICY movimiento_client_uuid_tenant ON app.movimiento_client_uuid
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON app.movimiento_client_uuid TO facilito_app;

CREATE TABLE IF NOT EXISTS app.movimiento_inventario_default
  PARTITION OF app.movimiento_inventario DEFAULT;

CREATE INDEX IF NOT EXISTS movimiento_tenant_producto_idx
  ON app.movimiento_inventario (tenant_id, producto_id, created_at);

ALTER TABLE app.movimiento_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.movimiento_inventario FORCE ROW LEVEL SECURITY;
CREATE POLICY movimiento_tenant ON app.movimiento_inventario
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON app.movimiento_inventario TO facilito_app;
REVOKE UPDATE, DELETE ON app.movimiento_inventario FROM facilito_app;

CREATE TABLE IF NOT EXISTS app.venta (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  client_uuid uuid NOT NULL,
  cliente_nombre text,
  items jsonb NOT NULL,
  descuento numeric(20,4) NOT NULL DEFAULT 0,
  impuestos numeric(20,4) NOT NULL DEFAULT 0,
  total numeric(20,4) NOT NULL,
  estado text NOT NULL DEFAULT 'completed' CHECK (estado IN ('completed','voided')),
  fiscal_status text NOT NULL DEFAULT 'pending',
  void_reason text,
  voided_at timestamptz,
  author_id uuid NOT NULL,
  device_id text,
  fx_rate numeric(20,8),
  fx_source text,
  fx_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT venta_client_uuid_unique UNIQUE (tenant_id, client_uuid)
);

ALTER TABLE app.venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.venta FORCE ROW LEVEL SECURITY;
CREATE POLICY venta_tenant ON app.venta
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.venta TO facilito_app;

CREATE TABLE IF NOT EXISTS app.comprobante_fiscal (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  venta_id uuid NOT NULL,
  tipo text NOT NULL,
  e_ncf text,
  estado_dgii text NOT NULL DEFAULT 'pending',
  xml_firmado text,
  intentos int NOT NULL DEFAULT 0,
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT comprobante_encf_unique UNIQUE (tenant_id, e_ncf),
  CONSTRAINT comprobante_venta_unique UNIQUE (tenant_id, venta_id)
);
-- TODO: VERIFICAR EN VIVO — e-NCF format and DGII status enum

ALTER TABLE app.comprobante_fiscal ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.comprobante_fiscal FORCE ROW LEVEL SECURITY;
CREATE POLICY comprobante_tenant ON app.comprobante_fiscal
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.comprobante_fiscal TO facilito_app;

CREATE TABLE IF NOT EXISTS app.conteo (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  alcance text NOT NULL,
  contado_por uuid NOT NULL,
  aprobado_por uuid,
  esperado numeric(20,4) NOT NULL,
  contado numeric(20,4) NOT NULL,
  diferencia numeric(20,4) NOT NULL,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT conteo_segregation CHECK (aprobado_por IS NULL OR contado_por <> aprobado_por)
);

ALTER TABLE app.conteo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.conteo FORCE ROW LEVEL SECURITY;
CREATE POLICY conteo_tenant ON app.conteo
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.conteo TO facilito_app;

CREATE TABLE IF NOT EXISTS app.contenido_studio (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  tipo text NOT NULL,
  estado text NOT NULL DEFAULT 'draft'
    CHECK (estado IN ('draft','review','published','archived')),
  version int NOT NULL DEFAULT 1,
  author_id uuid NOT NULL,
  file_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE app.contenido_studio ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contenido_studio FORCE ROW LEVEL SECURITY;
CREATE POLICY contenido_tenant ON app.contenido_studio
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.contenido_studio TO facilito_app;

CREATE TABLE IF NOT EXISTS app.regla_copilot (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  texto_original text NOT NULL,
  forma_estructurada jsonb NOT NULL DEFAULT '{}'::jsonb,
  vigencia_desde date,
  vigencia_hasta date,
  author_id uuid NOT NULL,
  version int NOT NULL DEFAULT 1,
  aprobada_por uuid,
  activa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE app.regla_copilot ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.regla_copilot FORCE ROW LEVEL SECURITY;
CREATE POLICY regla_tenant ON app.regla_copilot
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.regla_copilot TO facilito_app;

CREATE TABLE IF NOT EXISTS app.copilot_approval_queue (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  proposal jsonb NOT NULL,
  level int NOT NULL CHECK (level = 2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE app.copilot_approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.copilot_approval_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY copilot_queue_tenant ON app.copilot_approval_queue
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.copilot_approval_queue TO facilito_app;

CREATE TABLE IF NOT EXISTS app.turno_caja (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  cajero_id uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  declared_cash numeric(20,4),
  expected_cash numeric(20,4),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE app.turno_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.turno_caja FORCE ROW LEVEL SECURITY;
CREATE POLICY turno_tenant ON app.turno_caja
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.turno_caja TO facilito_app;

CREATE TABLE IF NOT EXISTS app.sucursal (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  nombre text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE app.sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sucursal FORCE ROW LEVEL SECURITY;
CREATE POLICY sucursal_tenant ON app.sucursal
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.sucursal TO facilito_app;

CREATE TABLE IF NOT EXISTS app.idempotency_key (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE app.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_key FORCE ROW LEVEL SECURITY;
CREATE POLICY idem_tenant ON app.idempotency_key
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON app.idempotency_key TO facilito_app;

CREATE TABLE IF NOT EXISTS app.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON app.schema_migrations TO facilito_migrator;
GRANT SELECT ON app.schema_migrations TO facilito_app;

COMMIT;
