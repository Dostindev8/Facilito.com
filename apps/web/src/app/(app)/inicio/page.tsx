'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Boxes,
  Building2,
  Calendar,
  FileText,
  KeyRound,
  MapPin,
  Minus,
  Package,
  PackagePlus,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { ESTADO_FACTURA_LABEL, dateLong, dateTime, greetingName, money, pct, qty, relativeTime, todayIso } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { Badge, ESTADO_TONE, EmptyState, ErrorState, Skeleton, Tabs } from '@/components/ui/primitives';
import { SalesChart, type SeriePoint } from '@/components/dashboard/sales-chart';
import { NOTIF_META, useNotifications } from '@/components/shell/notifications';

interface Kpi {
  valor: string;
  anterior: string;
  cambio: string | null;
}

interface Dashboard {
  fecha: string;
  kpis: { ventas: Kpi; productos: Kpi; facturas: Kpi; clientes: Kpi };
  serie: SeriePoint[];
  recientes: Array<{ id: string; numero: string; fecha: string; cliente: string; productos: string; total: string; estado: string }>;
  masVendidos: Array<{ productoId: string; nombre: string; sku: string; unidades: string; ingresos: string }>;
  bajoStock: Array<{ id: string; nombre: string; sku: string; stockActual: string; stockMin: string; unidad: string; estado: string }>;
  negocio: { nombre: string; rnc: string | null; ubicacion: string; estado: string; productosActivos: number; clientes: number };
  /** ERP+ additive (optional for older API). */
  ingresosCobrados?: string;
  facturasPendientes?: number;
  ncfSecuencias?: Array<{ tipo: string; restantes: number; siguiente: number; hasta: number; vence: string | null; consumoPct: number }>;
  salud?: { negocio: number; inventario: number; fiscal: number; stockCritico: number; stockBajo: number };
}

type TableTab = 'recientes' | 'top' | 'bajo';

function Change({ kpi }: { kpi: Kpi }) {
  if (kpi.cambio === null) {
    return (
      <span className="kpi-change flat">
        <Minus size={14} aria-hidden /> Sin datos de ayer
      </span>
    );
  }
  const n = Number(kpi.cambio);
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const Icon = n > 0 ? TrendingUp : n < 0 ? TrendingDown : Minus;
  return (
    <span className={`kpi-change ${cls}`}>
      <Icon size={14} aria-hidden /> {pct(n)} <small>vs. ayer</small>
    </span>
  );
}

const KPI_LABELS = ['Ventas del día', 'Productos vendidos', 'Facturas emitidas', 'Clientes atendidos'] as const;

