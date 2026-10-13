-- Paid access: plans, subscriptions with an explicit state machine, an append-only payment ledger, single-use
-- invitations and webhook idempotency. Expand-only: existing businesses have no subscription row and keep working
-- as "legacy active" until a plan is assigned from the admin panel.
--
-- Access model (RLS forced on every table):
--   * public checkout, invitation acceptance, webhooks and the renewal sweep run in the system context
--     (app.auth_bootstrap = '1'), the same one registration and login already use;
--   * platform admins (app.is_platform_admin()) read and update everything, never delete;
--   * a business reads only its own subscription, payments and history.
BEGIN;

CREATE SCHEMA IF NOT EXISTS billing;
GRANT USAGE ON SCHEMA billing TO facilito_app, facilito_master, facilito_migrator;

CREATE OR REPLACE FUNCTION billing.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION billing.is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT current_setting('app.auth_bootstrap', true) = '1' $$;
GRANT EXECUTE ON FUNCTION billing.is_system() TO facilito_app;

/* ───────────── Plans ───────────── */
CREATE TABLE IF NOT EXISTS billing.plan (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 60),
  descripcion text NOT NULL CHECK (char_length(descripcion) <= 300),
  precio_mensual_centavos bigint NOT NULL CHECK (precio_mensual_centavos >= 0),
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  max_usuarios integer NOT NULL CHECK (max_usuarios > 0),
  max_productos integer CHECK (max_productos IS NULL OR max_productos > 0),
  copilot boolean NOT NULL DEFAULT false,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Proposed launch prices (owner must confirm, see docs/audit/DECISIONES_PENDIENTES.md). Editable without a deploy.
INSERT INTO billing.plan (id, nombre, descripcion, precio_mensual_centavos, max_usuarios, max_productos, copilot, orden) VALUES
  ('inicial', 'Inicial', 'Ventas, facturación, inventario y reportes para un negocio que empieza.', 69000, 2, 500, false, 1),
  ('profesional', 'Profesional', 'Todo lo de Inicial con más usuarios, más productos y el asistente Copilot.', 149000, 5, 5000, true, 2),
  ('negocio', 'Negocio', 'Para negocios con varios empleados: productos ilimitados y prioridad en soporte.', 249000, 15, NULL, true, 3)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE billing.plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.plan FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_read ON billing.plan;
CREATE POLICY plan_read ON billing.plan FOR SELECT USING (true);
DROP POLICY IF EXISTS plan_platform_update ON billing.plan;
CREATE POLICY plan_platform_update ON billing.plan
  FOR UPDATE USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
GRANT SELECT, UPDATE ON billing.plan TO facilito_app;

