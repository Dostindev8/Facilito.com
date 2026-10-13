'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Activity, Ban, Building2, CircleCheck, CreditCard, History, Inbox, Lock, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { api, errorMessage, type SubscriptionState } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateShort, dateTime, relativeTime } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/hooks';
import { dop, StateBadge } from '@/components/billing/billing-ui';
import { FinancePanel } from '@/components/admin/finance-panel';
import { HealthPanel } from '@/components/admin/health-panel';
import { MfaGate } from '@/components/admin/mfa-gate';
import { SearchBar } from '@/components/admin/search-bar';
import { SubscriptionsPanel } from '@/components/admin/subscriptions-panel';
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  Pagination,
  SelectInput,
  Skeleton,
  Spinner,
  Tabs,
  TextArea,
  TextInput,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface Stats {
  usuarios: number;
  usuariosNuevos30d: number;
  usuariosBloqueados: number;
  activos7d: number;
  negocios: number;
  negociosNuevos30d: number;
  negociosSuspendidos: number;
  solicitudesPendientes: number;
  comprobantesPendientes: number;
}

interface PlatformUser {
  id: string;
  email: string;
  nombre: string | null;
  createdAt: string;
  bloqueadoAt: string | null;
  bloqueadoMotivo: string | null;
  totpEnabled: boolean;
  platformAdmin: boolean;
  ultimaSesion: string | null;
  negocios: Array<{ tenantId: string; negocio: string; rol: string; estado: string }>;
}

interface PlatformBusiness {
  id: string;
  razonSocial: string;
  nombreComercial: string | null;
  tipoNegocio: string | null;
  plan: string;
  estado: 'activo' | 'suspendido';
  suspendidoMotivo: string | null;
  createdAt: string;
  ownerEmail: string | null;
  ownerNombre: string | null;
  miembros: number;
  suscripcionId: string | null;
  suscripcionEstado: SubscriptionState | null;
}

interface ActivityItem {
  id: string;
  action: string;
  targetLabel: string | null;
  detail: { motivo?: string; montoCentavos?: number };
  actorEmail: string;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

type Tab = 'solicitudes' | 'suscripciones' | 'finanzas' | 'negocios' | 'usuarios' | 'actividad' | 'salud';
const TABS: Tab[] = ['solicitudes', 'suscripciones', 'finanzas', 'negocios', 'usuarios', 'actividad', 'salud'];

const ROL_LABEL: Record<string, string> = {
  owner: 'Dueño',
  manager: 'Gerente',
  cashier: 'Cajero',
  warehouse: 'Almacén',
  accountant: 'Contador',
  viewer: 'Consulta',
};

const ACTION_LABEL: Record<string, string> = {
  'persona.block': 'Bloqueó al usuario',
  'persona.unblock': 'Habilitó al usuario',
  'negocio.suspend': 'Suspendió el negocio',
  'negocio.reactivate': 'Reactivó el negocio',
  'suscripcion.autorizar': 'Autorizó la suscripción de',
  'suscripcion.rechazar': 'Rechazó la solicitud de',
  'suscripcion.reenviar': 'Reenvió la invitación a',
  'suscripcion.pago': 'Registró un pago de',
  'suscripcion.reembolso': 'Registró un reembolso a',
  'suscripcion.plan': 'Cambió el plan de',
  'suscripcion.suspender': 'Suspendió la suscripción de',
  'suscripcion.reactivar': 'Reactivó la suscripción de',
  'suscripcion.cancelar': 'Canceló la suscripción de',
  'suscripcion.asignar': 'Asignó un plan a',
  'suscripcion.comprobante': 'Rechazó un comprobante de',
  'suscripcion.barrido': 'Ejecutó el barrido de vencimientos',
};

export default function PlatformAdminPage() {
  return (
    <Suspense fallback={<Skeleton h={240} />}>
      <PlatformAdmin />
    </Suspense>
  );
}

function PlatformAdmin() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(tabParam && TABS.includes(tabParam) ? tabParam : 'solicitudes');
  const isAdmin = !!user?.platformAdmin;
  const ready = isAdmin && !!user?.mfa;
  const stats = useAsync(() => (ready ? api<Stats>('/v1/platform/stats') : Promise.resolve(undefined)), [ready]);

