'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Ban, CircleCheck, Copy, Eye, FileText, Inbox, MessageCircle, Receipt, RotateCcw, Send, Undo2, XCircle } from 'lucide-react';
import { api, errorMessage, openBlobInTab, type SubscriptionState } from '@/lib/api';
import { dateShort, dateTime, relativeTime } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/hooks';
import { dop, StateBadge, STATE_LABEL } from '@/components/billing/billing-ui';
import { Badge, EmptyState, ErrorState, Modal, Pagination, SelectInput, Skeleton, Spinner, TextArea, TextInput } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { SearchBar } from './search-bar';

interface SubItem {
  id: string;
  estado: SubscriptionState;
  estadoEfectivo: SubscriptionState;
  plan: string;
  planId: string;
  negocio: string;
  contacto: string;
  email: string;
  telefono: string | null;
  montoCentavos: number;
  moneda: string;
  referenciaPago: string | null;
  tenantId: string | null;
  periodoFin: string | null;
  cancelarAlFinal: boolean;
  comprobantes: number;
  comprobantesPendientes: number;
  creada: string;
}

interface SubDetail extends Omit<SubItem, 'plan' | 'comprobantes' | 'comprobantesPendientes'> {
  rnc: string | null;
  tipoNegocio: string | null;
  motivo: string | null;
  eventos: Array<{ id: string; evento: string; de: string | null; a: string; detalle: Record<string, unknown> | null; actor: string | null; fecha: string }>;
  pagos: Array<{ id: string; tipo: 'cobro' | 'reembolso'; montoCentavos: number; metodo: string; referencia: string | null; nota: string | null; fecha: string }>;
  comprobantes: Array<{ id: string; mime: string; bytes: number; fecha: string; estado: 'pendiente' | 'aprobado' | 'rechazado'; motivo: string | null }>;
  invitaciones: Array<{ id: string; creada: string; vence: string; estado: 'usada' | 'reemplazada' | 'vencida' | 'vigente' }>;
}

interface Delivery {
  activationUrl: string;
  emailEnviado: boolean;
  venceEnHoras: number;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface PlanOption {
  id: string;
  nombre: string;
  precioMensualCentavos: number;
}

const EVENT_LABEL: Record<string, string> = {
  solicitud: 'Solicitud creada',
  pago_reportado: 'Comprobante recibido',
  comprobante: 'Otro comprobante recibido',
  autorizar: 'Autorizada',
  rechazar: 'Rechazada',
  invitacion_aceptada: 'El cliente creó su contraseña',
  pago_registrado: 'Pago registrado',
  pago_confirmado: 'Pago confirmado por la pasarela',
  vencimiento: 'Venció el periodo (gracia)',
  fin_gracia: 'Terminó la gracia (solo lectura)',
  suspender: 'Suspendida',
  reactivar: 'Reactivada',
  cancelar: 'Cancelada',
  cancelacion_programada: 'El cliente programó la cancelación',
  cancelacion_revertida: 'El cliente revirtió la cancelación',
  cambio_plan: 'Cambio de plan',
  reembolso: 'Reembolso registrado',
  asignada: 'Plan asignado a negocio existente',
  pago_fallido: 'Pago fallido en la pasarela',
  requiere_reembolso: 'Pago recibido tras rechazo: reembolsar',
  monto_insuficiente: 'Pago con monto insuficiente',
};

const INVITE_TONE = { usada: 'green', vigente: 'blue', vencida: 'gray', reemplazada: 'gray' } as const;
const RECEIPT_TONE = { pendiente: 'orange', aprobado: 'green', rechazado: 'red' } as const;

function whatsappLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 11) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/* ───────────── List ───────────── */

