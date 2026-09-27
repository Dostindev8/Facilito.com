'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '@/lib/api';
import { MOTIVO_LABEL, dateTime, money, qty } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { EmptyState, ErrorState, Modal, Pagination, Skeleton } from '@/components/ui/primitives';
import type { Product } from './types';

interface KardexRow {
  id: string;
  fecha: string;
  tipo: string;
  motivo: string | null;
  nota: string | null;
  referencia: string | null;
  entrada: string | null;
  salida: string | null;
  costo: string;
  saldo: string | null;
  autor: string;
}

const TIPO_LABEL: Record<string, string> = {
  in: 'Entrada',
  out: 'Salida',
  sale: 'Venta',
  void_sale: 'Anulación',
  count: 'Conteo',
  adjust: 'Ajuste',
};

export function KardexModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  useEffect(() => {
    setPage(1);
    setDesde('');
    setHasta('');
  }, [product?.id]);

  const { data, error, loading, reload } = useAsync(
    () =>
      product
        ? api<{ items: KardexRow[]; total: number; page: number; pageSize: number }>(`/v1/products/${product.id}/kardex`, {
            query: { page, pageSize: 15, desde, hasta },
          })
        : Promise.resolve(null),
    [product?.id, page, desde, hasta],
  );

  if (!product) return null;

  return (
    <Modal open onClose={onClose} size="xl" title="Kardex" subtitle={`${product.nombre} · ${product.sku} · Stock actual ${qty(product.stockActual)} ${product.unidad}`}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label className="field" style={{ flex: '0 1 180px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Desde</span>
          <input type="date" className="input" value={desde} max={hasta || undefined} onChange={(e) => (setDesde(e.target.value), setPage(1))} />
        </label>
        <label className="field" style={{ flex: '0 1 180px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Hasta</span>
          <input type="date" className="input" value={hasta} min={desde || undefined} onChange={(e) => (setHasta(e.target.value), setPage(1))} />
        </label>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Skeleton h={220} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<History size={26} />} title="Sin movimientos" detail="No hay movimientos en este rango." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th>Referencia</th>
                  <th className="th-num">Entrada</th>
                  <th className="th-num">Salida</th>
                  <th className="th-num">Saldo</th>
                  <th className="th-num">Costo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Fecha">{dateTime(r.fecha)}</td>
                    <td className="td-main" data-label="Movimiento">
                      <div>
                        <strong>{TIPO_LABEL[r.tipo] ?? r.tipo}</strong>
                        {r.motivo && <div className="muted" style={{ fontSize: '0.8rem' }}>{MOTIVO_LABEL[r.motivo] ?? r.motivo}{r.nota ? ` · ${r.nota}` : ''}</div>}
                      </div>
                    </td>
                    <td data-label="Referencia">{r.referencia ?? '—'}</td>
                    <td data-label="Entrada" className="num text-green">
                      {r.entrada ? `+${qty(r.entrada)}` : '—'}
                    </td>
                    <td data-label="Salida" className="num text-red">
                      {r.salida ? `−${qty(r.salida)}` : '—'}
                    </td>
                    <td data-label="Saldo" className="num">
                      <strong>{r.saldo !== null ? qty(r.saldo) : '—'}</strong>
                    </td>
                    <td data-label="Costo" className="num">
                      {Number(r.costo) > 0 ? money(r.costo) : '—'}
                    </td>
                    <td data-label="Usuario">{r.autor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Modal>
  );
}
