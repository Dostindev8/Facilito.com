'use client';

import { useEffect, useState } from 'react';
import { Banknote, CalendarClock, CircleAlert, TrendingUp, Undo2, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { dop } from '@/components/billing/billing-ui';
import { Badge, EmptyState, ErrorState, Pagination, SelectInput, Skeleton } from '@/components/ui/primitives';

interface Finance {
  mrrCentavos: number;
  activas: number;
  enGracia: number;
  suspendidas: number;
  canceladas: number;
  pendientes: number;
  cobradoMesCentavos: number;
  reembolsadoMesCentavos: number;
  serie: Array<{ mes: string; cobradoCentavos: number; reembolsadoCentavos: number }>;
  ledger: {
    items: Array<{
      id: string;
      tipo: 'cobro' | 'reembolso';
      montoCentavos: number;
      moneda: string;
      metodo: string;
      referencia: string | null;
      negocio: string;
      suscripcionId: string;
      registradoPor: string | null;
      fecha: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y?.slice(2)}`;
};

export function FinancePanel() {
  const [tipo, setTipo] = useState<'todos' | 'cobro' | 'reembolso'>('todos');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [tipo]);
  const data = useAsync(() => api<Finance>('/v1/platform/finance', { query: { tipo, page, pageSize: 20 } }), [tipo, page]);

  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  if (!data.data) {
    return (
      <div className="stack">
        <div className="stat-row">
          <Skeleton h={88} />
          <Skeleton h={88} />
          <Skeleton h={88} />
          <Skeleton h={88} />
        </div>
        <Skeleton h={200} />
      </div>
    );
  }
  const f = data.data;
  const max = Math.max(1, ...f.serie.map((m) => m.cobradoCentavos));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stat-row">
        {[
          { label: 'Ingreso mensual recurrente', value: dop(f.mrrCentavos), extra: 'Activas y en gracia, sin las que cancelan', icon: TrendingUp, tone: 'tone-green' },
          { label: 'Cobrado este mes', value: dop(f.cobradoMesCentavos), extra: f.reembolsadoMesCentavos ? `−${dop(f.reembolsadoMesCentavos)} en reembolsos` : 'Sin reembolsos', icon: Wallet, tone: 'tone-blue' },
          { label: 'Suscripciones activas', value: String(f.activas), extra: `${f.enGracia} en gracia · ${f.pendientes} por autorizar`, icon: CalendarClock, tone: 'tone-purple' },
          { label: 'Suspendidas / canceladas', value: `${f.suspendidas} / ${f.canceladas}`, extra: 'Datos conservados en solo lectura', icon: CircleAlert, tone: 'tone-red' },
        ].map(({ label, value, extra, icon: Icon, tone }) => (
          <div key={label} className="card stat">
            <span className={`kpi-icon ${tone}`} style={{ width: 44, height: 44 }}>
              <Icon size={20} aria-hidden />
            </span>
            <span style={{ minWidth: 0 }}>
              <strong>{value}</strong>
              <span>{label}</span>
              <span style={{ display: 'block', fontSize: '0.75rem' }}>{extra}</span>
            </span>
          </div>
        ))}
      </div>

      <section className="card" aria-labelledby="fin-series">
        <h3 id="fin-series" style={{ fontSize: '1rem', marginBottom: 12 }}>
          Cobrado por mes (últimos 12)
        </h3>
        {f.serie.length === 0 ? (
          <p className="muted">Todavía no hay cobros registrados.</p>
        ) : (
          <ol className="bar-chart" aria-label="Cobrado por mes">
            {f.serie.map((m) => (
              <li key={m.mes} title={`${monthLabel(m.mes)}: ${dop(m.cobradoCentavos)}${m.reembolsadoCentavos ? `, reembolsos ${dop(m.reembolsadoCentavos)}` : ''}`}>
                <span className="bar" style={{ height: `${Math.max(4, (m.cobradoCentavos / max) * 100)}%` }} aria-hidden />
                <span className="bar-label">{monthLabel(m.mes)}</span>
                <span className="sr-only">
                  {monthLabel(m.mes)}: {dop(m.cobradoCentavos)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="fin-ledger">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div>
            <h3 id="fin-ledger" style={{ fontSize: '1rem' }}>
              Libro de movimientos
            </h3>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Inmutable: los cobros no se editan ni se borran; un reembolso es un movimiento nuevo.
            </p>
          </div>
          <SelectInput label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} style={{ minWidth: 160 }}>
            <option value="todos">Todos</option>
            <option value="cobro">Cobros</option>
            <option value="reembolso">Reembolsos</option>
          </SelectInput>
        </div>
        {f.ledger.items.length === 0 ? (
          <EmptyState icon={<Banknote size={26} />} title="Sin movimientos" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th style={{ minWidth: 200 }}>Negocio</th>
                    <th>Tipo</th>
                    <th>Método</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th>Registró</th>
                  </tr>
                </thead>
                <tbody>
                  {f.ledger.items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Fecha">{dateTime(p.fecha)}</td>
                      <td className="td-main" data-label="Negocio">
                        {p.negocio}
                        {p.referencia && p.tipo === 'cobro' && (
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            Ref. {p.referencia}
                          </div>
                        )}
                      </td>
                      <td data-label="Tipo">
                        {p.tipo === 'cobro' ? (
                          <Badge tone="green">Cobro</Badge>
                        ) : (
                          <Badge tone="purple">
                            <Undo2 size={12} aria-hidden /> Reembolso
                          </Badge>
                        )}
                      </td>
                      <td data-label="Método">{p.metodo}</td>
                      <td data-label="Monto" style={{ textAlign: 'right', fontWeight: 600 }}>
                        {p.tipo === 'reembolso' ? '−' : ''}
                        {dop(p.montoCentavos, p.moneda)}
                      </td>
                      <td data-label="Registró" style={{ overflowWrap: 'anywhere' }}>
                        {p.registradoPor ?? 'Pasarela'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={f.ledger.page} pageSize={f.ledger.pageSize} total={f.ledger.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
