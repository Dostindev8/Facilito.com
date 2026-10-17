-- Allow platform admins to re-seed launch plans (INSERT) and audit the action.
BEGIN;

ALTER TABLE audit.platform_log DROP CONSTRAINT IF EXISTS platform_log_action_check;
ALTER TABLE audit.platform_log ADD CONSTRAINT platform_log_action_check CHECK (action IN (
  'persona.block', 'persona.unblock', 'persona.sesiones', 'negocio.suspend', 'negocio.reactivate',
  'suscripcion.autorizar', 'suscripcion.rechazar', 'suscripcion.reenviar', 'suscripcion.pago', 'suscripcion.reembolso',
  'suscripcion.plan', 'suscripcion.suspender', 'suscripcion.reactivar', 'suscripcion.cancelar', 'suscripcion.asignar',
  'suscripcion.comprobante', 'suscripcion.barrido', 'billing.planes_seed'
));

DROP POLICY IF EXISTS plan_platform_insert ON billing.plan;
CREATE POLICY plan_platform_insert ON billing.plan
  FOR INSERT WITH CHECK (app.is_platform_admin());
GRANT INSERT ON billing.plan TO facilito_app;

COMMIT;
