'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage, newClientUuid } from '@/lib/api';
import { MOTIVO_LABEL, qty } from '@/lib/format';
import { Modal, SelectInput, Spinner, TextArea, TextInput, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { Product } from './types';

type Tipo = 'entrada' | 'salida' | 'fijar';

const MOTIVOS_POR_TIPO: Record<Tipo, string[]> = {
  entrada: ['compra', 'devolucion', 'ajuste'],
  salida: ['merma', 'devolucion', 'ajuste'],
  fijar: ['conteo_fisico', 'ajuste'],
};

export function AdjustModal({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [tipo, setTipo] = useState<Tipo>('entrada');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [clientUuid, setClientUuid] = useState(newClientUuid);

  useEffect(() => {
    if (!product) return;
    setTipo('entrada');
    setCantidad('');
    setMotivo('');
    setNota('');
    setErrors({});
    setAlert(null);
    setClientUuid(newClientUuid());
  }, [product]);

  if (!product) return null;
  const stock = Number(product.stockActual);
  const n = Number(cantidad || 0);
  const resultante = tipo === 'entrada' ? stock + n : tipo === 'salida' ? stock - n : n;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\d{1,12}(\.\d{1,4})?$/.test(cantidad)) errs.cantidad = 'Cantidad inválida';
    else if (tipo !== 'fijar' && n <= 0) errs.cantidad = 'Debe ser mayor que cero';
    else if (tipo === 'salida' && n > stock && !product.permiteNegativo) errs.cantidad = `Solo hay ${qty(stock)} en existencia`;
    if (!motivo) errs.motivo = 'El motivo es obligatorio';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setAlert(null);
    try {
      const r = await api<{ stockActual: string; duplicate: boolean }>(`/v1/products/${product.id}/adjust`, {
        method: 'POST',
        body: { tipo, cantidad, motivo, nota: nota.trim() || null, clientUuid },
      });
      toast.success('Inventario ajustado', `${product.nombre}: ahora hay ${qty(r.stockActual)} ${product.unidad}`);
      onDone();
    } catch (err) {
      setErrors(fieldErrorMap(err));
      setAlert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Ajustar inventario"
      subtitle={`${product.nombre} · Stock actual: ${qty(product.stockActual)} ${product.unidad}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="adjust-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={16} />} Registrar ajuste
          </button>
        </>
      }
    >
      <form id="adjust-form" className="stack" onSubmit={submit} noValidate>
        {alert && (
          <div className="form-alert" role="alert">
            <TriangleAlert size={18} /> <span>{alert}</span>
          </div>
        )}
        <div className="segmented" role="group" aria-label="Tipo de ajuste">
          {(
            [
              ['entrada', 'Entrada', ArrowDownToLine],
              ['salida', 'Salida', ArrowUpFromLine],
              ['fijar', 'Conteo', ClipboardCheck],
            ] as const
          ).map(([v, l, Icon]) => (
            <button
              key={v}
              type="button"
              aria-pressed={tipo === v}
              onClick={() => {
                setTipo(v);
                setMotivo('');
              }}
            >
              <Icon size={16} aria-hidden /> {l}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <TextInput
            label={tipo === 'fijar' ? 'Cantidad contada' : 'Cantidad'}
            required
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value.replace(/[^\d.]/g, ''))}
            error={errors.cantidad}
            hint={cantidad ? `Quedará en ${qty(resultante)} ${product.unidad}` : undefined}
            autoFocus
          />
          <SelectInput label="Motivo" required value={motivo} onChange={(e) => setMotivo(e.target.value)} error={errors.motivo}>
            <option value="">Selecciona…</option>
            {MOTIVOS_POR_TIPO[tipo].map((m) => (
              <option key={m} value={m}>
                {MOTIVO_LABEL[m]}
              </option>
            ))}
          </SelectInput>
          <TextArea label="Nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} rows={2} className="span-2" placeholder="Detalle opcional (queda en la bitácora)" />
        </div>
        {resultante < 0 && !product.permiteNegativo && (
          <div className="form-alert" role="alert">
            <TriangleAlert size={18} /> <span>El stock no puede quedar en negativo.</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
