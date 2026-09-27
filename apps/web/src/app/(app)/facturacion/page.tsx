'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Eye, FileText, Plus, Printer, Search } from 'lucide-react';
import { api, errorMessage, openBlobInTab } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { ESTADO_FACTURA_LABEL, METODO_PAGO_LABEL, dateShort, money } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/hooks';
import { Badge, ESTADO_TONE, EmptyState, ErrorState, Pagination, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { InvoiceHeader } from '@/components/invoices/types';

type Estado = 'todas' | 'pendiente' | 'pagada' | 'vencida' | 'anulada';

interface InvoicePage {
  items: InvoiceHeader[];
  total: number;
  sumaTotal: string;
  page: number;
  pageSize: number;
}

export default function InvoicesPage() {
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<Estado>('todas');
  const [metodo, setMetodo] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);

  useEffect(() => setPage(1), [dq, estado, metodo, desde, hasta]);

  const { data, error, loading, reload } = useAsync(
    () => api<InvoicePage>('/v1/invoices', { query: { q: dq, estado, metodoPago: metodo, desde, hasta, page, pageSize: 20 } }),
    [dq, estado, metodo, desde, hasta, page],
  );

  const pdf = async (id: string) => {
    try {
      await openBlobInTab(`/v1/invoices/${id}/pdf`);
    } catch (e) {
      toast.error('No se pudo abrir el PDF', errorMessage(e));
    }
  };

  const filtered = !!(dq || estado !== 'todas' || metodo || desde || hasta);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Facturación</h1>
          <p>Facturas emitidas, cobros, anulaciones y comprobantes fiscales.</p>
        </div>
        {can(ROLES.sell) && (
          <div className="page-actions">
            <Link href="/facturacion/nueva" className="btn btn-primary">
              <Plus size={18} /> Nueva factura
            </Link>
          </div>
        )}
      </div>

      <section className="card">
        <div className="stack" style={{ gap: 12, marginBottom: 16 }}>
          <div className="chips" role="group" aria-label="Filtrar por estado">
            {(['todas', 'pendiente', 'pagada', 'vencida', 'anulada'] as const).map((e) => (
              <button key={e} type="button" className="chip" aria-pressed={estado === e} onClick={() => setEstado(e)}>
                {e === 'todas' ? 'Todas' : ESTADO_FACTURA_LABEL[e]}
              </button>
            ))}
          </div>
          <div className="toolbar">
            <div className="search">
              <Search size={18} aria-hidden />
              <label htmlFor="inv-q" className="sr-only">
                Buscar facturas
              </label>
              <input id="inv-q" type="search" className="input" placeholder="Buscar por número, NCF o cliente" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
            </div>
            <label className="sr-only" htmlFor="inv-metodo">
              Método de pago
            </label>
            <select id="inv-metodo" className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option value="">Todos los métodos</option>
              {Object.entries(METODO_PAGO_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="inv-desde">
              Desde
            </label>
            <input id="inv-desde" type="date" className="input" style={{ width: 'auto', flex: '1 1 150px' }} value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
            <label className="sr-only" htmlFor="inv-hasta">
              Hasta
            </label>
            <input id="inv-hasta" type="date" className="input" style={{ width: 'auto', flex: '1 1 150px' }} value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>

        {data && (
          <p className="muted" style={{ marginBottom: 8, fontSize: '0.9rem' }}>
            {data.total} {data.total === 1 ? 'factura' : 'facturas'} · Total (sin anuladas): <strong style={{ color: 'var(--ink)' }}>{money(data.sumaTotal)}</strong>
          </p>
        )}

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data ? (
          <div className="stack" style={{ gap: 10 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} h={48} />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<FileText size={26} />}
            title={filtered ? 'Sin resultados' : 'Aún no has emitido facturas'}
            detail={filtered ? 'Prueba con otros filtros.' : 'Emite tu primera factura en segundos.'}
            action={
              !filtered && can(ROLES.sell) ? (
                <Link href="/facturacion/nueva" className="btn btn-primary">
                  <Plus size={18} /> Nueva factura
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap" aria-busy={loading}>
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>NCF</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Método</th>
                    <th className="th-num">Total</th>
                    <th>Estado</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => router.push(`/facturacion/${f.id}`)}>
                      <td className="td-main" data-label="Número">
                        <Link href={`/facturacion/${f.id}`} onClick={(e) => e.stopPropagation()}>
                          <strong>{f.numeroLabel}</strong>
                        </Link>
                      </td>
                      <td data-label="NCF" className="mono">
                        {f.ncf ?? <span className="muted">—</span>}
                      </td>
                      <td data-label="Fecha">
                        {dateShort(f.fechaEmision)}
                        {f.fechaVencimiento && f.estado !== 'pagada' && f.estado !== 'anulada' && (
                          <div className="muted" style={{ fontSize: '0.78rem' }}>
                            Vence {dateShort(`${f.fechaVencimiento}T12:00:00Z`)}
                          </div>
                        )}
                      </td>
                      <td data-label="Cliente">{f.clienteNombre}</td>
                      <td data-label="Método">{METODO_PAGO_LABEL[f.metodoPago]}</td>
                      <td data-label="Total" className="num">
                        <strong style={f.estado === 'anulada' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{money(f.total)}</strong>
                      </td>
                      <td data-label="Estado">
                        <Badge tone={ESTADO_TONE[f.estado]}>{ESTADO_FACTURA_LABEL[f.estado]}</Badge>
                      </td>
                      <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                        <div className="cell-actions">
                          <Link href={`/facturacion/${f.id}`} className="icon-btn" aria-label={`Ver ${f.numeroLabel}`} title="Ver">
                            <Eye size={18} />
                          </Link>
                          <button type="button" className="icon-btn" aria-label={`PDF de ${f.numeroLabel}`} title="PDF" onClick={() => pdf(f.id)}>
                            <Printer size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