  useEffect(() => {
    if (tabParam && TABS.includes(tabParam)) setTab(tabParam);
  }, [tabParam]);

  const changeTab = (t: Tab) => {
    setTab(t);
    router.replace(`${pathname}?tab=${t}`, { scroll: false });
  };

  if (!isAdmin) {
    return (
      <div className="card">
        <EmptyState icon={<Lock size={26} />} title="Acceso restringido" detail="Esta sección es solo para administradores de Facilito." />
      </div>
    );
  }
  if (!user?.mfa) return <MfaGate />;

  const s = stats.data;
  const porRevisar = s ? s.solicitudesPendientes + s.comprobantesPendientes : undefined;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administración de Facilito</h1>
          <p>Solicitudes, suscripciones, pagos y cuentas. Cada acción queda registrada en la actividad.</p>
        </div>
      </div>

      <div className="stat-row" aria-busy={stats.loading}>
        {[
          {
            label: 'Por revisar',
            value: porRevisar,
            extra: s ? `${s.solicitudesPendientes} solicitudes · ${s.comprobantesPendientes} renovaciones` : null,
            icon: Inbox,
            tone: porRevisar ? 'tone-orange' : 'tone-green',
          },
          { label: 'Negocios', value: s?.negocios, extra: s ? `+${s.negociosNuevos30d} en 30 días` : null, icon: Building2, tone: 'tone-green' },
          { label: 'Usuarios', value: s?.usuarios, extra: s ? `${s.activos7d} activos en 7 días` : null, icon: Users, tone: 'tone-blue' },
          {
            label: 'Bloqueados / suspendidos',
            value: s ? `${s.usuariosBloqueados} / ${s.negociosSuspendidos}` : undefined,
            extra: 'usuarios / negocios',
            icon: Ban,
            tone: 'tone-red',
          },
        ].map(({ label, value, extra, icon: Icon, tone }) => (
          <div key={label} className="card stat">
            <span className={`kpi-icon ${tone}`} style={{ width: 44, height: 44 }}>
              <Icon size={20} aria-hidden />
            </span>
            <span style={{ minWidth: 0 }}>
              <strong>{value ?? '—'}</strong>
              <span>{label}</span>
              {extra && <span style={{ display: 'block', fontSize: '0.75rem' }}>{extra}</span>}
            </span>
          </div>
        ))}
      </div>
      {stats.error && <ErrorState error={stats.error} onRetry={stats.reload} />}

      <section className="card">
        <Tabs
          label="Secciones de administración"
          value={tab}
          onChange={changeTab}
          items={[
            { value: 'solicitudes', label: 'Por revisar', count: porRevisar },
            { value: 'suscripciones', label: 'Suscripciones' },
            { value: 'finanzas', label: 'Finanzas' },
            { value: 'negocios', label: 'Negocios', count: s?.negocios },
            { value: 'usuarios', label: 'Usuarios', count: s?.usuarios },
            { value: 'actividad', label: 'Actividad' },
            { value: 'salud', label: 'Salud' },
          ]}
        />
        <div style={{ marginTop: 16 }}>
          {tab === 'solicitudes' && <SubscriptionsPanel queue onChanged={stats.reload} />}
          {tab === 'suscripciones' && <SubscriptionsPanel onChanged={stats.reload} />}
          {tab === 'finanzas' && <FinancePanel />}
          {tab === 'usuarios' && <UsersPanel onChanged={stats.reload} />}
          {tab === 'negocios' && <BusinessesPanel onChanged={stats.reload} />}
          {tab === 'actividad' && <ActivityPanel />}
          {tab === 'salud' && <HealthPanel />}
        </div>
      </section>
    </>
  );
}

/** Asks for the reason that is shown to admins and stored in the activity log. */
function ReasonModal({
  open,
  title,
  subtitle,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMotivo('');
      setError(undefined);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = motivo.trim();
    if (m.length < 3) {
      setError('Escribe el motivo (mínimo 3 caracteres)');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(m);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="reason-form" className="btn btn-danger" disabled={busy}>
            {busy && <Spinner size={16} />} {confirmLabel}
          </button>
        </>
      }
    >
      <form id="reason-form" className="stack" onSubmit={submit} noValidate>
        <TextArea label="Motivo" required rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={error} hint="Queda registrado en la actividad." />
      </form>
    </Modal>
  );
}