function KpiCard({ label, value, kpi, icon, tone }: { label: string; value: string; kpi: Kpi; icon: ReactNode; tone: string }) {
  return (
    <div className="card kpi">
      <span className={`kpi-icon ${tone}`}>{icon}</span>
      <div className="kpi-body">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
        <Change kpi={kpi} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const today = todayIso();
  const [fecha, setFecha] = useState(today);
  const [dias, setDias] = useState<7 | 14 | 30>(7);
  const [tab, setTab] = useState<TableTab>('recientes');
  const { data, error, loading, reload } = useAsync(() => api<Dashboard>('/v1/dashboard', { query: { fecha, dias } }), [fecha, dias]);
  const notif = useNotifications(user?.tenantId);

  const isToday = fecha === today;
  const periodTotal = data?.serie.reduce((a, s) => a + Number(s.total), 0) ?? 0;
  const periodInvoices = data?.serie.reduce((a, s) => a + s.facturas, 0) ?? 0;

  const quick = [
    { href: '/ventas', label: 'Nueva venta', icon: ShoppingCart, tone: 'green', ok: can(ROLES.sell) },
    { href: '/inventario?nuevo=1', label: 'Agregar producto', icon: PackagePlus, tone: 'blue', ok: can(ROLES.inventoryWrite) },
    { href: '/facturacion/nueva', label: 'Emitir factura', icon: Receipt, tone: 'orange', ok: can(ROLES.sell) },
    { href: '/inventario', label: 'Ver inventario', icon: Boxes, tone: 'purple', ok: true },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>¡Hola, {greetingName(user?.nombre ?? '')}!</h1>
          <p>Aquí tienes el resumen de tu negocio{isToday ? ' hoy' : ` del ${dateLong(fecha)}`}.</p>
        </div>
        <label className="date-picker">
          <Calendar size={18} className="text-green" aria-hidden />
          {isToday && <span className="today">Hoy</span>}
          <span className="sr-only">Fecha del resumen</span>
          <input type="date" value={fecha} max={today} onChange={(e) => setFecha(e.target.value && e.target.value <= today ? e.target.value : today)} />
        </label>
      </div>

      {error && !data ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : (
        <>
          <section className="kpi-grid" aria-label="Indicadores del día" aria-busy={loading}>
            {!data ? (
              KPI_LABELS.map((label) => (
                <div key={label} className="card kpi">
                  <Skeleton w={52} h={52} r={14} />
                  <div className="kpi-body">
                    <span className="kpi-label">{label}</span>
                    <span className="kpi-value skeleton-text" aria-hidden>RD$ 0.00</span>
                    <span className="kpi-change skeleton-text" aria-hidden>
                      <Minus size={14} /> Sin datos de ayer
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <>
                <KpiCard label="Ventas del día" value={money(data.kpis.ventas.valor)} kpi={data.kpis.ventas} icon={<ShoppingCart size={24} />} tone="tone-green" />
                <KpiCard label="Productos vendidos" value={qty(data.kpis.productos.valor)} kpi={data.kpis.productos} icon={<Package size={24} />} tone="tone-orange" />
                <KpiCard label="Facturas emitidas" value={qty(data.kpis.facturas.valor)} kpi={data.kpis.facturas} icon={<FileText size={24} />} tone="tone-blue" />
                <KpiCard label="Clientes atendidos" value={qty(data.kpis.clientes.valor)} kpi={data.kpis.clientes} icon={<Users size={24} />} tone="tone-purple" />
              </>
            )}
          </section>

          {data?.salud && (
            <section className="health-strip" aria-label="Salud del negocio">
              <div className="health-score">
                <strong>{data.salud.negocio}</strong>
                <span>Salud del negocio</span>
              </div>
              <div className="health-meters">
                <div>
                  <span>Inventario</span>
                  <div className="meter">
                    <i style={{ width: `${data.salud.inventario}%` }} />
                  </div>
                  <small>
                    {data.salud.stockCritico > 0
                      ? `${data.salud.stockCritico} agotados`
                      : data.salud.stockBajo > 0
                        ? `${data.salud.stockBajo} bajo mínimo`
                        : 'OK'}
                  </small>
                </div>
                <div>
                  <span>Fiscal / NCF</span>
                  <div className="meter meter-blue">
                    <i style={{ width: `${data.salud.fiscal}%` }} />
                  </div>
                  <small>{data.ncfSecuencias?.length ? `${data.ncfSecuencias.length} secuencias` : 'Configura NCF'}</small>
                </div>
              </div>
              {(data.ingresosCobrados !== undefined || data.facturasPendientes !== undefined) && (
                <div className="health-extras">
                  <div>
                    <span className="muted">Ingresos cobrados (día)</span>
                    <strong>{money(data.ingresosCobrados ?? '0')}</strong>
                  </div>
                  <div>
                    <span className="muted">Facturas pendientes</span>
                    <strong>{data.facturasPendientes ?? 0}</strong>
                  </div>
                </div>
              )}
            </section>
          )}

          {data?.ncfSecuencias && data.ncfSecuencias.length > 0 && (
            <section className="card ncf-panel" aria-labelledby="ncf-title">
              <div className="card-header">
                <div>
                  <h2 id="ncf-title">Secuencias NCF</h2>
                  <span className="card-sub">Disponibles y consumo — sin tocar la emisión fiscal</span>
                </div>
                <Link href="/configuracion?tab=comprobantes" className="link-btn">
                  Configurar <ArrowRight size={16} />
                </Link>
              </div>
              <div className="ncf-grid">
                {data.ncfSecuencias.map((s) => (
                  <div key={s.tipo} className="ncf-item">
                    <div className="row-between">
                      <strong className="text-green">{s.tipo}</strong>
                      <span>{s.restantes} disponibles</span>
                    </div>
                    <div className="meter">
                      <i style={{ width: `${s.consumoPct}%` }} />
                    </div>
                    <small className="muted">
                      Siguiente {s.siguiente} · Hasta {s.hasta}
                      {s.vence ? ` · Vence ${dateLong(s.vence)}` : ''}
                    </small>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="dash-grid">
            <div className="dash-main">
              <section className="card" aria-labelledby="chart-title">
                <div className="card-header">
                  <div>
                    <h2 id="chart-title">Resumen de ventas</h2>
                    <span className="card-sub">Últimos {dias} días</span>
                  </div>
                  <div className="range-select" role="group" aria-label="Rango del gráfico">
                    {([7, 14, 30] as const).map((d) => (
                      <button key={d} type="button" aria-pressed={dias === d} onClick={() => setDias(d)}>
                        {d} días
                      </button>
                    ))}
                  </div>
                </div>
                {data ? (
                  <>
                    <div className="chart-summary">
                      <div>
                        <span>Total del período</span>
                        <strong>{money(periodTotal)}</strong>
                      </div>
                      <div>
                        <span>Facturas</span>
                        <strong>{periodInvoices}</strong>
                      </div>
                      <div>
                        <span>Promedio diario</span>
                        <strong>{money(periodTotal / Math.max(data.serie.length, 1))}</strong>
                      </div>
                    </div>
                    <SalesChart serie={data.serie} today={today} />
                  </>
                ) : (
                  <>
                    <div className="chart-summary" aria-hidden>
                      {[
                        ['Total del período', 'RD$ 0.00'],
                        ['Facturas', '00'],
                        ['Promedio diario', 'RD$ 0.00'],
                      ].map(([l, v]) => (
                        <div key={l}>
                          <span>{l}</span>
                          <strong className="skeleton-text">{v}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="chart skeleton" aria-hidden />
                  </>
                )}
              </section>

              <section className="card activity-card" aria-label="Actividad">
                <div className="row-between wrap" style={{ marginBottom: 8 }}>
                  <Tabs<TableTab>
                    label="Actividad del negocio"
                    value={tab}
                    onChange={setTab}
                    items={[
                      { value: 'recientes', label: 'Ventas recientes' },
                      { value: 'top', label: 'Productos más vendidos' },
                      { value: 'bajo', label: 'Bajo stock', count: data?.bajoStock.length },
                    ]}
                  />
                  <Link href={tab === 'recientes' ? '/facturacion' : tab === 'bajo' ? '/inventario?stock=bajo' : '/reportes'} className="link-btn">
                    Ver todas <ArrowRight size={16} />
                  </Link>
                </div>
                {!data ? (
                  <div className="stack activity-body" style={{ gap: 10, paddingTop: 8 }}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <Skeleton key={i} h={44} />
                    ))}
                  </div>
                ) : tab === 'recientes' ? (
                  data.recientes.length === 0 ? (
                    <EmptyState
                      icon={<Receipt size={26} />}
                      title="Aún no hay ventas"
                      detail="Cuando emitas tu primera factura aparecerá aquí."
                      action={
                        can(ROLES.sell) ? (
                          <Link href="/facturacion/nueva" className="btn btn-primary">
                            Emitir factura
                          </Link>
                        ) : undefined
                      }
                    />
                  ) : (
                    <div className="table-wrap">
                      <table className="table responsive">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Fecha</th>
                            <th>Cliente</th>
                            <th className="th-num">Productos</th>
                            <th className="th-num">Total</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.recientes.map((r) => (
                            <tr key={r.id} className="clickable" onClick={() => router.push(`/facturacion/${r.id}`)}>
                              <td className="td-main" data-label="#">
                                <Link href={`/facturacion/${r.id}`} onClick={(e) => e.stopPropagation()}>
                                  <strong>{r.numero}</strong>
                                </Link>
                              </td>
                              <td data-label="Fecha">{dateTime(r.fecha)}</td>
                              <td data-label="Cliente">{r.cliente}</td>
                              <td data-label="Productos" className="num">
                                {qty(r.productos)}
                              </td>
                              <td data-label="Total" className="num">
                                <strong>{money(r.total)}</strong>
                              </td>
                              <td data-label="Estado">
                                <Badge tone={ESTADO_TONE[r.estado] ?? 'gray'}>{ESTADO_FACTURA_LABEL[r.estado] ?? r.estado}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : tab === 'top' ? (
                  data.masVendidos.length === 0 ? (
                    <EmptyState icon={<TrendingUp size={26} />} title="Sin ventas en los últimos 30 días" />
                  ) : (
                    <div className="table-wrap">
                      <table className="table responsive">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Producto</th>
                            <th>SKU</th>
                            <th className="th-num">Unidades</th>
                            <th className="th-num">Ingresos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.masVendidos.map((p, i) => (
                            <tr key={p.productoId}>
                              <td data-label="#">{i + 1}</td>
                              <td className="td-main" data-label="Producto">
                                <strong>{p.nombre}</strong>
                              </td>
                              <td data-label="SKU" className="muted">
                                {p.sku}
                              </td>
                              <td data-label="Unidades" className="num">
                                {qty(p.unidades)}
                              </td>
                              <td data-label="Ingresos" className="num">
                                <strong>{money(p.ingresos)}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : data.bajoStock.length === 0 ? (
                  <EmptyState icon={<Package size={26} />} title="Inventario saludable" detail="Ningún producto está por debajo de su mínimo." />
                ) : (
                  <div className="table-wrap">
                    <table className="table responsive">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>SKU</th>
                          <th className="th-num">Stock</th>
                          <th className="th-num">Mínimo</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.bajoStock.map((p) => (
                          <tr key={p.id} className="clickable" onClick={() => router.push(`/inventario?producto=${p.id}`)}>
                            <td className="td-main" data-label="Producto">
                              <strong>{p.nombre}</strong>
                            </td>
                            <td data-label="SKU" className="muted">
                              {p.sku}
                            </td>
                            <td data-label="Stock" className="num">
                              {qty(p.stockActual)} {p.unidad}
                            </td>
                            <td data-label="Mínimo" className="num">
                              {qty(p.stockMin)}
                            </td>
                            <td data-label="Estado">
                              <Badge tone={p.estado === 'agotado' ? 'red' : 'orange'}>{p.estado === 'agotado' ? 'Agotado' : 'Bajo'}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <aside className="dash-side" aria-label="Accesos y avisos">
              <section className="card" aria-labelledby="quick-title">
                <div className="card-header">
                  <h2 id="quick-title">Acciones rápidas</h2>
                </div>
                <div className="quick-grid">
                  {quick.map(({ href, label, icon: Icon, tone, ok }) => (
                    <Link key={label} href={href} className={`quick ${tone}`} aria-disabled={!ok} tabIndex={ok ? undefined : -1}>
                      <span className="quick-icon">
                        <Icon size={22} aria-hidden />
                      </span>
                      {label}
                    </Link>
                  ))}
                </div>
              </section>

              <section className="card biz-card" aria-label="Tu negocio">
                {data ? (
                  <>
                    <div className="biz-head">
                      <span className="biz-avatar">
                        <Building2 size={24} aria-hidden />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <strong>{data.negocio.nombre}</strong>
                        <Badge tone={data.negocio.estado === 'activo' ? 'green' : 'gray'}>{data.negocio.estado === 'activo' ? 'Activo' : data.negocio.estado}</Badge>
                      </div>
                    </div>
                    <div className="biz-meta">
                      <span>
                        <KeyRound size={16} aria-hidden /> RNC: {data.negocio.rnc ?? '—'}
                      </span>
                      <span>
                        <MapPin size={16} aria-hidden /> {data.negocio.ubicacion}
                      </span>
                      <span>
                        <Package size={16} aria-hidden /> {data.negocio.productosActivos} {data.negocio.productosActivos === 1 ? 'producto activo' : 'productos activos'} · {data.negocio.clientes}{' '}
                        {data.negocio.clientes === 1 ? 'cliente' : 'clientes'}
                      </span>
                    </div>
                  </>
                ) : (
                  <Skeleton h={146} />
                )}
              </section>

              <div className="brand-card">
                <Image src="/brand/hills-bg-sm.webp" alt="" fill sizes="(max-width: 1279px) 100vw, 420px" />
                <span className="script-line">Más tiempo para lo importante</span>
                <small>Facilito trabaja por ti mientras atiendes tu negocio.</small>
              </div>

              <section className="card notif-card" aria-labelledby="notif-title">
                <div className="card-header" style={{ marginBottom: 4 }}>
                  <h2 id="notif-title">Notificaciones</h2>
                  {notif.unread > 0 && <Badge tone="orange">{notif.unread} nuevas</Badge>}
                </div>
                {notif.loading ? (
                  <Skeleton h={120} />
                ) : notif.items.length === 0 ? (
                  <EmptyState icon={<FileText size={24} />} title="Todo en orden" detail="No hay avisos pendientes." />
                ) : (
                  <ul className="notif-list">
                    {notif.items.slice(0, 5).map((n) => {
                      const meta = NOTIF_META[n.tipo];
                      const Icon = meta.icon;
                      return (
                        <li key={n.id}>
                          <Link href={n.href} className={`notif-item ${notif.read.has(n.id) ? '' : 'unread'}`} onClick={() => notif.markRead([n.id])}>
                            <span className={`notif-icon ${meta.tone}`}>
                              <Icon size={18} aria-hidden />
                            </span>
                            <span className="notif-body">
                              <span className="notif-title">{n.titulo}</span>
                              <span className="notif-detail">{n.detalle}</span>
                            </span>
                            <span className="notif-time">{relativeTime(n.fecha)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {notif.items.length > 0 && (
                  <Link href="/notificaciones" className="link-btn" style={{ marginTop: 8 }}>
                    Ver todas <ArrowRight size={16} />
                  </Link>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
