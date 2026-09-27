'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CircleCheck, Printer, Receipt, ShoppingCart } from 'lucide-react';
import { api, errorMessage, openBlobInTab } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { ESTADO_FACTURA_LABEL, METODO_PAGO_LABEL, dateTime, money, todayIso } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { Badge, ESTADO_TONE, EmptyState, ErrorState, Modal, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { InvoiceEditor } from '@/components/invoices/invoice-editor';
import type { InvoiceDetail, InvoiceHeader } from '@/components/invoices/types';

export default function SalesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [last, setLast] = useState<InvoiceDetail | null>(null);
  const today = todayIso();
  const sales = useAsync(
    () => api<{ items: InvoiceHeader[]; total: number; sumaTotal: string }>('/v1/invoices', { query: { desde: today, hasta: today, pageSize: 10 } }),
    [today],
  );

  const pdf = async (id: string) => {
    try {
      await openBlobInTab(`/v1/invoices/${id}/pdf`);
    } catch (e) {
      toast.error('No se pudo abrir el PDF', errorMessage(e));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Nueva venta</h1>
          <p>Punto de venta rápido: busca o escanea, cobra y entrega el comprobante.</p>
        </div>
        <div className="page-actions">
          <Link href="/facturacion" className="btn btn-outline">
            <Receipt size={18} /> Todas las facturas
          </Link>
        </div>
      </div>

      {can(ROLES.sell) ? (
        <InvoiceEditor
          mode="pos"
          onCreated={(inv) => {
            setLast(inv);
            sales.reload();
          }}
        />
      ) : (
        <div className="card">
          <EmptyState icon={<ShoppingCart size={26} />} title="Sin permiso para vender" detail="Tu rol no puede registrar ventas." />
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Ventas de hoy</h2>
            {sales.data && (
              <span className="card-sub">
                {sales.data.total} ventas · {money(sales.data.sumaTotal)}
              </span>
            )}
          </div>
          <Link href={`/facturacion`} className="link-btn">
            Ver todas
          </Link>
        </div>
        {sales.error ? (
          <ErrorState error={sales.error} onRetry={sales.reload} />
        ) : !sales.data ? (
          <Skeleton h={160} />
        ) : sales.data.items.length === 0 ? (
          <EmptyState icon={<Receipt size={24} />} title="Aún no hay ventas hoy" />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Hora</th>
                  <th>Cliente</th>
                  <th>Método</th>
                  <th className="th-num">Total</th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">PDF</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.data.items.map((f) => (
                  <tr key={f.id}>
                    <td className="td-main" data-label="Número">
                      <Link href={`/facturacion/${f.id}`}>
                        <strong>{f.numeroLabel}</strong>
                      </Link>
                    </td>
                    <td data-label="Hora">{dateTime(f.fechaEmision)}</td>
                    <td data-label="Cliente">{f.clienteNombre}</td>
                    <td data-label="Método">{METODO_PAGO_LABEL[f.metodoPago]}</td>
                    <td data-label="Total" className="num">
                      <strong>{money(f.total)}</strong>
                    </td>
                    <td data-label="Estado">
                      <Badge tone={ESTADO_TONE[f.estado]}>{ESTADO_FACTURA_LABEL[f.estado]}</Badge>
                    </td>
                    <td className="td-actions">
                      <button type="button" className="icon-btn" aria-label={`PDF de ${f.numeroLabel}`} onClick={() => pdf(f.id)}>
                        <Printer size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={!!last}
        onClose={() => setLast(null)}
        size="sm"
        title="¡Venta registrada!"
        subtitle={last ? `${last.numeroLabel}${last.ncf ? ` · NCF ${last.ncf}` : ''}` : ''}
        footer={
          last ? (
            <>
              <Link href={`/facturacion/${last.id}`} className="btn btn-ghost">
                Ver factura
              </Link>
              <button type="button" className="btn btn-outline" onClick={() => pdf(last.id)}>
                <Printer size={16} /> Imprimir
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setLast(null)}>
                Nueva venta
              </button>
            </>
          ) : undefined
        }
      >
        {last && (
          <div className="empty" style={{ padding: '8px 0' }}>
            <div className="empty-icon">
              <CircleCheck size={28} />
            </div>
            <strong style={{ fontSize: '1.6rem' }}>{money(last.total)}</strong>
            <p>
              {last.clienteNombre} · {METODO_PAGO_LABEL[last.metodoPago]} · {ESTADO_FACTURA_LABEL[last.estado]}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
