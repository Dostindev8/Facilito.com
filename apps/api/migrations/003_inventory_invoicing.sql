-- Modules 6 (Inventario) and 7 (Facturación). Expand-only: no column is dropped.
BEGIN;

-- Business settings used by invoicing and the dashboard
ALTER TABLE app.negocio
  ADD COLUMN IF NOT EXISTS nombre_comercial text,
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS ubicacion text NOT NULL DEFAULT 'Santo Domingo, R.D.',
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'suspendido')),
  ADD COLUMN IF NOT EXISTS sujeto_dgii boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS itbis_modo text NOT NULL DEFAULT 'linea'
    CHECK (itbis_modo IN ('linea', 'global')),
  ADD COLUMN IF NOT EXISTS itbis_tasa numeric(8,4) NOT NULL DEFAULT 0.18
    CHECK (itbis_tasa >= 0 AND itbis_tasa < 1),
  ADD COLUMN IF NOT EXISTS ncf_tipo_default text NOT NULL DEFAULT 'B02';

-- Display name per access so audit/kardex can show "who" without reading identity
ALTER TABLE app.acceso ADD COLUMN IF NOT EXISTS display_name text;

-- Suppliers
CREATE TABLE IF NOT EXISTS app.proveedor (
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  id uuid NOT NULL,
  nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  rnc_enc text,
  telefono text,
  email text,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS proveedor_tenant_nombre_idx ON app.proveedor (tenant_id, nombre);
ALTER TABLE app.proveedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.proveedor FORCE ROW LEVEL SECURITY;
CREATE POLICY proveedor_tenant ON app.proveedor
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.proveedor TO facilito_app;

-- Customers (document = cédula/RNC, encrypted at rest)
CREATE TABLE IF NOT EXISTS app.cliente (
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  id uuid NOT NULL,
  nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  documento_enc text,
  telefono text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS cliente_tenant_nombre_idx ON app.cliente (tenant_id, nombre);
ALTER TABLE app.cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cliente FORCE ROW LEVEL SECURITY;
CREATE POLICY cliente_tenant ON app.cliente
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.cliente TO facilito_app;

-- Product: Module 6 fields
ALTER TABLE app.producto
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS costo numeric(20,4) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  ADD COLUMN IF NOT EXISTS precio_venta numeric(20,4) NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  ADD COLUMN IF NOT EXISTS stock_actual numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_min numeric(20,4) NOT NULL DEFAULT 0 CHECK (stock_min >= 0),
  ADD COLUMN IF NOT EXISTS stock_max numeric(20,4) CHECK (stock_max IS NULL OR stock_max >= 0),
  ADD COLUMN IF NOT EXISTS imagen_hash text,
  ADD COLUMN IF NOT EXISTS imagen_mime text,
  ADD COLUMN IF NOT EXISTS proveedor_id uuid,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'inactivo', 'descontinuado'));

ALTER TABLE app.producto
  ADD COLUMN IF NOT EXISTS margen numeric(10,2) GENERATED ALWAYS AS (
    CASE WHEN precio_venta > 0 THEN round((precio_venta - costo) / precio_venta * 100, 2) ELSE NULL END
  ) STORED;

