'use client';

import { useState } from 'react';
import { ChartColumn, Download, FileSpreadsheet, FileText, Info, Lock, Receipt } from 'lucide-react';
import { api, apiBlob, downloadBlob, errorMessage } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { ESTADO_FACTURA_LABEL, METODO_PAGO_LABEL, dateShort, money, todayIso } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { Badge, ESTADO_TONE, EmptyState, ErrorState, Skeleton, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { InvoiceHeader } from '@/components/invoices/types';

interface Report {
  desde: string;
  hasta: string;
  items: InvoiceHeader[];
  resumen: { facturas: number; anuladas: number; subtotal: string; descuentos: string; itbis: string; total: string };
}

export default function ReportsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const today = todayIso();
  const [desde, setDesde] = useState(`${today.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(today);
  const [estado, setEstado] = useState('todas');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | 'inv' | null>(null);
  const allowed = can(ROLES.reports);
  const rangeOk = desde <= hasta;

  const report = useAsync(
    () => (allowed && rangeOk ? api<Report>('/v1/reports/invoices', { query: { desde, hasta, estado } }) : Promise.resolve(null)),
    [allowed, desde, hasta, estado, rangeOk],
  );

  const exportAs = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const blob = await apiBlob('/v1/reports/invoices', { query: { desde, hasta, estado, format } });
      downloadBlob(blob, `reporte-facturacion-${desde}-${hasta}.${format}`);
    } catch (e) {
      toast.error('No se pudo exportar', errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  const exportInventory = async () => {
    setExporting('inv');
    try {
      downloadBlob(await apiBlob('/v1/exports/products.csv'), `inventario-${today}.csv`);
    } catch (e) {
      toast.error('No se pudo exportar', errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  if (!allowed) {
    return (
      <div className="card">
        <EmptyState icon={<Lock size={26} />} title="Reportes restringidos" detail="Solo el dueño, gerente o contador pueden ver los reportes financieros." />
      </div>
    );
  }

  const r = report.data?.resumen;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reportes</h1>
          <p>Resumen de facturación por período, exportable a Excel (CSV) y PDF.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={exportInventory} disabled={!!exporting}>
            {exporting === 'inv' ? <Spinner size={16} /> : <FileSpreadsheet size={18} />} Inventario CSV
          </button>
          <button type="button" className="btn btn-outline" onClick={() => exportAs('csv')} disabled={!!exporting || !rangeOk}>
            {exporting === 'csv' ? <Spinner size={16} /> : <Download size={18} />} Excel (CSV)
          </button>
          <button type="button" className="btn btn-primary" onClick={() => exportAs('pdf')} disabled={!!exporting || !rangeOk}>
            {exporting === 'pdf' ? <Spinner size={16} /> : <FileText size={18} />} PDF
          </button>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Desde</span>
            <input type="date" className="input" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Hasta</span>
            <input type="date" className="input" value={hasta} min={desde} max={today} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Estado</span>
            <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="todas">Todas</option>
              {Object.entries(ESTADO_FACTURA_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!rangeOk && <p className="field-error" style={{ marginTop: 8 }}>“Desde” debe ser anterior a “Hasta”.</p>}
      </section>

      <div className="stat-row">
        {[
          { label: 'Facturas válidas', value: r ? String(r.facturas) : null, icon: Receipt, tone: 'tone-blue' },
          { label: 'Subtotal', value: r ? money(r.subtotal) : null, icon: ChartColumn, tone: 'tone-green' },
          { label: 'ITBIS', value: r ? money(r.itbis) : null, icon: FileText, tone: 'tone-purple' },
          { label: 'Total facturado', value: r ? money(r.total) : null, icon: ChartColumn, tone: 'tone-orange' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="card stat">
            <span className={`kpi-icon ${tone}`} style={{ width: 44, height: 44 }}>
              <Icon size={20} aria-hidden />
            </span>
            <span style={{ minWidth: 0 }}>
              <strong>{value ?? '—'}</strong>
              <span>{label}</span>
            </span>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Facturas del período</h2>
          {r && (
            <span className="card-sub">
              {r.anuladas} anuladas · descuentos {money(r.descuentos)}
            </span>
          )}
        </div>
        {report.error ? (
          <ErrorState error={report.error} onRetry={report.reload} />
        ) : report.loading && !report.data ? (
          <Skeleton h={220} />
        ) : !report.data || report.data.items.length === 0 ? (
          <EmptyState icon={<Receipt size={26} />} title="Sin facturas en el período" />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>NCF</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Método</th>
                  <th className="th-num">Subtotal</th>
                  <th className="th-num">ITBIS</th>
                  <th className="th-num">Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {report.data.items.slice(0, 500).map((f) => (
                  <tr key={f.id}>
                    <td className="td-main" data-label="Número">
                      <strong>{f.numeroLabel}</strong>
                    </td>
                    <td data-label="NCF" className="mono">
                      {f.ncf ?? '—'}
                    </td>
                    <td data-label="Fecha">{dateShort(f.fechaEmision)}</td>
                    <td data-label="Cliente">{f.clienteNombre}</td>
                    <td data-label="Método">{METODO_PAGO_LABEL[f.metodoPago]}</td>
                    <td data-label="Subtotal" className="num">
                      {money(f.subtotal)}
                    </td>
                    <td data-label="ITBIS" className="num">
                      {money(f.itbisTotal)}
                    </td>
                    <td data-label="Total" className="num">
                      <strong>{money(f.total)}</strong>
                    </td>
                    <td data-label="Estado">
                      <Badge tone={ESTADO_TONE[f.estado]}>{ESTADO_FACTURA_LABEL[f.estado]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.data.items.length > 500 && <p className="muted" style={{ marginTop: 8 }}>Mostrando 500 de {report.data.items.length}. Exporta el CSV para ver todas.</p>}
          </div>
        )}
      </section>

      <div className="form-alert info">
        <Info size={18} />
        <span>
          Los formatos DGII 606, 607 y 608 se habilitarán tras validar su estructura oficial vigente (pendiente de verificación en vivo con la DGII).
        </span>
      </div>
    </>
  );
}
