'use client';

import { useState } from 'react';
import { CalendarClock, CreditCard, Download, Lock, Receipt, Send, Undo2 } from 'lucide-react';
import { api, apiBlob, downloadBlob, errorMessage, refreshSession, type SubscriptionState } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { instantLong, dateShort } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { BankCard, dop, ReceiptPicker, StateBadge, type BankInstructions } from '@/components/billing/billing-ui';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Skeleton, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface MySubscription {
  suscripcion: {
    id: string;
    estado: SubscriptionState;
    planId: string;
    plan: string;
    limites: { maxUsuarios: number; maxProductos: number | null; copilot: boolean } | null;
    montoCentavos: number;
    moneda: string;
    periodoFin: string | null;
    cancelarAlFinal: boolean;
    soloLectura: boolean;
  } | null;
  pagos: Array<{
    id: string;
    tipo: 'cobro' | 'reembolso';
    montoCentavos: number;
    moneda: string;
    metodo: string;
    referencia: string | null;
    periodoInicio: string | null;
    periodoFin: string | null;
    fecha: string;
  }>;
  comprobantes: Array<{ id: string; fecha: string; estado: 'pendiente' | 'aprobado' | 'rechazado'; motivo: string | null }>;
  instrucciones: BankInstructions | null;
}

const RECEIPT_TONE = { pendiente: 'orange', aprobado: 'green', rechazado: 'red' } as const;
const RECEIPT_LABEL = { pendiente: 'En revisión', aprobado: 'Aprobado', rechazado: 'Rechazado' } as const;

function stateMessage(s: NonNullable<MySubscription['suscripcion']>): string {
  const fin = s.periodoFin ? instantLong(s.periodoFin) : null;
  switch (s.estado) {
    case 'ACTIVA':
      return s.cancelarAlFinal ? `Se cancela el ${fin}. Hasta entonces todo sigue funcionando.` : `Pagado hasta el ${fin}.`;
    case 'EN_GRACIA':
      return `Tu plan venció el ${fin}. Tienes 7 días de gracia con todo funcionando: sube el comprobante de la renovación.`;
    case 'SUSPENDIDA':
      return 'La cuenta está en solo lectura: puedes ver y exportar tus datos, pero no registrar ventas nuevas. Renueva para reactivarla.';
    case 'CANCELADA':
      return 'La suscripción terminó. Tus datos se conservan en solo lectura. Escríbenos si quieres volver.';
    default:
      return '';
  }
}

