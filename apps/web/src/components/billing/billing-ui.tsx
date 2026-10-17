'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { Check, Copy, FileText, ImageUp, Landmark, X } from 'lucide-react';
import type { SubscriptionState } from '@/lib/api';
import { Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

export interface BankInstructions {
  banco: string;
  cuenta: string;
  tipoCuenta: string;
  titular: string;
  documentoTitular: string;
}

export const STATE_LABEL: Record<SubscriptionState, string> = {
  PENDIENTE_PAGO: 'Esperando pago',
  PENDIENTE_AUTORIZACION: 'En revisión',
  ACTIVA: 'Activa',
  EN_GRACIA: 'En periodo de gracia',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  RECHAZADA: 'Rechazada',
};

const STATE_TONE: Record<SubscriptionState, 'green' | 'orange' | 'red' | 'blue' | 'gray'> = {
  PENDIENTE_PAGO: 'gray',
  PENDIENTE_AUTORIZACION: 'blue',
  ACTIVA: 'green',
  EN_GRACIA: 'orange',
  SUSPENDIDA: 'red',
  CANCELADA: 'gray',
  RECHAZADA: 'red',
};

export function StateBadge({ estado }: { estado: SubscriptionState }) {
  return <Badge tone={STATE_TONE[estado]}>{STATE_LABEL[estado]}</Badge>;
}

export function dop(centavos: number, moneda = 'DOP'): string {
  const value = centavos / 100;
  const amount = value.toLocaleString('es-DO', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return moneda === 'DOP' ? `RD$${amount}` : `${moneda} ${amount}`;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.info('Copia manualmente', value);
    }
  };
  return (
    <div className="bank-row">
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        <button type="button" className="icon-btn" onClick={copy} aria-label={`Copiar ${label.toLowerCase()}`}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        </button>
      </dd>
    </div>
  );
}

export function BankCard({ banco, monto, referencia }: { banco: BankInstructions; monto?: string; referencia?: string }) {
  return (
    <section className="bank-card" aria-labelledby="bank-title">
      <header>
        <span className="kpi-icon tone-green" aria-hidden>
          <Landmark size={20} />
        </span>
        <div>
          <h3 id="bank-title">Transferencia bancaria</h3>
          <p>Desde tu banco o app, a esta cuenta:</p>
        </div>
      </header>
      <dl>
        <CopyRow label="Banco" value={banco.banco} />
        <CopyRow label="Cuenta" value={banco.cuenta} />
        <CopyRow label="Tipo" value={banco.tipoCuenta} />
        <CopyRow label="A nombre de" value={banco.titular} />
        {banco.documentoTitular && <CopyRow label="RNC / cédula" value={banco.documentoTitular} />}
        {monto && <CopyRow label="Monto" value={monto} />}
        {referencia && <CopyRow label="Concepto" value={referencia} />}
      </dl>
    </section>
  );
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1800;

/** Phone photos are often 3–6 MB; shrink them in the browser so they fit the 2 MB limit. PDFs go as-is. */
async function prepare(file: File): Promise<File> {
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file;
  if (file.size <= MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

export function ReceiptPicker({ file, onChange, error, disabled }: { file: File | null; onChange: (f: File | null, error?: string) => void; error?: string; disabled?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [working, setWorking] = useState(false);

  const accept = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(png|jpe?g|webp|pdf)$/i.test(f.name)) return onChange(null, 'Sube una foto (JPG, PNG o WebP) o el PDF del banco.');
    setWorking(true);
    try {
      const ready = await prepare(f);
      if (ready.size > MAX_BYTES) return onChange(null, 'El archivo pesa más de 2 MB. Sube una captura de pantalla del comprobante.');
      onChange(ready);
    } finally {
      setWorking(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (!disabled) void accept(e.dataTransfer.files[0]);
  };

  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label" id={`${id}-label`}>
        Comprobante de la transferencia
      </span>
      {file ? (
        <div className="receipt-file">
          {file.type === 'application/pdf' ? <FileText size={20} aria-hidden /> : <ImageUp size={20} aria-hidden />}
          <span>
            <strong>{file.name}</strong>
            <small>{(file.size / 1024).toFixed(0)} KB</small>
          </span>
          <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label="Quitar archivo" disabled={disabled}>
            <X size={18} />
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={`receipt-drop ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <ImageUp size={26} aria-hidden />
          <strong>{working ? 'Preparando archivo…' : 'Toca para subir la foto o el PDF'}</strong>
          <small>Captura de la app del banco, foto del voucher o PDF. Máximo 2 MB.</small>
        </label>
      )}
      <input
        ref={input}
        id={id}
        type="file"
        className="sr-only"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        aria-labelledby={`${id}-label`}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        disabled={disabled || working}
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && (
        <span id={`${id}-err`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
