'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CreditCard, Landmark, Minus, Plus, Receipt, ShoppingCart, Trash2, TriangleAlert, Wallet, WifiOff } from 'lucide-react';
import { computeInvoiceTotals, type InvoiceTotals } from '@facilito/domain/invoice';
import { ApiError, api, errorMessage, newClientUuid } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { METODO_PAGO_LABEL, addDaysIso, centsToString, money, qty, toCents, todayIso } from '@/lib/format';
import { EmptyState, ErrorState, Skeleton, Spinner, TextArea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { notifyDataChanged } from '@/components/shell/app-shell';
import type { Product } from '@/components/inventory/types';
import { CustomerPicker, type CustomerChoice } from './customer-picker';
import { ProductPicker, type ProductPickerHandle } from './product-picker';
import { DISCOUNT_CAP_PCT, type BusinessSettings, type InvoiceDetail, type MetodoPago, type NcfConfig } from './types';

interface Line {
  productoId: string;
  nombre: string;
  sku: string;
  unidad: string;
  precioLista: string;
  precio: string;
  cantidad: string;
  descuento: string;
  itbisTasa: string;
  stock: string;
  permiteNegativo: boolean;
}

interface Draft {
  clientUuid: string;
  lines: Line[];
  cliente: CustomerChoice;
  metodo: MetodoPago;
  pagada: boolean;
  vence: string;
  ncfTipo: string;
  notas: string;
}

const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

function freshDraft(): Draft {
  return {
    clientUuid: newClientUuid(),
    lines: [],
    cliente: { id: null, nombre: 'Cliente general' },
    metodo: 'efectivo',
    pagada: true,
    vence: addDaysIso(todayIso(), 30),
    ncfTipo: '__default__',
    notas: '',
  };
}

function loadDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return Array.isArray(d.lines) && typeof d.clientUuid === 'string' ? d : null;
  } catch {
    return null;
  }
}