function UsersPanel({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'todos' | 'activos' | 'bloqueados'>('todos');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const [blocking, setBlocking] = useState<PlatformUser | null>(null);
  const [enabling, setEnabling] = useState<PlatformUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [dq, estado]);
  const list = useAsync(() => api<Page<PlatformUser>>('/v1/platform/users', { query: { q: dq, estado, page, pageSize: 20 } }), [dq, estado, page]);

  const refresh = () => {
    list.reload();
    onChanged();
  };

  const block = async (motivo: string) => {
    if (!blocking) return;
    await api(`/v1/platform/users/${blocking.id}/block`, { method: 'POST', body: { motivo } });
    toast.success('Usuario bloqueado', `${blocking.email} ya no puede entrar.`);
    setBlocking(null);
    refresh();
  };

  const enable = async () => {
    if (!enabling) return;
    setBusy(true);
    try {
      await api(`/v1/platform/users/${enabling.id}/unblock`, { method: 'POST' });
      toast.success('Usuario habilitado', `${enabling.email} puede volver a entrar.`);
      setEnabling(null);
      refresh();
    } catch (e) {
      toast.error('No se pudo habilitar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SearchBar id="admin-users-q" value={q} onChange={setQ} placeholder="Buscar por nombre o email">
        <SelectInput label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} style={{ minWidth: 160 }}>
          <option value="todos">Todos</option>
          <option value="activos">Activos</option>
          <option value="bloqueados">Bloqueados</option>
        </SelectInput>
      </SearchBar>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton h={240} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<Users size={26} />} title={dq || estado !== 'todos' ? 'Sin resultados' : 'Aún no hay usuarios registrados'} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th style={{ minWidth: 240 }}>Usuario</th>
                  <th>Negocios</th>
                  <th>Última sesión</th>
                  <th>Registro</th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="td-main" data-label="Usuario">
                      <strong>{u.nombre ?? u.email.split('@')[0]}</strong>
                      <div className="muted" style={{ overflowWrap: 'anywhere', fontSize: '0.85rem' }}>
                        {u.email}
                      </div>
                    </td>
                    <td data-label="Negocios">
                      {u.platformAdmin ? (
                        <Badge tone="purple">
                          <ShieldCheck size={12} aria-hidden /> Admin plataforma
                        </Badge>
                      ) : u.negocios.length === 0 ? (
                        '—'
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {u.negocios.map((n) => (
                            <Badge key={n.tenantId} tone={n.estado === 'activo' ? 'blue' : 'gray'}>
                              {n.negocio} · {ROL_LABEL[n.rol] ?? n.rol}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td data-label="Última sesión">{u.ultimaSesion ? relativeTime(u.ultimaSesion) : 'Nunca'}</td>
                    <td data-label="Registro">{dateShort(u.createdAt)}</td>
                    <td data-label="Estado">
                      {u.bloqueadoAt ? (
                        <span title={u.bloqueadoMotivo ?? undefined}>
                          <Badge tone="red">Bloqueado</Badge>
                        </span>
                      ) : (
                        <Badge tone="green">Activo</Badge>
                      )}
                      {u.bloqueadoMotivo && (
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          {u.bloqueadoMotivo}
                        </div>
                      )}
                    </td>
                    <td className="td-actions">
                      {u.platformAdmin ? null : u.bloqueadoAt ? (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setEnabling(u)} aria-label={`Habilitar a ${u.email}`}>
                          <UserCheck size={16} aria-hidden /> Habilitar
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlocking(u)} aria-label={`Bloquear a ${u.email}`}>
                          <Ban size={16} aria-hidden /> Bloquear
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}

      <ReasonModal
        open={!!blocking}
        title="Bloquear usuario"
        subtitle={blocking ? `${blocking.email} perderá el acceso de inmediato en todos sus dispositivos.` : ''}
        confirmLabel="Bloquear"
        onClose={() => setBlocking(null)}
        onConfirm={block}
      />
      <ConfirmDialog
        open={!!enabling}
        title="Habilitar usuario"
        message={enabling ? `${enabling.email} podrá volver a iniciar sesión.` : ''}
        confirmLabel="Habilitar"
        busy={busy}
        onConfirm={enable}
        onClose={() => setEnabling(null)}
      />
    </>
  );
}

function BusinessesPanel({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'todos' | 'activo' | 'suspendido'>('todos');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const [suspending, setSuspending] = useState<PlatformBusiness | null>(null);
  const [reactivating, setReactivating] = useState<PlatformBusiness | null>(null);
  const [assigning, setAssigning] = useState<PlatformBusiness | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [dq, estado]);
  const list = useAsync(() => api<Page<PlatformBusiness>>('/v1/platform/businesses', { query: { q: dq, estado, page, pageSize: 20 } }), [dq, estado, page]);

  const refresh = () => {
    list.reload();
    onChanged();
  };

  const suspend = async (motivo: string) => {
    if (!suspending) return;
    await api(`/v1/platform/businesses/${suspending.id}/suspend`, { method: 'POST', body: { motivo } });
    toast.success('Negocio suspendido', `${suspending.nombreComercial ?? suspending.razonSocial} quedó sin acceso.`);
    setSuspending(null);
    refresh();
  };

  const reactivate = async () => {
    if (!reactivating) return;
    setBusy(true);
    try {
      await api(`/v1/platform/businesses/${reactivating.id}/reactivate`, { method: 'POST' });
      toast.success('Negocio reactivado', reactivating.nombreComercial ?? reactivating.razonSocial);
      setReactivating(null);
      refresh();
    } catch (e) {
      toast.error('No se pudo reactivar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SearchBar id="admin-biz-q" value={q} onChange={setQ} placeholder="Buscar por negocio o email del dueño">
        <SelectInput label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} style={{ minWidth: 160 }}>
          <option value="todos">Todos</option>
          <option value="activo">Activos</option>
          <option value="suspendido">Suspendidos</option>
        </SelectInput>
      </SearchBar>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton h={240} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<Building2 size={26} />} title={dq || estado !== 'todos' ? 'Sin resultados' : 'Aún no hay negocios registrados'} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Negocio</th>
                  <th style={{ minWidth: 220 }}>Dueño</th>
                  <th>Miembros</th>
                  <th>Registro</th>
                  <th>Suscripción</th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((b) => (
                  <tr key={b.id}>
                    <td className="td-main" data-label="Negocio">
                      <strong>{b.nombreComercial ?? b.razonSocial}</strong>
                      {b.nombreComercial && b.nombreComercial !== b.razonSocial && (
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {b.razonSocial}
                        </div>
                      )}
                    </td>
                    <td data-label="Dueño" style={{ overflowWrap: 'anywhere' }}>
                      {b.ownerNombre && <div>{b.ownerNombre}</div>}
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {b.ownerEmail ?? '—'}
                      </div>
                    </td>
                    <td data-label="Miembros">{b.miembros}</td>
                    <td data-label="Registro">{dateShort(b.createdAt)}</td>
                    <td data-label="Suscripción">
                      {b.suscripcionEstado ? (
                        <StateBadge estado={b.suscripcionEstado} />
                      ) : (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setAssigning(b)} aria-label={`Asignar plan a ${b.nombreComercial ?? b.razonSocial}`}>
                          <CreditCard size={16} aria-hidden /> Asignar plan
                        </button>
                      )}
                    </td>
                    <td data-label="Estado">
                      <Badge tone={b.estado === 'activo' ? 'green' : 'red'}>{b.estado === 'activo' ? 'Activo' : 'Suspendido'}</Badge>
                      {b.suspendidoMotivo && (
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          {b.suspendidoMotivo}
                        </div>
                      )}
                    </td>
                    <td className="td-actions">
                      {b.estado === 'suspendido' ? (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setReactivating(b)}
                          aria-label={`Reactivar ${b.nombreComercial ?? b.razonSocial}`}
                        >
                          <CircleCheck size={16} aria-hidden /> Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setSuspending(b)}
                          aria-label={`Suspender ${b.nombreComercial ?? b.razonSocial}`}
                        >
                          <Ban size={16} aria-hidden /> Suspender
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}

      <ReasonModal
        open={!!suspending}
        title="Suspender negocio"
        subtitle={suspending ? `Nadie podrá entrar a ${suspending.nombreComercial ?? suspending.razonSocial} hasta que lo reactives. Sus datos se conservan.` : ''}
        confirmLabel="Suspender"
        onClose={() => setSuspending(null)}
        onConfirm={suspend}
      />
      <ConfirmDialog
        open={!!reactivating}
        title="Reactivar negocio"
        message={reactivating ? `El equipo de ${reactivating.nombreComercial ?? reactivating.razonSocial} podrá volver a entrar.` : ''}
        confirmLabel="Reactivar"
        busy={busy}
        onConfirm={reactivate}
        onClose={() => setReactivating(null)}
      />
      {assigning && (
        <AssignPlanModal
          business={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/** Businesses from before paid plans: put them on a plan with an explicit paid-through date. */
function AssignPlanModal({ business, onClose, onDone }: { business: PlatformBusiness; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const plans = useAsync(() => api<{ items: Array<{ id: string; nombre: string; precioMensualCentavos: number }> }>('/v1/billing/plans'), []);
  const [planId, setPlanId] = useState('');
  const [fin, setFin] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState('Cliente existente antes de los planes de pago');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = business.nombreComercial ?? business.razonSocial;

  useEffect(() => {
    if (!planId && plans.data?.items[0]) setPlanId(plans.data.items[0].id);
  }, [plans.data, planId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const end = new Date(`${fin}T23:59:59-04:00`);
    if (!(end.getTime() > Date.now())) return setError('La fecha debe ser futura.');
    if (motivo.trim().length < 3) return setError('Escribe el motivo.');
    if (!confirmed) return setError('Marca la casilla para confirmar.');
    setBusy(true);
    try {
      await api('/v1/platform/subscriptions/assign', {
        method: 'POST',
        body: { confirmar: true, tenantId: business.id, planId, periodoFin: end.toISOString(), motivo: motivo.trim() },
      });
      toast.success('Plan asignado', name);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Asignar plan"
      subtitle={name}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="assign-form" className="btn btn-primary" disabled={busy || !confirmed || !planId}>
            {busy && <Spinner size={16} />} Asignar
          </button>
        </>
      }
    >
      <form id="assign-form" className="stack" onSubmit={submit} noValidate>
        <p className="confirm-message">El negocio queda con la suscripción activa hasta la fecha que elijas (cortesía o migración). Después aplican renovación, gracia y solo lectura como a cualquier cliente.</p>
        {error && (
          <div className="form-alert" role="alert">
            <span>{error}</span>
          </div>
        )}
        {plans.error ? (
          <ErrorState error={plans.error} onRetry={plans.reload} />
        ) : !plans.data ? (
          <Skeleton h={48} />
        ) : (
          <SelectInput label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.data.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {dop(p.precioMensualCentavos)}/mes
              </option>
            ))}
          </SelectInput>
        )}
        <TextInput label="Pagado hasta" type="date" value={fin} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFin(e.target.value)} required />
        <TextArea label="Motivo" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Confirmo la asignación
        </label>
      </form>
    </Modal>
  );
}

function ActivityPanel() {
  const list = useAsync(() => api<{ items: ActivityItem[] }>('/v1/platform/activity'), []);
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data) return <Skeleton h={200} />;
  if (list.data.items.length === 0) {
    return <EmptyState icon={<History size={26} />} title="Sin actividad todavía" detail="Aquí verás cada autorización, pago, bloqueo y suspensión." />;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
      {list.data.items.map((e) => (
        <li key={e.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>
              <strong>{ACTION_LABEL[e.action] ?? e.action}</strong> {e.action === 'suscripcion.barrido' ? '' : (e.targetLabel ?? '')}
            </span>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {dateTime(e.createdAt)}
            </span>
          </div>
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4, overflowWrap: 'anywhere' }}>
            Por {e.actorEmail}
            {typeof e.detail.montoCentavos === 'number' ? ` · ${dop(e.detail.montoCentavos)}` : ''}
            {e.detail.motivo ? ` · Motivo: ${e.detail.motivo}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}