export default function SubscriptionPage() {
  const { can, user } = useAuth();
  const allowed = can(ROLES.admin);
  const data = useAsync(() => (allowed ? api<MySubscription>('/v1/billing/mi-suscripcion') : Promise.resolve(undefined)), [allowed, user?.tenantId]);

  if (!allowed) {
    return (
      <div className="card">
        <EmptyState icon={<Lock size={26} />} title="Acceso restringido" detail="Solo el dueño o un gerente pueden ver la suscripción del negocio." />
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Suscripción</h1>
          <p>Tu plan, tus pagos y los recibos de Facilito.</p>
        </div>
      </div>
      {data.error ? (
        <div className="card">
          <ErrorState error={data.error} onRetry={data.reload} />
        </div>
      ) : !data.data ? (
        <div className="stack">
          <Skeleton h={160} r={16} />
          <Skeleton h={240} r={16} />
        </div>
      ) : !data.data.suscripcion ? (
        <div className="card">
          <EmptyState
            icon={<CreditCard size={26} />}
            title="Tu negocio aún no tiene un plan asignado"
            detail="Tu cuenta es de antes de los planes de pago y sigue funcionando completa. Te avisaremos antes de cualquier cambio."
          />
        </div>
      ) : (
        <SubscriptionView data={data.data} sub={data.data.suscripcion} onChanged={data.reload} />
      )}
    </>
  );
}

function SubscriptionView({ data, sub, onChanged }: { data: MySubscription; sub: NonNullable<MySubscription['suscripcion']>; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const owner = can(ROLES.owner);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = data.comprobantes.filter((c) => c.estado === 'pendiente').length;
  const canRenew = sub.estado !== 'CANCELADA';
  const canCancel = owner && (sub.estado === 'ACTIVA' || sub.estado === 'EN_GRACIA');

  const toggleCancel = async () => {
    setBusy(true);
    try {
      await api('/v1/billing/mi-suscripcion/cancelacion', { method: 'POST', body: { cancelar: !sub.cancelarAlFinal } });
      toast.success(sub.cancelarAlFinal ? 'Cancelación revertida' : 'Cancelación programada', sub.cancelarAlFinal ? 'Tu plan se renovará normalmente.' : 'Seguirás usando Facilito hasta el fin del periodo pagado.');
      setCancelOpen(false);
      await refreshSession();
      onChanged();
    } catch (e) {
      toast.error('No se pudo guardar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sub-grid">
      <section className="card stack" aria-labelledby="plan-title">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h2 id="plan-title" style={{ fontSize: '1.15rem' }}>
            Plan {sub.plan}
          </h2>
          <StateBadge estado={sub.estado} />
        </div>
        <strong style={{ fontSize: '1.6rem' }}>
          {dop(sub.montoCentavos, sub.moneda)} <span className="muted" style={{ fontSize: '0.95rem', fontWeight: 500 }}>/ mes</span>
        </strong>
        <p className={`form-alert ${sub.estado === 'ACTIVA' && !sub.cancelarAlFinal ? 'info' : 'warn'}`} role="status">
          <CalendarClock size={18} aria-hidden /> <span>{stateMessage(sub)}</span>
        </p>
        {sub.limites && (
          <ul className="sub-limits">
            <li>Hasta {sub.limites.maxUsuarios} usuarios</li>
            <li>{sub.limites.maxProductos ? `Hasta ${sub.limites.maxProductos.toLocaleString('es-DO')} productos` : 'Productos ilimitados'}</li>
            <li>{sub.limites.copilot ? 'Asistente Copilot incluido' : 'Sin asistente Copilot'}</li>
          </ul>
        )}
        {canCancel && (
          <button type="button" className={`btn ${sub.cancelarAlFinal ? 'btn-outline' : 'btn-ghost'}`} onClick={() => setCancelOpen(true)}>
            {sub.cancelarAlFinal ? (
              <>
                <Undo2 size={16} aria-hidden /> No cancelar, seguir con mi plan
              </>
            ) : (
              'Cancelar al final del periodo'
            )}
          </button>
        )}
      </section>

      {canRenew && <RenewCard data={data} sub={sub} pending={pending} onUploaded={onChanged} />}

      <section className="card" aria-labelledby="payments-title" style={{ gridColumn: '1 / -1' }}>
        <h2 id="payments-title" style={{ fontSize: '1.1rem', marginBottom: 12 }}>
          Pagos y recibos
        </h2>
        {data.pagos.length === 0 ? (
          <EmptyState icon={<Receipt size={26} />} title="Sin pagos registrados" />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Periodo</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th>
                    <span className="sr-only">Recibo</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.pagos.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Fecha">{dateShort(p.fecha)}</td>
                    <td data-label="Concepto">
                      {p.tipo === 'cobro' ? 'Pago de suscripción' : <Badge tone="purple">Reembolso</Badge>}
                      {p.referencia && p.tipo === 'cobro' && <div className="muted" style={{ fontSize: '0.8rem' }}>Ref. {p.referencia}</div>}
                    </td>
                    <td data-label="Periodo">{p.periodoInicio && p.periodoFin ? `${dateShort(p.periodoInicio)} – ${dateShort(p.periodoFin)}` : '—'}</td>
                    <td data-label="Monto" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {p.tipo === 'reembolso' ? '−' : ''}
                      {dop(p.montoCentavos, p.moneda)}
                    </td>
                    <td className="td-actions">
                      <ReceiptButton id={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 12 }}>
          Los recibos de Facilito confirman tu pago de la suscripción. No son comprobantes fiscales.
        </p>
      </section>

      {data.comprobantes.length > 0 && (
        <section className="card" aria-labelledby="receipts-title" style={{ gridColumn: '1 / -1' }}>
          <h2 id="receipts-title" style={{ fontSize: '1.1rem', marginBottom: 12 }}>
            Comprobantes enviados
          </h2>
          <ul className="receipt-list">
            {data.comprobantes.map((c) => (
              <li key={c.id}>
                <span>{dateShort(c.fecha)}</span>
                <Badge tone={RECEIPT_TONE[c.estado]}>{RECEIPT_LABEL[c.estado]}</Badge>
                {c.motivo && <span className="muted">{c.motivo}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title={sub.cancelarAlFinal ? 'Seguir con tu plan' : 'Cancelar suscripción'}
        message={
          sub.cancelarAlFinal
            ? 'Tu plan se renovará normalmente al final del periodo.'
            : `Seguirás usando Facilito hasta el ${sub.periodoFin ? instantLong(sub.periodoFin) : 'fin del periodo'}. Después la cuenta queda en solo lectura y tus datos se conservan.`
        }
        confirmLabel={sub.cancelarAlFinal ? 'Seguir con mi plan' : 'Sí, cancelar al final'}
        tone={sub.cancelarAlFinal ? 'primary' : 'danger'}
        busy={busy}
        onConfirm={toggleCancel}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}

function ReceiptButton({ id }: { id: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      downloadBlob(await apiBlob(`/v1/billing/recibos/${id}`), `recibo-facilito-${id.slice(-8)}.pdf`);
    } catch (e) {
      toast.error('No se pudo descargar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={busy} aria-label="Descargar recibo en PDF">
      {busy ? <Spinner size={16} /> : <Download size={16} aria-hidden />} Recibo
    </button>
  );
}

function RenewCard({ data, sub, pending, onUploaded }: { data: MySubscription; sub: NonNullable<MySubscription['suscripcion']>; pending: number; onUploaded: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const monto = dop(sub.montoCentavos, sub.moneda);

  const send = async () => {
    if (!file) return setError('Elige la foto o el PDF del comprobante.');
    setBusy(true);
    setError(undefined);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      await api('/v1/billing/mi-suscripcion/comprobante', { method: 'POST', body: fd });
      toast.success('Comprobante enviado', 'Te avisaremos cuando lo verifiquemos.');
      setFile(null);
      onUploaded();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="renew-title">
      <h2 id="renew-title" style={{ fontSize: '1.1rem' }}>
        Renovar o pagar
      </h2>
      {pending > 0 && (
        <p className="form-alert info" role="status">
          <span>
            Tienes {pending === 1 ? 'un comprobante' : `${pending} comprobantes`} en revisión. Te avisamos al confirmarlo.
          </span>
        </p>
      )}
      <p className="muted">Transfiere {monto} y sube el comprobante. El nuevo mes empieza cuando termine el que ya pagaste.</p>
      {data.instrucciones ? <BankCard banco={data.instrucciones} monto={monto} /> : <p className="muted">Escríbenos para recibir los datos bancarios.</p>}
      <ReceiptPicker
        file={file}
        error={error}
        disabled={busy}
        onChange={(f, err) => {
          setFile(f);
          setError(err);
        }}
      />
      <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !file}>
        {busy ? <Spinner size={16} /> : <Send size={16} aria-hidden />} Enviar comprobante
      </button>
    </section>
  );
}
