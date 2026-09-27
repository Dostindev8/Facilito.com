'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Ban, CircleCheck, Download, Mail, MessageCircle, Printer, TriangleAlert } from 'lucide-react';
import { api, apiBlob, downloadBlob, errorMessage, openBlobInTab } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { ESTADO_FACTURA_LABEL, METODO_PAGO_LABEL, dateShort, dateTime, money, qty } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { Badge, ConfirmDialog, ESTADO_TONE, ErrorState, Modal, Skeleton, Spinner, TextArea, TextInput } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { notifyDataChanged } from '@/components/shell/app-shell';
import type { InvoiceDetail } from '@/components/invoices/types';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const { data: inv, error, reload, setData } = useAsync(
    () => (valid ? api<InvoiceDetail>(`/v1/invoices/${id}`) : Promise.reject(new Error('Factura inválida'))),
    [id],
  );

  const [voidOpen, setVoidOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error) return <div className="card"><ErrorState error={error} onRetry={reload} /></div>;
  if (!inv) return <Skeleton h={480} r={16} />;

  const anulada = inv.estado === 'anulada';
  const cobrable = inv.estado === 'pendiente' || inv.estado === 'vencida';

  const doVoid = async () => {
    if (motivo.trim().length < 5) {
      setFormError('Describe el motivo (mínimo 5 caracteres).');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<InvoiceDetail>(`/v1/invoices/${inv.id}/void`, { method: 'POST', body: { motivo: motivo.trim() } });
      setData(r);
      setVoidOpen(false);
      setMotivo('');
      notifyDataChanged();
      toast.success('Factura anulada', 'El inventario de los productos fue restaurado.');
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doPay = async () => {
    setBusy(true);
    try {
      const h = await api<Omit<InvoiceDetail, 'lineas'>>(`/v1/invoices/${inv.id}/pay`, { method: 'POST', body: {} });
      setData({ ...inv, ...h });
      setPayOpen(false);
      notifyDataChanged();
      toast.success('Cobro registrado', `${inv.numeroLabel} marcada como pagada.`);
    } catch (e) {
      toast.error('No se pudo registrar el cobro', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doWhatsapp = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      setFormError('Escribe un teléfono válido (10 dígitos, ej. 809-555-1234).');
      return;
    }
    setFormError(null);
    const win = window.open('about:blank', '_blank');
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(`/v1/invoices/${inv.id}/whatsapp`, { method: 'POST', body: { telefono: digits } });
      if (!url.startsWith('https://wa.me/')) throw new Error('Enlace inválido');
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.location.href = url;
      }
      setWaOpen(false);
    } catch (e) {
      win?.close();
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doEmail = async () => {
    try {
      await api(`/v1/invoices/${inv.id}/email`, { method: 'POST', body: {} });
    } catch (e) {
      toast.info('Email no disponible', errorMessage(e));
    }
  };

  const pdf = async (download: boolean) => {
    try {
      if (download) downloadBlob(await apiBlob(`/v1/invoices/${inv.id}/pdf`, { query: { download: 1 } }), `factura-${inv.numeroLabel}.pdf`);
      else await openBlobInTab(`/v1/invoices/${inv.id}/pdf`);
    } catch (e) {
      toast.error('No se pudo generar el PDF', errorMessage(e));
    }
  };

  const taxBreakdown = Object.entries(
    inv.lineas.reduce<Record<string, number>>((acc, l) => {
      acc[l.itbisTasa] = (acc[l.itbisTasa] ?? 0) + Number(l.itbis);
      return acc;
    }, {}),
  ).filter(([rate]) => Number(rate) > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/facturacion" className="link-btn" style={{ marginBottom: 6 }}>
            <ArrowLeft size={16} /> Facturación
          </Link>
          <div className="row wrap">
            <h1>{inv.numeroLabel}</h1>
            <Badge tone={ESTADO_TONE[inv.estado]}>{ESTADO_FACTURA_LABEL[inv.estado]}</Badge>
            {anulada && <span className="void-stamp">ANULADA</span>}
          </div>
          <p>
            Emitida el {dateTime(inv.fechaEmision)}
            {inv.ncf ? ` · NCF ${inv.ncf}` : ' · Sin comprobante fiscal'}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={() => pdf(false)}>
            <Printer size={18} /> Ver PDF
          </button>
          <button type="button" className="btn btn-outline" onClick={() => pdf(true)}>
            <Download size={18} /> Descargar
          </button>
          {!anulada && can(ROLES.sell) && (
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setFormError(null);
                  setWaOpen(true);
                }}
              >
                <MessageCircle size={18} /> WhatsApp
              </button>
              <button type="button" className="btn btn-outline" onClick={doEmail}>
                <Mail size={18} /> Email
              </button>
            </>
          )}
          {cobrable && can(ROLES.sell) && (
            <button type="button" className="btn btn-primary" onClick={() => setPayOpen(true)}>
              <CircleCheck size={18} /> Registrar cobro
            </button>
          )}
          {!anulada && can(ROLES.void) && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setFormError(null);
                setVoidOpen(true);
              }}
            >
              <Ban size={18} /> Anular
            </button>
          )}
        </div>
      </div>

      {anulada && (
        <div className="form-alert" role="status">
          <Ban size={18} />
          <span>
            Anulada {inv.anuladaAt ? `el ${dateTime(inv.anuladaAt)}` : ''}. Motivo: <strong>{inv.motivoAnulacion}</strong>. El número y el NCF se conservan; el stock fue
            restaurado.
          </span>
        </div>
      )}

      <section className="card">
        <dl className="detail-grid" style={{ margin: 0 }}>
          <div>
            <dt>Cliente</dt>
            <dd>{inv.clienteNombre}</dd>
          </div>
          <div>
            <dt>Método de pago</dt>
            <dd>{METODO_PAGO_LABEL[inv.metodoPago]}</dd>
          </div>
          <div>
            <dt>{inv.pagadaAt ? 'Cobrada' : 'Vencimiento'}</dt>
            <dd>{inv.pagadaAt ? dateTime(inv.pagadaAt) : inv.fechaVencimiento ? dateShort(`${inv.fechaVencimiento}T12:00:00Z`) : '—'}</dd>
          </div>
          <div>
            <dt>Comprobante</dt>
            <dd className="mono">{inv.ncf ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Detalle</h2>
          <span className="card-sub">
            {inv.lineasCount} {inv.lineasCount === 1 ? 'línea' : 'líneas'} · {qty(inv.unidades)} unidades
          </span>
        </div>
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>#</th>
                <th>Producto</th>
                <th className="th-num">Cantidad</th>
                <th className="th-num">Precio</th>
                <th className="th-num">Descuento</th>
                <th className="th-num">ITBIS</th>
                <th className="th-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lineas.map((l) => (
                <tr key={l.linea}>
                  <td data-label="#">{l.linea}</td>
                  <td className="td-main" data-label="Producto">
                    <div>
                      <strong>{l.descripcion}</strong>
                      {l.sku && <div className="muted" style={{ fontSize: '0.8rem' }}>{l.sku}</div>}
                    </div>
                  </td>
                  <td data-label="Cantidad" className="num">
                    {qty(l.cantidad)} {l.unidad ?? ''}
                  </td>
                  <td data-label="Precio" className="num">
                    {money(l.precioUnitario)}
                  </td>
                  <td data-label="Descuento" className="num">
                    {Number(l.descuento) > 0 ? `−${money(l.descuento)}` : '—'}
                  </td>
                  <td data-label="ITBIS" className="num">
                    {money(l.itbis)} <small className="muted">({Math.round(Number(l.itbisTasa) * 100)}%)</small>
                  </td>
                  <td data-label="Total" className="num">
                    <strong>{money(l.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <div className="totals" style={{ width: 'min(100%, 340px)' }}>
            <div>
              <span className="muted">Subtotal</span>
              <span className="mono">{money(inv.subtotal)}</span>
            </div>
            {Number(inv.descuentoTotal) > 0 && (
              <div>
                <span className="muted">Descuentos aplicados</span>
                <span className="mono">−{money(inv.descuentoTotal)}</span>
              </div>
            )}
            {taxBreakdown.map(([rate, amount]) => (
              <div key={rate}>
                <span className="muted">ITBIS {Math.round(Number(rate) * 100)}%</span>
                <span className="mono">{money(amount)}</span>
              </div>
            ))}
            <div>
              <span className="muted">ITBIS total</span>
              <span className="mono">{money(inv.itbisTotal)}</span>
            </div>
            <div className="grand">
              <span>Total</span>
              <span className="mono">{money(inv.total)}</span>
            </div>
          </div>
        </div>
        {inv.notas && (
          <p className="muted" style={{ marginTop: 12 }}>
            <strong>Notas:</strong> {inv.notas}
          </p>
        )}
      </section>

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        size="sm"
        title={`Anular ${inv.numeroLabel}`}
        subtitle="La factura no se borra: conserva su número y NCF, y el stock vuelve al inventario."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setVoidOpen(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" onClick={doVoid} disabled={busy}>
              {busy && <Spinner size={16} />} Anular factura
            </button>
          </>
        }
      >
        <div className="stack">
          {formError && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{formError}</span>
            </div>
          )}
          <TextArea label="Motivo de la anulación" required value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={3} placeholder="Ej.: Error en el precio, cliente devolvió la mercancía…" />
        </div>
      </Modal>

      <ConfirmDialog
        open={payOpen}
        title="Registrar cobro"
        busy={busy}
        confirmLabel="Marcar como pagada"
        message={
          <p>
            Confirmas que recibiste <strong>{money(inv.total)}</strong> de {inv.clienteNombre} por la factura {inv.numeroLabel}.
          </p>
        }
        onConfirm={doPay}
        onClose={() => setPayOpen(false)}
      />

      <Modal
        open={waOpen}
        onClose={() => setWaOpen(false)}
        size="sm"
        title="Enviar por WhatsApp"
        subtitle="Se abrirá WhatsApp con el resumen de la factura listo para enviar."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setWaOpen(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={doWhatsapp} disabled={busy}>
              {busy ? <Spinner size={16} /> : <MessageCircle size={16} />} Abrir WhatsApp
            </button>
          </>
        }
      >
        <div className="stack">
          {formError && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{formError}</span>
            </div>
          )}
          <TextInput label="Teléfono del cliente" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="809-555-1234" />
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Consejo: descarga el PDF y adjúntalo en el chat para que tu cliente tenga la factura completa.
          </p>
        </div>
      </Modal>
    </>
  );
}