ALTER TABLE app.producto
  ADD CONSTRAINT producto_proveedor_fk FOREIGN KEY (tenant_id, proveedor_id)
  REFERENCES app.proveedor (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS producto_barcode_uidx
  ON app.producto (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS producto_tenant_categoria_idx ON app.producto (tenant_id, categoria);
CREATE INDEX IF NOT EXISTS producto_tenant_estado_idx ON app.producto (tenant_id, estado);

-- Movements: structured adjustment reason + free note
ALTER TABLE app.movimiento_inventario
  ADD COLUMN IF NOT EXISTS motivo_codigo text
    CHECK (motivo_codigo IS NULL OR motivo_codigo IN
      ('merma', 'devolucion', 'conteo_fisico', 'ajuste', 'compra', 'venta', 'anulacion', 'inicial')),
  ADD COLUMN IF NOT EXISTS stock_resultante numeric(20,4);

-- Stock is maintained in the same transaction as the movement.
-- Negative stock is rejected here, so no caller can bypass it.
CREATE OR REPLACE FUNCTION app.apply_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  delta numeric(20,4);
  new_stock numeric(20,4);
  allow_neg boolean;
BEGIN
  delta := CASE
    WHEN NEW.tipo IN ('in', 'void_sale') THEN abs(NEW.cantidad)
    WHEN NEW.tipo IN ('out', 'sale') THEN -abs(NEW.cantidad)
    ELSE NEW.cantidad
  END;

  UPDATE app.producto p
     SET stock_actual = p.stock_actual + delta,
         updated_at = now()
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.producto_id
  RETURNING p.stock_actual, p.allow_negative_stock INTO new_stock, allow_neg;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF new_stock < 0 AND delta < 0 THEN
    SELECT allow_neg OR n.allow_negative_stock INTO allow_neg
      FROM app.negocio n WHERE n.id = NEW.tenant_id;
    IF NOT coalesce(allow_neg, false) THEN
      RAISE EXCEPTION 'NEGATIVE_STOCK' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.stock_resultante := new_stock;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS movimiento_apply ON app.movimiento_inventario;
CREATE TRIGGER movimiento_apply
  BEFORE INSERT ON app.movimiento_inventario
  FOR EACH ROW EXECUTE FUNCTION app.apply_movement();

-- Per-business counters. Updated under row lock; a rolled-back invoice does not consume a number,
-- an issued-then-voided invoice keeps its number forever.
CREATE TABLE IF NOT EXISTS app.secuencia (
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  clave text NOT NULL,
  siguiente bigint NOT NULL DEFAULT 1 CHECK (siguiente > 0),
  PRIMARY KEY (tenant_id, clave)
);
ALTER TABLE app.secuencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.secuencia FORCE ROW LEVEL SECURITY;
CREATE POLICY secuencia_tenant ON app.secuencia
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.secuencia TO facilito_app;

-- NCF ranges authorized by DGII.
-- TODO: VERIFICAR EN VIVO — tipos vigentes, longitud y vencimiento de secuencias DGII.
CREATE TABLE IF NOT EXISTS app.ncf_secuencia (
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  tipo text NOT NULL CHECK (tipo ~ '^[BE][0-9]{2}$'),
  descripcion text NOT NULL,
  siguiente bigint NOT NULL CHECK (siguiente > 0),
  hasta bigint NOT NULL CHECK (hasta > 0),
  vence date,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tipo),
  CHECK (siguiente <= hasta + 1)
);
ALTER TABLE app.ncf_secuencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ncf_secuencia FORCE ROW LEVEL SECURITY;
CREATE POLICY ncf_secuencia_tenant ON app.ncf_secuencia
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.ncf_secuencia TO facilito_app;

-- Invoices: never deleted
CREATE TABLE IF NOT EXISTS app.factura (
  tenant_id uuid NOT NULL REFERENCES app.negocio(id),
  id uuid NOT NULL,
  numero bigint NOT NULL CHECK (numero > 0),
  client_uuid uuid NOT NULL,
  ncf text,
  ncf_tipo text,
  cliente_id uuid,
  cliente_nombre text NOT NULL DEFAULT 'Cliente general',
  fecha_emision timestamptz NOT NULL DEFAULT now(),
  fecha_vencimiento date,
  itbis_modo text NOT NULL CHECK (itbis_modo IN ('linea', 'global')),
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  descuento_total numeric(20,4) NOT NULL DEFAULT 0 CHECK (descuento_total >= 0),
  itbis_total numeric(20,4) NOT NULL CHECK (itbis_total >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  estado text NOT NULL CHECK (estado IN ('pendiente', 'pagada', 'anulada')),
  metodo_pago text NOT NULL CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'credito')),
  notas text,
  motivo_anulacion text,
  anulada_at timestamptz,
  anulada_por uuid,
  pagada_at timestamptz,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT factura_numero_unique UNIQUE (tenant_id, numero),
  CONSTRAINT factura_client_uuid_unique UNIQUE (tenant_id, client_uuid),
  CONSTRAINT factura_anulada_motivo CHECK (estado <> 'anulada' OR (motivo_anulacion IS NOT NULL AND anulada_at IS NOT NULL)),
  CONSTRAINT factura_credito_vence CHECK (metodo_pago <> 'credito' OR fecha_vencimiento IS NOT NULL),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES app.cliente (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS factura_ncf_uidx ON app.factura (tenant_id, ncf) WHERE ncf IS NOT NULL;
CREATE INDEX IF NOT EXISTS factura_tenant_fecha_idx ON app.factura (tenant_id, fecha_emision DESC);
ALTER TABLE app.factura ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.factura FORCE ROW LEVEL SECURITY;
CREATE POLICY factura_tenant ON app.factura
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.factura TO facilito_app;
REVOKE DELETE ON app.factura FROM facilito_app;

CREATE TABLE IF NOT EXISTS app.factura_linea (
  tenant_id uuid NOT NULL,
  factura_id uuid NOT NULL,
  linea int NOT NULL CHECK (linea > 0),
  producto_id uuid NOT NULL,
  descripcion text NOT NULL,
  cantidad numeric(20,4) NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(20,4) NOT NULL CHECK (precio_unitario >= 0),
  descuento numeric(20,4) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  itbis_tasa numeric(8,4) NOT NULL CHECK (itbis_tasa >= 0),
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  itbis numeric(20,4) NOT NULL CHECK (itbis >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  PRIMARY KEY (tenant_id, factura_id, linea),
  FOREIGN KEY (tenant_id, factura_id) REFERENCES app.factura (tenant_id, id),
  FOREIGN KEY (tenant_id, producto_id) REFERENCES app.producto (tenant_id, id)
);
ALTER TABLE app.factura_linea ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.factura_linea FORCE ROW LEVEL SECURITY;
CREATE POLICY factura_linea_tenant ON app.factura_linea
  FOR ALL USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON app.factura_linea TO facilito_app;

-- Password reset tokens (hashed, single use)
CREATE TABLE IF NOT EXISTS identity.password_reset (
  id uuid PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES identity.persona(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE identity.password_reset ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.password_reset FORCE ROW LEVEL SECURITY;
CREATE POLICY password_reset_bootstrap ON identity.password_reset
  FOR ALL USING (current_setting('app.auth_bootstrap', true) = '1')
  WITH CHECK (current_setting('app.auth_bootstrap', true) = '1');
GRANT SELECT, INSERT, UPDATE ON identity.password_reset TO facilito_app;

-- Append-only guard on every leaf partition of the audit log
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT relid FROM pg_partition_tree('audit.bitacora') WHERE isleaf LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bitacora_no_update ON %s', r.relid::regclass);
    EXECUTE format(
      'CREATE TRIGGER bitacora_no_update BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation()',
      r.relid::regclass);
  END LOOP;
END $$;

COMMIT;