export function InvoiceEditor({ mode, onCreated }: { mode: 'pos' | 'factura'; onCreated: (inv: InvoiceDetail) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const draftKey = `fc_draft:${user?.tenantId}:${mode}`;
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const [restored, setRestored] = useState(false);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [ncf, setNcf] = useState<NcfConfig | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [recibido, setRecibido] = useState('');
  const pickerRef = useRef<ProductPickerHandle>(null);

  const canOverridePrice = user?.rol === 'owner' || user?.rol === 'manager';
  const cap = DISCOUNT_CAP_PCT[user?.rol ?? 'viewer'] ?? 0;

  const loadConfig = () => {
    setLoadError(null);
    Promise.all([api<BusinessSettings>('/v1/settings'), api<NcfConfig>('/v1/settings/ncf')])
      .then(([s, n]) => {
        setSettings(s);
        setNcf(n);
      })
      .catch(setLoadError);
  };

  useEffect(() => {
    loadConfig();
    const saved = loadDraft(draftKey);
    if (saved && saved.lines.length) {
      setDraft(saved);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    try {
      if (draft.lines.length) sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* private mode: drafts are best-effort */
    }
  }, [draft, draftKey]);

  const update = (patch: Partial<Draft>) => {
    setSubmitError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const updateLine = (i: number, patch: Partial<Line>) => {
    setSubmitError(null);
    setErrorLine(null);
    setDraft((d) => ({ ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  };

  const addProduct = (p: Product) => {
    setSubmitError(null);
    setDraft((d) => {
      const idx = d.lines.findIndex((l) => l.productoId === p.id);
      if (idx >= 0) {
        const lines = [...d.lines];
        const cur = lines[idx]!;
        lines[idx] = { ...cur, cantidad: String(Number(cur.cantidad || 0) + 1), stock: p.stockActual };
        return { ...d, lines };
      }
      return {
        ...d,
        lines: [
          ...d.lines,
          {
            productoId: p.id,
            nombre: p.nombre,
            sku: p.sku,
            unidad: p.unidad,
            precioLista: p.precioVenta,
            precio: p.precioVenta,
            cantidad: '1',
            descuento: '0',
            itbisTasa: p.itbisTasa,
            stock: p.stockActual,
            permiteNegativo: p.permiteNegativo,
          },
        ],
      };
    });
  };

  const allowNegative = !!settings?.permiteStockNegativo;

  const lineErrors = useMemo(() => {
    const need = new Map<string, number>();
    draft.lines.forEach((l) => need.set(l.productoId, (need.get(l.productoId) ?? 0) + Number(l.cantidad || 0)));
    return draft.lines.map((l) => {
      if (!QTY.test(l.cantidad) || Number(l.cantidad) <= 0) return 'Cantidad inválida';
      if (!AMOUNT.test(l.precio)) return 'Precio inválido';
      if (!AMOUNT.test(l.descuento || '0')) return 'Descuento inválido';
      const gross = toCents(l.precio) * BigInt(Math.round(Number(l.cantidad) * 1000));
      const grossCents = (gross + 500n) / 1000n;
      const disc = toCents(l.descuento || '0');
      if (disc > grossCents) return 'El descuento supera el importe';
      if (disc > 0n && disc * 100n > grossCents * BigInt(cap)) return `Tu rol permite hasta ${cap}% de descuento`;
      if (!allowNegative && !l.permiteNegativo && (need.get(l.productoId) ?? 0) > Number(l.stock)) return `Solo hay ${qty(l.stock)} disponibles`;
      return null;
    });
  }, [draft.lines, allowNegative, cap]);

  const totals: InvoiceTotals | null = useMemo(() => {
    if (!settings || !draft.lines.length || lineErrors.some(Boolean)) return null;
    try {
      return computeInvoiceTotals(
        draft.lines.map((l) => ({ cantidad: l.cantidad, precioUnitario: l.precio, descuento: l.descuento || '0', itbisTasa: l.itbisTasa })),
        settings.itbisModo,
        settings.itbisTasa,
      );
    } catch {
      return null;
    }
  }, [draft.lines, settings, lineErrors]);

  const activeNcf = (ncf?.secuencias ?? []).filter((s) => s.activo && s.disponibles > 0 && (!s.vence || s.vence >= todayIso()));
  const defaultNcf = settings?.sujetoDgii && settings.ncfTipoDefault ? settings.ncfTipoDefault : '';
  const ncfTipo = draft.ncfTipo === '__default__' ? defaultNcf : draft.ncfTipo;
  const credito = draft.metodo === 'credito';
  const cambio = draft.metodo === 'efectivo' && totals && AMOUNT.test(recibido) ? toCents(recibido) - toCents(totals.total) : null;

  const canSubmit = !!totals && !busy && draft.lines.length > 0 && (!credito || !!draft.vence);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    setErrorLine(null);
    try {
      const body = {
        clientUuid: draft.clientUuid,
        clienteId: draft.cliente.id,
        clienteNombre: draft.cliente.id ? null : draft.cliente.nombre,
        metodoPago: draft.metodo,
        pagada: credito ? false : draft.pagada,
        fechaVencimiento: credito ? draft.vence : null,
        ncfTipo: ncfTipo || null,
        notas: draft.notas.trim() || null,
        lineas: draft.lines.map((l) => ({
          productoId: l.productoId,
          cantidad: l.cantidad,
          descuento: l.descuento || '0',
          ...(canOverridePrice && l.precio !== l.precioLista ? { precioUnitario: l.precio } : {}),
        })),
      };
      const inv = await api<InvoiceDetail>('/v1/invoices', { method: 'POST', body });
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setDraft(freshDraft());
      setRecibido('');
      setRestored(false);
      notifyDataChanged();
      toast.success(inv.duplicate ? 'Factura ya registrada' : 'Factura emitida', `${inv.numeroLabel}${inv.ncf ? ` · NCF ${inv.ncf}` : ''} · ${money(inv.total)}`);
      onCreated(inv);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'Error', errorMessage(e));
      setSubmitError(err);
      const line = err.body?.line;
      if (typeof line === 'number') setErrorLine(line);
      if (err.code === 'stock') {
        Promise.all([...new Set(draft.lines.map((l) => l.productoId))].map((id) => api<Product>(`/v1/products/${id}`)))
          .then((prods) => {
            const byId = new Map(prods.map((p) => [p.id, p.stockActual]));
            setDraft((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, stock: byId.get(l.productoId) ?? l.stock })) }));
          })
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="card"><ErrorState error={loadError} onRetry={loadConfig} /></div>;
  if (!settings || !ncf) return <Skeleton h={420} r={16} />;

  const METODOS: Array<[MetodoPago, typeof Banknote]> = [
    ['efectivo', Banknote],
    ['tarjeta', CreditCard],
    ['transferencia', Landmark],
    ['credito', Wallet],
  ];

  return (
    <div className="invoice-layout">
      <section className="card stack" aria-label="Productos de la factura">
        {restored && (
          <div className="form-alert info" role="status">
            <Receipt size={18} />
            <span>
              Recuperamos la venta que tenías en curso.{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setDraft(freshDraft());
                  setRestored(false);
                }}
              >
                Descartarla
              </button>
            </span>
          </div>
        )}
        <ProductPicker ref={pickerRef} onPick={addProduct} allowNegative={allowNegative} />
        {draft.lines.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={26} />}
            title="Agrega productos"
            detail="Busca por nombre o SKU, o escanea el código de barras. Enter agrega el primer resultado."
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="th-num">Precio</th>
                  <th className="th-num">Cantidad</th>
                  <th className="th-num">Descuento</th>
                  <th className="th-num">Total</th>
                  <th>
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((l, i) => {
                  const err = lineErrors[i] ?? (errorLine === i ? submitError?.detail : null);
                  const lt = totals?.lines[i];
                  return (
                    <tr key={l.productoId} style={err ? { background: 'var(--red-50)' } : undefined}>
                      <td className="td-main" data-label="Producto">
                        <div style={{ minWidth: 0 }}>
                          <strong>{l.nombre}</strong>
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            {l.sku} · Stock {qty(l.stock)} · ITBIS {Math.round(Number(l.itbisTasa) * 100)}%
                          </div>
                          {err && (
                            <div className="field-error" role="alert">
                              {err}
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="Precio" className="num">
                        {canOverridePrice ? (
                          <input
                            className="input line-input"
                            inputMode="decimal"
                            aria-label={`Precio de ${l.nombre}`}
                            value={l.precio}
                            onChange={(e) => updateLine(i, { precio: e.target.value.replace(/[^\d.]/g, '') })}
                          />
                        ) : (
                          money(l.precio)
                        )}
                      </td>
                      <td data-label="Cantidad" className="num">
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: 32, height: 32 }}
                            aria-label="Restar uno"
                            onClick={() => updateLine(i, { cantidad: String(Math.max(Number(l.cantidad || 0) - 1, 1)) })}
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            className="input line-input"
                            style={{ width: 70 }}
                            inputMode="decimal"
                            aria-label={`Cantidad de ${l.nombre}`}
                            value={l.cantidad}
                            onChange={(e) => updateLine(i, { cantidad: e.target.value.replace(/[^\d.]/g, '') })}
                          />
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: 32, height: 32 }}
                            aria-label="Sumar uno"
                            onClick={() => updateLine(i, { cantidad: String(Number(l.cantidad || 0) + 1) })}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </td>
                      <td data-label="Descuento" className="num">
                        {cap > 0 ? (
                          <input
                            className="input line-input"
                            inputMode="decimal"
                            aria-label={`Descuento de ${l.nombre} en pesos`}
                            value={l.descuento}
                            onChange={(e) => updateLine(i, { descuento: e.target.value.replace(/[^\d.]/g, '') })}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label="Total" className="num">
                        <strong>{lt ? money(lt.total) : '—'}</strong>
                      </td>
                      <td className="td-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Quitar ${l.nombre}`}
                          onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, idx) => idx !== i) }))}
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {mode === 'factura' && (
          <TextArea label="Notas" value={draft.notas} onChange={(e) => update({ notas: e.target.value })} maxLength={500} rows={2} placeholder="Opcional: aparecen en la factura" />
        )}
      </section>

      <aside className="invoice-summary">
        <section className="card stack" aria-label="Datos de la factura">
          <CustomerPicker value={draft.cliente} onChange={(c) => update({ cliente: c })} />
          <div className="field">
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink-2)' }}>Método de pago</span>
            <div className="segmented" role="group" aria-label="Método de pago">
              {METODOS.map(([m, Icon]) => (
                <button key={m} type="button" aria-pressed={draft.metodo === m} onClick={() => update({ metodo: m })}>
                  <Icon size={16} aria-hidden /> {METODO_PAGO_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          {credito ? (
            <div className="field">
              <label htmlFor="inv-vence">Fecha de vencimiento</label>
              <input id="inv-vence" type="date" className="input" min={todayIso()} value={draft.vence} onChange={(e) => update({ vence: e.target.value })} />
            </div>
          ) : (
            <label className="check">
              <input type="checkbox" checked={draft.pagada} onChange={(e) => update({ pagada: e.target.checked })} /> Cobrada al emitir
            </label>
          )}
          <div className="field">
            <label htmlFor="inv-ncf">Comprobante fiscal (NCF)</label>
            <select id="inv-ncf" className="input" value={ncfTipo} onChange={(e) => update({ ncfTipo: e.target.value })}>
              <option value="">Sin comprobante fiscal</option>
              {activeNcf.map((s) => (
                <option key={s.tipo} value={s.tipo}>
                  {s.tipo} · {ncf.tipos[s.tipo] ?? s.descripcion} ({s.disponibles} disp.)
                </option>
              ))}
              {ncfTipo && !activeNcf.some((s) => s.tipo === ncfTipo) && (
                <option value={ncfTipo}>
                  {ncfTipo} · sin secuencia disponible
                </option>
              )}
            </select>
            {!activeNcf.length && (
              <span className="field-hint">
                No hay secuencias NCF activas. <Link href="/configuracion?tab=comprobantes">Configúralas aquí</Link>.
              </span>
            )}
          </div>
        </section>

        <section className="card stack" aria-label="Totales">
          <div className="totals">
            <div>
              <span className="muted">Subtotal bruto</span>
              <span className="mono">{money(totals?.bruto ?? 0)}</span>
            </div>
            {totals && Number(totals.descuentoTotal) > 0 && (
              <div>
                <span className="muted">Descuentos</span>
                <span className="mono text-red">−{money(totals.descuentoTotal)}</span>
              </div>
            )}
            <div>
              <span className="muted">Subtotal</span>
              <span className="mono">{money(totals?.subtotal ?? 0)}</span>
            </div>
            <div>
              <span className="muted">ITBIS {settings.itbisModo === 'global' ? `(${Math.round(Number(settings.itbisTasa) * 100)}% global)` : '(por línea)'}</span>
              <span className="mono">{money(totals?.itbisTotal ?? 0)}</span>
            </div>
            <div className="grand">
              <span>Total</span>
              <span className="mono">{money(totals?.total ?? 0)}</span>
            </div>
          </div>
          {draft.metodo === 'efectivo' && mode === 'pos' && totals && (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="inv-recibido">Recibido</label>
                <input id="inv-recibido" className="input" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
              </div>
              <div className="field">
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink-2)' }}>Cambio</span>
                <strong style={{ minHeight: 46, display: 'flex', alignItems: 'center', fontSize: '1.15rem' }} className={cambio !== null && cambio < 0n ? 'text-red' : 'text-green'}>
                  {cambio === null ? '—' : cambio < 0n ? `Faltan ${money(centsToString(-cambio))}` : money(centsToString(cambio))}
                </strong>
              </div>
            </div>
          )}
          {submitError && (
            <div className="form-alert" role="alert">
              {submitError.isNetwork ? <WifiOff size={18} /> : <TriangleAlert size={18} />}
              <span>
                {submitError.detail}
                {submitError.isNetwork && ' Tu venta está guardada; al reintentar no se duplicará.'}
                {submitError.code === 'ncf_unavailable' && (
                  <>
                    {' '}
                    <Link href="/configuracion?tab=comprobantes">Ir a Comprobantes</Link>
                  </>
                )}
              </span>
            </div>
          )}
          <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 52, fontSize: '1.05rem' }} disabled={!canSubmit} onClick={submit}>
            {busy ? <Spinner size={18} /> : <Receipt size={20} />} {submitError?.isNetwork ? 'Reintentar' : mode === 'pos' ? 'Cobrar' : 'Emitir factura'}{' '}
            {totals ? money(totals.total) : ''}
          </button>
        </section>
      </aside>
    </div>
  );
}
