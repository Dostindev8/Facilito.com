'use client';

import { useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Clock, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { ConfirmDialog, ErrorState, Skeleton, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface Health {
  api: { entorno: string; version: string | null };
  baseDeDatos: { ok: boolean; motor: string; latenciaMs: number; planes: number };
  redis: 'conectado' | 'no_configurado' | 'error';
  correo: 'configurado' | 'no_configurado';
  pagos: { transferencia: boolean; tarjeta: boolean; webhook: boolean };
  cron: { configurado: boolean; ultimoBarridoManual: string | null; ultimoCambioAutomatico: string | null };
}

type Level = 'ok' | 'warn' | 'bad';

function Check({ level, title, children }: { level: Level; title: string; children: ReactNode }) {
  const Icon = level === 'ok' ? CircleCheck : level === 'warn' ? TriangleAlert : CircleX;
  return (
    <li className={`health-item ${level}`}>
      <Icon size={20} aria-hidden />
      <div>
        <strong>
          {title}
          <span className="sr-only">: {level === 'ok' ? 'bien' : level === 'warn' ? 'atención' : 'falla'}</span>
        </strong>
        <span>{children}</span>
      </div>
    </li>
  );
}

export function HealthPanel() {
  const toast = useToast();
  const health = useAsync(() => api<Health>('/v1/platform/health'), []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const sweep = async () => {
    setBusy(true);
    try {
      const r = await api<{ enGracia: number; suspendidas: number; canceladas: number }>('/v1/platform/billing/sweep', { method: 'POST' });
      toast.success('Barrido completado', `${r.enGracia} a gracia · ${r.suspendidas} suspendidas · ${r.canceladas} canceladas`);
      setConfirm(false);
      health.reload();
    } catch (e) {
      toast.error('No se pudo ejecutar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (health.error) return <ErrorState error={health.error} onRetry={health.reload} />;
  if (!health.data) return <Skeleton h={260} />;
  const h = health.data;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ul className="health-list">
        <Check level={h.baseDeDatos.ok ? (h.baseDeDatos.latenciaMs > 800 ? 'warn' : 'ok') : 'bad'} title="Base de datos">
          {h.baseDeDatos.motor} · {h.baseDeDatos.latenciaMs} ms · {h.baseDeDatos.planes} planes cargados
        </Check>
        <Check level={h.redis === 'conectado' ? 'ok' : h.redis === 'error' ? 'bad' : 'warn'} title="Caché y límites (Redis)">
          {h.redis === 'conectado'
            ? 'Conectado: bloqueos de login y límites compartidos entre instancias.'
            : h.redis === 'error'
              ? 'Configurado pero no responde: se usa memoria local por instancia.'
              : 'No configurado: se usa memoria local por instancia (los bloqueos no se comparten).'}
        </Check>
        <Check level={h.correo === 'configurado' ? 'ok' : 'warn'} title="Correo">
          {h.correo === 'configurado' ? 'SMTP configurado: invitaciones, avisos y recibos salen por correo.' : 'Sin SMTP: comparte los enlaces de activación por WhatsApp.'}
        </Check>
        <Check level={h.pagos.transferencia ? 'ok' : 'bad'} title="Pago por transferencia">
          {h.pagos.transferencia ? 'Datos bancarios configurados.' : 'Faltan los datos bancarios (BILLING_BANK_*): el checkout no puede iniciar.'}
        </Check>
        <Check level={h.pagos.tarjeta ? 'ok' : 'warn'} title="Pasarela de tarjeta">
          {h.pagos.tarjeta ? 'Activa.' : 'Desactivada hasta contratar una pasarela disponible en RD.'} Webhook {h.pagos.webhook ? 'con secreto configurado' : 'sin secreto'}.
        </Check>
        <Check level={h.cron.configurado ? 'ok' : 'warn'} title="Renovaciones automáticas (cron diario)">
          {h.cron.configurado ? 'CRON_SECRET configurado.' : 'Sin CRON_SECRET: el barrido diario no corre; el acceso igual aplica la fecha de vencimiento.'}{' '}
          {h.cron.ultimoCambioAutomatico ? `Último cambio automático: ${dateTime(h.cron.ultimoCambioAutomatico)}.` : 'Sin cambios automáticos todavía.'}
        </Check>
      </ul>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        <Clock size={14} aria-hidden /> API {h.api.entorno}
        {h.api.version ? ` · versión ${h.api.version}` : ''}
        {h.cron.ultimoBarridoManual ? ` · último barrido manual ${dateTime(h.cron.ultimoBarridoManual)}` : ''}
      </p>
      <div className="row health-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" onClick={health.reload}>
          <RefreshCw size={16} aria-hidden /> Volver a comprobar
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
          {busy ? <Spinner size={16} /> : null} Ejecutar barrido de vencimientos ahora
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Ejecutar barrido"
        message="Pasa a gracia, suspende o cancela las suscripciones vencidas según su fecha. Es lo mismo que hace el cron diario."
        confirmLabel="Ejecutar"
        busy={busy}
        onConfirm={sweep}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