/* ───────────── Subscriptions ───────────── */
CREATE TABLE IF NOT EXISTS billing.suscripcion (
  id uuid PRIMARY KEY,
  plan_id text NOT NULL REFERENCES billing.plan(id),
  estado text NOT NULL CHECK (estado IN
    ('PENDIENTE_PAGO', 'PENDIENTE_AUTORIZACION', 'ACTIVA', 'EN_GRACIA', 'SUSPENDIDA', 'CANCELADA', 'RECHAZADA')),
  metodo_pago text NOT NULL CHECK (metodo_pago IN ('transferencia', 'tarjeta')),
  proveedor text NOT NULL DEFAULT 'manual' CHECK (char_length(proveedor) <= 30),
  proveedor_ref text CHECK (char_length(proveedor_ref) <= 120),
  nombre_contacto text NOT NULL CHECK (char_length(nombre_contacto) BETWEEN 2 AND 120),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  telefono text CHECK (char_length(telefono) <= 30),
  razon_social text NOT NULL CHECK (char_length(razon_social) BETWEEN 2 AND 200),
  rnc_enc text NOT NULL,
  rnc_hash text NOT NULL,
  tipo_negocio text CHECK (char_length(tipo_negocio) <= 80),
  referencia_pago text CHECK (char_length(referencia_pago) <= 120),
  monto_centavos bigint NOT NULL CHECK (monto_centavos >= 0),
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  motivo text CHECK (char_length(motivo) <= 500),
  tenant_id uuid REFERENCES app.negocio(id),
  persona_id uuid REFERENCES identity.persona(id),
  periodo_fin timestamptz,
  cancelar_al_final boolean NOT NULL DEFAULT false,
  autorizada_por uuid REFERENCES identity.persona(id),
  autorizada_at timestamptz,
  solicitante_ip text CHECK (char_length(solicitante_ip) <= 64),
  -- Lets the anonymous applicant upload the receipt and follow the request without an account.
  acceso_token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suscripcion_activa_tiene_negocio CHECK (
    estado IN ('PENDIENTE_PAGO', 'PENDIENTE_AUTORIZACION', 'RECHAZADA')
    OR (estado = 'CANCELADA' AND tenant_id IS NULL)
    OR (tenant_id IS NOT NULL AND periodo_fin IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS suscripcion_tenant_uidx ON billing.suscripcion (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS suscripcion_email_abierta_uidx ON billing.suscripcion (lower(email))
  WHERE estado IN ('PENDIENTE_PAGO', 'PENDIENTE_AUTORIZACION');
CREATE UNIQUE INDEX IF NOT EXISTS suscripcion_rnc_abierta_uidx ON billing.suscripcion (rnc_hash)
  WHERE estado IN ('PENDIENTE_PAGO', 'PENDIENTE_AUTORIZACION');
CREATE UNIQUE INDEX IF NOT EXISTS suscripcion_proveedor_ref_uidx ON billing.suscripcion (proveedor, proveedor_ref)
  WHERE proveedor_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS suscripcion_estado_idx ON billing.suscripcion (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS suscripcion_periodo_idx ON billing.suscripcion (periodo_fin) WHERE estado IN ('ACTIVA', 'EN_GRACIA');

ALTER TABLE billing.suscripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.suscripcion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suscripcion_system ON billing.suscripcion;
CREATE POLICY suscripcion_system ON billing.suscripcion FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS suscripcion_platform ON billing.suscripcion;
CREATE POLICY suscripcion_platform ON billing.suscripcion
  FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
DROP POLICY IF EXISTS suscripcion_tenant_read ON billing.suscripcion;
CREATE POLICY suscripcion_tenant_read ON billing.suscripcion FOR SELECT USING (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON billing.suscripcion TO facilito_app;

/* ───────────── Transfer receipts uploaded at checkout ───────────── */
CREATE TABLE IF NOT EXISTS billing.comprobante (
  id uuid PRIMARY KEY,
  suscripcion_id uuid NOT NULL REFERENCES billing.suscripcion(id),
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  datos bytea NOT NULL CHECK (octet_length(datos) BETWEEN 1 AND 5242880),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comprobante_suscripcion_idx ON billing.comprobante (suscripcion_id);
ALTER TABLE billing.comprobante ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.comprobante FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comprobante_system ON billing.comprobante;
CREATE POLICY comprobante_system ON billing.comprobante FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS comprobante_platform_read ON billing.comprobante;
CREATE POLICY comprobante_platform_read ON billing.comprobante FOR SELECT USING (app.is_platform_admin());
GRANT SELECT, INSERT ON billing.comprobante TO facilito_app;
DROP TRIGGER IF EXISTS comprobante_no_update ON billing.comprobante;
CREATE TRIGGER comprobante_no_update BEFORE UPDATE OR DELETE ON billing.comprobante
  FOR EACH ROW EXECUTE FUNCTION billing.reject_mutation();
DROP POLICY IF EXISTS comprobante_tenant_read ON billing.comprobante;
CREATE POLICY comprobante_tenant_read ON billing.comprobante FOR SELECT USING (
  EXISTS (SELECT 1 FROM billing.suscripcion s WHERE s.id = suscripcion_id AND s.tenant_id = app.current_tenant_id())
);
DROP POLICY IF EXISTS comprobante_tenant_insert ON billing.comprobante;
CREATE POLICY comprobante_tenant_insert ON billing.comprobante FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM billing.suscripcion s WHERE s.id = suscripcion_id AND s.tenant_id = app.current_tenant_id())
);

/* A receipt is reviewed once; the review is a separate append-only row so the receipt itself never changes. */
CREATE TABLE IF NOT EXISTS billing.comprobante_revision (
  comprobante_id uuid PRIMARY KEY REFERENCES billing.comprobante(id),
  resultado text NOT NULL CHECK (resultado IN ('aprobado', 'rechazado')),
  motivo text CHECK (char_length(motivo) <= 500),
  revisado_por uuid NOT NULL REFERENCES identity.persona(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE billing.comprobante_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.comprobante_revision FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revision_platform ON billing.comprobante_revision;
CREATE POLICY revision_platform ON billing.comprobante_revision
  FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
DROP POLICY IF EXISTS revision_system ON billing.comprobante_revision;
CREATE POLICY revision_system ON billing.comprobante_revision
  FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS revision_tenant_read ON billing.comprobante_revision;
CREATE POLICY revision_tenant_read ON billing.comprobante_revision FOR SELECT USING (
  EXISTS (SELECT 1 FROM billing.comprobante c JOIN billing.suscripcion s ON s.id = c.suscripcion_id
           WHERE c.id = comprobante_id AND s.tenant_id = app.current_tenant_id())
);
GRANT SELECT, INSERT ON billing.comprobante_revision TO facilito_app;
DROP TRIGGER IF EXISTS revision_no_update ON billing.comprobante_revision;
CREATE TRIGGER revision_no_update BEFORE UPDATE OR DELETE ON billing.comprobante_revision
  FOR EACH ROW EXECUTE FUNCTION billing.reject_mutation();

/* ───────────── Payment ledger (append-only; refunds are new rows) ───────────── */
CREATE TABLE IF NOT EXISTS billing.pago (
  id uuid PRIMARY KEY,
  suscripcion_id uuid NOT NULL REFERENCES billing.suscripcion(id),
  tipo text NOT NULL CHECK (tipo IN ('cobro', 'reembolso')),
  monto_centavos bigint NOT NULL CHECK (monto_centavos > 0),
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  metodo text NOT NULL CHECK (metodo IN ('transferencia', 'tarjeta', 'efectivo', 'otro')),
  referencia text CHECK (char_length(referencia) <= 120),
  proveedor text NOT NULL DEFAULT 'manual',
  proveedor_evento_id text CHECK (char_length(proveedor_evento_id) <= 200),
  plan_id text NOT NULL REFERENCES billing.plan(id),
  periodo_inicio timestamptz,
  periodo_fin timestamptz,
  comprobante_id uuid REFERENCES billing.comprobante(id),
  registrado_por uuid REFERENCES identity.persona(id),
  nota text CHECK (char_length(nota) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pago_proveedor_evento_uidx ON billing.pago (proveedor, proveedor_evento_id)
  WHERE proveedor_evento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pago_suscripcion_idx ON billing.pago (suscripcion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pago_created_idx ON billing.pago (created_at DESC);
ALTER TABLE billing.pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.pago FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pago_system ON billing.pago;
CREATE POLICY pago_system ON billing.pago FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS pago_platform ON billing.pago;
CREATE POLICY pago_platform ON billing.pago FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
DROP POLICY IF EXISTS pago_tenant_read ON billing.pago;
CREATE POLICY pago_tenant_read ON billing.pago FOR SELECT USING (
  EXISTS (SELECT 1 FROM billing.suscripcion s WHERE s.id = suscripcion_id AND s.tenant_id = app.current_tenant_id())
);
GRANT SELECT, INSERT ON billing.pago TO facilito_app;
DROP TRIGGER IF EXISTS pago_no_update ON billing.pago;
CREATE TRIGGER pago_no_update BEFORE UPDATE OR DELETE ON billing.pago
  FOR EACH ROW EXECUTE FUNCTION billing.reject_mutation();

/* ───────────── State history (append-only) ───────────── */
CREATE TABLE IF NOT EXISTS billing.evento (
  id uuid PRIMARY KEY,
  suscripcion_id uuid NOT NULL REFERENCES billing.suscripcion(id),
  evento text NOT NULL CHECK (char_length(evento) <= 40),
  de text,
  a text NOT NULL,
  actor_id uuid REFERENCES identity.persona(id),
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text CHECK (char_length(ip) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evento_suscripcion_idx ON billing.evento (suscripcion_id, created_at DESC);
ALTER TABLE billing.evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.evento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evento_system ON billing.evento;
CREATE POLICY evento_system ON billing.evento FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS evento_platform ON billing.evento;
CREATE POLICY evento_platform ON billing.evento FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
DROP POLICY IF EXISTS evento_tenant_read ON billing.evento;
CREATE POLICY evento_tenant_read ON billing.evento FOR SELECT USING (
  EXISTS (SELECT 1 FROM billing.suscripcion s WHERE s.id = suscripcion_id AND s.tenant_id = app.current_tenant_id())
);
GRANT SELECT, INSERT ON billing.evento TO facilito_app;
DROP TRIGGER IF EXISTS evento_no_update ON billing.evento;
CREATE TRIGGER evento_no_update BEFORE UPDATE OR DELETE ON billing.evento
  FOR EACH ROW EXECUTE FUNCTION billing.reject_mutation();

/* ───────────── Webhook idempotency ───────────── */
CREATE TABLE IF NOT EXISTS billing.webhook_evento (
  proveedor text NOT NULL CHECK (char_length(proveedor) <= 30),
  evento_id text NOT NULL CHECK (char_length(evento_id) <= 200),
  tipo text NOT NULL CHECK (char_length(tipo) <= 80),
  payload_sha256 text NOT NULL,
  resultado text CHECK (char_length(resultado) <= 200),
  recibido_at timestamptz NOT NULL DEFAULT now(),
  procesado_at timestamptz,
  PRIMARY KEY (proveedor, evento_id)
);
ALTER TABLE billing.webhook_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.webhook_evento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_system ON billing.webhook_evento;
CREATE POLICY webhook_system ON billing.webhook_evento FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS webhook_platform_read ON billing.webhook_evento;
CREATE POLICY webhook_platform_read ON billing.webhook_evento FOR SELECT USING (app.is_platform_admin());
GRANT SELECT, INSERT, UPDATE ON billing.webhook_evento TO facilito_app;

/* ───────────── Single-use invitations ───────────── */
CREATE TABLE IF NOT EXISTS billing.invitacion (
  id uuid PRIMARY KEY,
  suscripcion_id uuid NOT NULL REFERENCES billing.suscripcion(id),
  persona_id uuid NOT NULL REFERENCES identity.persona(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES identity.persona(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitacion_suscripcion_idx ON billing.invitacion (suscripcion_id);
ALTER TABLE billing.invitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.invitacion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitacion_system ON billing.invitacion;
CREATE POLICY invitacion_system ON billing.invitacion FOR ALL USING (billing.is_system()) WITH CHECK (billing.is_system());
DROP POLICY IF EXISTS invitacion_platform ON billing.invitacion;
CREATE POLICY invitacion_platform ON billing.invitacion
  FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
GRANT SELECT, INSERT, UPDATE ON billing.invitacion TO facilito_app;

/* ───────────── Sessions: device hints for the "active sessions" list ───────────── */
ALTER TABLE identity.refresh_token
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS ip text,
  -- The session proved a second factor at login; refresh and tenant switches carry it forward.
  ADD COLUMN IF NOT EXISTS mfa boolean NOT NULL DEFAULT false;
ALTER TABLE identity.refresh_token DROP CONSTRAINT IF EXISTS refresh_token_device_check;
ALTER TABLE identity.refresh_token ADD CONSTRAINT refresh_token_device_check
  CHECK ((user_agent IS NULL OR char_length(user_agent) <= 300) AND (ip IS NULL OR char_length(ip) <= 64));

/* ───────────── Platform audit log: new actions ───────────── */
ALTER TABLE audit.platform_log DROP CONSTRAINT IF EXISTS platform_log_action_check;
ALTER TABLE audit.platform_log ADD CONSTRAINT platform_log_action_check CHECK (action IN (
  'persona.block', 'persona.unblock', 'persona.sesiones', 'negocio.suspend', 'negocio.reactivate',
  'suscripcion.autorizar', 'suscripcion.rechazar', 'suscripcion.reenviar', 'suscripcion.pago', 'suscripcion.reembolso',
  'suscripcion.plan', 'suscripcion.suspender', 'suscripcion.reactivar', 'suscripcion.cancelar', 'suscripcion.asignar',
  'suscripcion.comprobante', 'suscripcion.barrido'
));

COMMIT;