export function SubscriptionsPanel({ queue, onChanged }: { queue?: boolean; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'todos' | SubscriptionState>('todos');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q.trim(), 300);
  const filter = queue ? 'por_revisar' : estado;

  useEffect(() => setPage(1), [dq, filter]);
  const list = useAsync(() => api<Page<SubItem>>('/v1/platform/subscriptions', { query: { q: dq, estado: filter, page, pageSize: 20 } }), [dq, filter, page]);

  const changed = () => {
    list.reload();
    onChanged();
  };

  return (
    <>
      <SearchBar id={queue ? 'admin-queue-q' : 'admin-subs-q'} value={q} onChange={setQ} placeholder="Buscar por negocio, contacto o email">
        {!queue && (
          <SelectInput label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} style={{ minWidth: 200 }}>
            <option value="todos">Todos</option>
            {(Object.keys(STATE_LABEL) as SubscriptionState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_LABEL[s]}
              </option>
            ))}
          </SelectInput>
        )}
      </SearchBar>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton h={240} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<Inbox size={26} />}
          title={queue ? 'Nada pendiente por revisar' : dq || estado !== 'todos' ? 'Sin resultados' : 'Aún no hay suscripciones'}
          detail={queue ? 'Aquí aparecen las solicitudes nuevas con comprobante y las renovaciones por verificar.' : undefined}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Negocio</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>{queue ? 'Recibida' : 'Vence'}</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((s) => (
                  <tr key={s.id}>
                    <td className="td-main" data-label="Negocio">
                      <strong>{s.negocio}</strong>
                      <div className="muted" style={{ overflowWrap: 'anywhere', fontSize: '0.85rem' }}>
                        {s.contacto} · {s.email}
                      </div>
                    </td>
                    <td data-label="Plan">
                      {s.plan}
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {dop(s.montoCentavos, s.moneda)}/mes
                      </div>
                    </td>
                    <td data-label="Estado">
                      <StateBadge estado={s.estadoEfectivo} />
                      {s.comprobantesPendientes > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="orange">
                            {s.comprobantesPendientes} comprobante{s.comprobantesPendientes > 1 ? 's' : ''} por revisar
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td data-label={queue ? 'Recibida' : 'Vence'}>{queue ? relativeTime(s.creada) : s.periodoFin ? dateShort(s.periodoFin) : '—'}</td>
                    <td className="td-actions">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(s.id)} aria-label={`Revisar ${s.negocio}`}>
                        <Eye size={16} aria-hidden /> Revisar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      {open && <SubscriptionDetail id={open} onClose={() => setOpen(null)} onChanged={changed} />}
    </>
  );
}

/* ───────────── Detail + actions ───────────── */

type Action =
  | { kind: 'authorize' }
  | { kind: 'reject' }
  | { kind: 'resend' }
  | { kind: 'payment'; comprobanteId?: string }
  | { kind: 'rejectReceipt'; comprobanteId: string }
  | { kind: 'refund'; pagoId: string; monto: number }
  | { kind: 'plan' }
  | { kind: 'suspend' }
  | { kind: 'reactivate' }
  | { kind: 'cancel' };

function SubscriptionDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => api<SubDetail>(`/v1/platform/subscriptions/${id}`), [id]);
  const [action, setAction] = useState<Action | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const d = detail.data;

  const done = (result?: Delivery) => {
    setAction(null);
    if (result) setDelivery(result);
    detail.reload();
    onChanged();
  };

  const estado = d?.estadoEfectivo;
  const live = estado === 'ACTIVA' || estado === 'EN_GRACIA' || estado === 'SUSPENDIDA';
  const inviteAccepted = d?.invitaciones.some((i) => i.estado === 'usada');
  const pendingReceipts = d?.comprobantes.filter((c) => c.estado === 'pendiente') ?? [];

  return (
    <Modal open onClose={onClose} title={d ? d.negocio : 'Suscripción'} subtitle={d ? `${d.contacto} · ${d.email}` : undefined} size="xl">
      {detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.reload} />
      ) : !d ? (
        <div className="stack">
          <Skeleton h={80} />
          <Skeleton h={200} />
        </div>
      ) : (
        <div className="sub-detail">
          <section className="sub-detail-head">
            <StateBadge estado={d.estadoEfectivo} />
            {d.estado !== d.estadoEfectivo && <span className="muted">(guardado como {STATE_LABEL[d.estado]}; el barrido diario lo actualiza)</span>}
            {d.cancelarAlFinal && <Badge tone="orange">Cancela al final del periodo</Badge>}
          </section>

          <dl className="sub-facts">
            <Fact label="Plan">
              {d.planId} · {dop(d.montoCentavos, d.moneda)}/mes
            </Fact>
            <Fact label="RNC / cédula">{d.rnc || '—'}</Fact>
            <Fact label="Tipo de negocio">{d.tipoNegocio || '—'}</Fact>
            <Fact label="Teléfono">{d.telefono || '—'}</Fact>
            <Fact label="Referencia de pago">{d.referenciaPago || '—'}</Fact>
            <Fact label="Pagado hasta">{d.periodoFin ? dateShort(d.periodoFin) : '—'}</Fact>
            <Fact label="Solicitada">{dateTime(d.creada)}</Fact>
            {d.motivo && <Fact label="Motivo">{d.motivo}</Fact>}
          </dl>

          <div className="sub-actions" role="group" aria-label="Acciones">
            {d.estado === 'PENDIENTE_AUTORIZACION' && (
              <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: 'authorize' })}>
                <CircleCheck size={18} aria-hidden /> Autorizar
              </button>
            )}
            {(d.estado === 'PENDIENTE_AUTORIZACION' || d.estado === 'PENDIENTE_PAGO') && (
              <button type="button" className="btn btn-danger" onClick={() => setAction({ kind: 'reject' })}>
                <XCircle size={18} aria-hidden /> Rechazar
              </button>
            )}
            {d.tenantId && !inviteAccepted && d.invitaciones.length > 0 && (
              <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'resend' })}>
                <Send size={18} aria-hidden /> Reenviar invitación
              </button>
            )}
            {live && (
              <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: 'payment', comprobanteId: pendingReceipts[0]?.id })}>
                <Receipt size={18} aria-hidden /> Registrar pago
              </button>
            )}
            {live && (
              <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'plan' })}>
                Cambiar plan
              </button>
            )}
            {(d.estado === 'ACTIVA' || d.estado === 'EN_GRACIA') && (
              <button type="button" className="btn btn-ghost" onClick={() => setAction({ kind: 'suspend' })}>
                <Ban size={18} aria-hidden /> Suspender
              </button>
            )}
            {d.estado === 'SUSPENDIDA' && (
              <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'reactivate' })}>
                <RotateCcw size={18} aria-hidden /> Reactivar
              </button>
            )}
            {live && (
              <button type="button" className="btn btn-ghost" onClick={() => setAction({ kind: 'cancel' })}>
                Cancelar suscripción
              </button>
            )}
          </div>

          <DetailSection title="Comprobantes">
            {d.comprobantes.length === 0 ? (
              <p className="muted">El cliente no ha subido comprobantes.</p>
            ) : (
              <ul className="receipt-list">
                {d.comprobantes.map((c) => (
                  <li key={c.id}>
                    <span>{dateTime(c.fecha)}</span>
                    <Badge tone={RECEIPT_TONE[c.estado]}>{c.estado}</Badge>
                    <span className="muted">
                      {c.mime === 'application/pdf' ? 'PDF' : 'Imagen'} · {(c.bytes / 1024).toFixed(0)} KB
                    </span>
                    {c.motivo && <span className="muted">{c.motivo}</span>}
                    <span className="receipt-list-actions">
                      <ViewReceipt id={c.id} />
                      {c.estado === 'pendiente' && live && (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAction({ kind: 'payment', comprobanteId: c.id })}>
                            Aprobar
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAction({ kind: 'rejectReceipt', comprobanteId: c.id })}>
                            Rechazar
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          <DetailSection title="Pagos">
            {d.pagos.length === 0 ? (
              <p className="muted">Sin pagos registrados.</p>
            ) : (
              <ul className="receipt-list">
                {d.pagos.map((p) => {
                  const refunded = d.pagos.filter((r) => r.tipo === 'reembolso' && r.referencia === p.id).reduce((a, r) => a + r.montoCentavos, 0);
                  const left = p.montoCentavos - refunded;
                  return (
                    <li key={p.id}>
                      <span>{dateShort(p.fecha)}</span>
                      {p.tipo === 'reembolso' ? <Badge tone="purple">Reembolso</Badge> : <Badge tone="green">Cobro</Badge>}
                      <strong>
                        {p.tipo === 'reembolso' ? '−' : ''}
                        {dop(p.montoCentavos, d.moneda)}
                      </strong>
                      <span className="muted">
                        {p.metodo}
                        {p.tipo === 'cobro' && p.referencia ? ` · ${p.referencia}` : ''}
                        {p.nota ? ` · ${p.nota}` : ''}
                      </span>
                      <span className="receipt-list-actions">
                        <OpenFile path={`/v1/platform/payments/${p.id}/receipt`} label="Recibo" aria="Ver recibo en PDF" icon={<FileText size={16} aria-hidden />} />
                        {p.tipo === 'cobro' && left > 0 && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAction({ kind: 'refund', pagoId: p.id, monto: left })}>
                            <Undo2 size={16} aria-hidden /> Reembolsar
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </DetailSection>

          {d.invitaciones.length > 0 && (
            <DetailSection title="Invitaciones">
              <ul className="receipt-list">
                {d.invitaciones.map((i) => (
                  <li key={i.id}>
                    <span>{dateTime(i.creada)}</span>
                    <Badge tone={INVITE_TONE[i.estado]}>{i.estado}</Badge>
                    <span className="muted">vence {dateTime(i.vence)}</span>
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          <DetailSection title="Historial">
            <ol className="sub-timeline">
              {d.eventos.map((e) => (
                <li key={e.id}>
                  <strong>{EVENT_LABEL[e.evento] ?? e.evento}</strong>
                  <span className="muted">
                    {dateTime(e.fecha)} · {e.actor ?? 'Sistema / cliente'}
                    {e.de && e.de !== e.a ? ` · ${STATE_LABEL[e.de as SubscriptionState] ?? e.de} → ${STATE_LABEL[e.a as SubscriptionState] ?? e.a}` : ''}
                    {typeof e.detalle?.motivo === 'string' ? ` · ${e.detalle.motivo}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </DetailSection>
        </div>
      )}

      {d && action && <ActionModal sub={d} action={action} onClose={() => setAction(null)} onDone={done} />}
      {d && delivery && <DeliveryModal sub={d} delivery={delivery} onClose={() => setDelivery(null)} />}
    </Modal>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sub-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function OpenFile({ path, label, aria, icon }: { path: string; label: string; aria: string; icon: ReactNode }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const view = async () => {
    setBusy(true);
    try {
      await openBlobInTab(path);
    } catch (e) {
      toast.error('No se pudo abrir', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={view} disabled={busy} aria-label={aria}>
      {busy ? <Spinner size={16} /> : icon} {label}
    </button>
  );
}

function ViewReceipt({ id }: { id: string }) {
  return <OpenFile path={`/v1/platform/receipts/${id}`} label="Ver" aria="Ver comprobante" icon={<Eye size={16} aria-hidden />} />;
}

/* ───────────── Action dialogs: every one needs an explicit confirmation ───────────── */

const ACTION_COPY: Record<Action['kind'], { title: string; confirm: string; tone: 'primary' | 'danger' }> = {
  authorize: { title: 'Autorizar suscripción', confirm: 'Autorizar y crear cuenta', tone: 'primary' },
  reject: { title: 'Rechazar solicitud', confirm: 'Rechazar', tone: 'danger' },
  resend: { title: 'Reenviar invitación', confirm: 'Generar enlace nuevo', tone: 'primary' },
  payment: { title: 'Registrar pago', confirm: 'Registrar pago', tone: 'primary' },
  rejectReceipt: { title: 'Rechazar comprobante', confirm: 'Rechazar comprobante', tone: 'danger' },
  refund: { title: 'Registrar reembolso', confirm: 'Registrar reembolso', tone: 'danger' },
  plan: { title: 'Cambiar plan', confirm: 'Cambiar plan', tone: 'primary' },
  suspend: { title: 'Suspender suscripción', confirm: 'Suspender', tone: 'danger' },
  reactivate: { title: 'Reactivar suscripción', confirm: 'Reactivar', tone: 'primary' },
  cancel: { title: 'Cancelar suscripción', confirm: 'Cancelar suscripción', tone: 'danger' },
};

function ActionModal({ sub, action, onClose, onDone }: { sub: SubDetail; action: Action; onClose: () => void; onDone: (d?: Delivery) => void }) {
  const toast = useToast();
  const copy = ACTION_COPY[action.kind];
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState(sub.referenciaPago ?? '');
  const [nota, setNota] = useState('');
  const [monto, setMonto] = useState(() => ((action.kind === 'refund' ? action.monto : sub.montoCentavos) / 100).toFixed(2));
  const [metodo, setMetodo] = useState('transferencia');
  const [planId, setPlanId] = useState(sub.planId);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plans = useAsync(() => (action.kind === 'plan' ? api<{ items: PlanOption[] }>('/v1/billing/plans') : Promise.resolve(undefined)), [action.kind]);

  const needsReason = ['reject', 'rejectReceipt', 'refund', 'suspend', 'reactivate', 'cancel'].includes(action.kind);
  const needsAmount = action.kind === 'payment' || action.kind === 'refund';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsReason && motivo.trim().length < 3) return setError('Escribe el motivo (mínimo 3 caracteres).');
    const cents = Math.round(Number(monto.replace(/,/g, '')) * 100);
    if (needsAmount && (!Number.isFinite(cents) || cents <= 0)) return setError('Escribe un monto válido.');
    if (!confirmed) return setError('Marca la casilla para confirmar.');
    const base = `/v1/platform/subscriptions/${sub.id}`;
    const body = { confirmar: true as const };
    setBusy(true);
    try {
      switch (action.kind) {
        case 'authorize': {
          const r = await api<Delivery>(`${base}/authorize`, { method: 'POST', body: { ...body, ...(referencia.trim() ? { referencia: referencia.trim() } : {}), ...(nota.trim() ? { nota: nota.trim() } : {}) } });
          toast.success('Suscripción autorizada', 'La cuenta quedó creada. Envía el enlace de activación.');
          return onDone(r);
        }
        case 'resend': {
          const r = await api<Delivery>(`${base}/resend-invitation`, { method: 'POST', body });
          toast.success('Enlace nuevo generado', 'El enlace anterior ya no funciona.');
          return onDone(r);
        }
        case 'reject':
          await api(`${base}/reject`, { method: 'POST', body: { ...body, motivo: motivo.trim() } });
          toast.success('Solicitud rechazada', 'Le avisamos al cliente por correo si está configurado.');
          break;
        case 'payment':
          await api(`${base}/payments`, {
            method: 'POST',
            body: {
              ...body,
              montoCentavos: cents,
              metodo,
              ...(referencia.trim() ? { referencia: referencia.trim() } : {}),
              ...(action.comprobanteId ? { comprobanteId: action.comprobanteId } : {}),
              ...(nota.trim() ? { nota: nota.trim() } : {}),
            },
          });
          toast.success('Pago registrado', 'El periodo se extendió un mes.');
          break;
        case 'rejectReceipt':
          await api(`/v1/platform/receipts/${action.comprobanteId}/reject`, { method: 'POST', body: { ...body, motivo: motivo.trim() } });
          toast.success('Comprobante rechazado');
          break;
        case 'refund':
          await api(`${base}/refunds`, { method: 'POST', body: { ...body, pagoId: action.pagoId, montoCentavos: cents, motivo: motivo.trim() } });
          toast.success('Reembolso registrado', 'Recuerda hacer la transferencia de vuelta al cliente.');
          break;
        case 'plan':
          await api(`${base}/plan`, { method: 'POST', body: { ...body, planId } });
          toast.success('Plan cambiado', 'El precio nuevo aplica desde la próxima renovación.');
          break;
        case 'suspend':
        case 'reactivate':
        case 'cancel':
          await api(`${base}/${action.kind}`, { method: 'POST', body: { ...body, motivo: motivo.trim() } });
          toast.success(copy.title.replace(' suscripción', ''), sub.negocio);
          break;
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const explain: Record<Action['kind'], string> = {
    authorize: `Verificaste en el banco la transferencia de ${dop(sub.montoCentavos, sub.moneda)}. Se crea el negocio y la cuenta de ${sub.email}, se registra el pago y se genera un enlace de un solo uso para que el cliente cree su contraseña.`,
    reject: 'La solicitud queda cerrada y el cliente ve el motivo. Si ya transfirió, regístralo y devuélvele el dinero.',
    resend: 'Se genera un enlace nuevo y el anterior deja de funcionar.',
    payment: action.kind === 'payment' && action.comprobanteId ? 'Aprueba el comprobante y extiende el periodo un mes desde el vencimiento actual (o desde hoy si ya venció).' : 'Extiende el periodo un mes desde el vencimiento actual (o desde hoy si ya venció).',
    rejectReceipt: 'El cliente verá el motivo en su página de suscripción.',
    refund: 'Queda como movimiento nuevo en el libro; el cobro original no se modifica. La transferencia de vuelta la haces tú desde el banco.',
    plan: 'El periodo actual ya está pagado: el precio nuevo aplica desde la próxima renovación. Los límites cambian de inmediato.',
    suspend: 'El negocio queda en solo lectura de inmediato. Sus datos se conservan.',
    reactivate: 'Solo funciona si el periodo pagado no ha vencido; si venció, registra un pago.',
    cancel: 'La suscripción termina ya y el negocio queda en solo lectura. Para una cancelación al final del periodo, la programa el cliente.',
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      subtitle={sub.negocio}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="submit" form="sub-action-form" className={`btn btn-${copy.tone}`} disabled={busy || !confirmed}>
            {busy && <Spinner size={16} />} {copy.confirm}
          </button>
        </>
      }
    >
      <form id="sub-action-form" className="stack" onSubmit={submit} noValidate>
        <p className="confirm-message">{explain[action.kind]}</p>
        {error && (
          <div className="form-alert" role="alert">
            <span>{error}</span>
          </div>
        )}
        {needsAmount && (
          <TextInput label="Monto (RD$)" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} required />
        )}
        {action.kind === 'payment' && (
          <SelectInput label="Método" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </SelectInput>
        )}
        {(action.kind === 'authorize' || action.kind === 'payment') && (
          <>
            <TextInput label="Referencia bancaria" maxLength={120} value={referencia} onChange={(e) => setReferencia(e.target.value)} hint="Número de la transferencia en tu banco" />
            <TextArea label="Nota interna (opcional)" rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />
          </>
        )}
        {action.kind === 'plan' &&
          (plans.data ? (
            <SelectInput label="Plan nuevo" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.data.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} · {dop(p.precioMensualCentavos)}/mes
                </option>
              ))}
            </SelectInput>
          ) : (
            <Skeleton h={48} />
          ))}
        {needsReason && <TextArea label="Motivo" required rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} hint="Queda en el historial y en la actividad." />}
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Confirmo que revisé los datos
        </label>
      </form>
    </Modal>
  );
}

function DeliveryModal({ sub, delivery, onClose }: { sub: SubDetail; delivery: Delivery; onClose: () => void }) {
  const toast = useToast();
  const message = `Hola ${sub.contacto}, tu suscripción a Facilito para ${sub.negocio} fue aprobada. Crea tu contraseña aquí (vence en ${delivery.venceEnHoras} horas): ${delivery.activationUrl}`;
  const wa = whatsappLink(sub.telefono, message);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(delivery.activationUrl);
      toast.success('Enlace copiado');
    } catch {
      toast.info('Copia el enlace manualmente');
    }
  };
  return (
    <Modal open onClose={onClose} title="Enlace de activación" subtitle={sub.negocio} size="sm">
      <div className="stack">
        <p className={`form-alert ${delivery.emailEnviado ? 'success' : 'warn'}`} role="status">
          <span>
            {delivery.emailEnviado
              ? `Enviamos el enlace a ${sub.email}. También puedes mandarlo por WhatsApp.`
              : `El correo no está configurado o falló: envía este enlace al cliente por WhatsApp.`}
          </span>
        </p>
        <TextInput label="Enlace (un solo uso)" readOnly value={delivery.activationUrl} onFocus={(e) => e.currentTarget.select()} hint={`Vence en ${delivery.venceEnHoras} horas. No lo compartas con nadie más.`} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={copy}>
            <Copy size={16} aria-hidden /> Copiar enlace
          </button>
          {wa ? (
            <a className="btn btn-primary" href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={16} aria-hidden /> Enviar por WhatsApp
            </a>
          ) : (
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              El cliente no dejó teléfono válido.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}