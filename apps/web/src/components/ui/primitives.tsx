'use client';

import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, TriangleAlert, WifiOff, X } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api';

export function Spinner({ size = 18, label = 'Cargando' }: { size?: number; label?: string }) {
  return <LoaderCircle size={size} className="spin" role="status" aria-label={label} />;
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'neutral' | 'gray'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const ESTADO_TONE: Record<string, 'green' | 'orange' | 'red' | 'gray'> = {
  pagada: 'green',
  pendiente: 'orange',
  vencida: 'red',
  anulada: 'gray',
};

export function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const network = error instanceof ApiError && error.isNetwork;
  const title = !network ? 'No se pudo cargar' : error.code === 'timeout' ? 'El servidor tardó demasiado' : 'Sin conexión';
  return (
    <div className="empty error-state" role="alert">
      <div className="empty-icon">{network ? <WifiOff size={26} /> : <TriangleAlert size={26} />}</div>
      <strong>{title}</strong>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-outline" onClick={onRetry}>
          <RefreshCw size={16} /> Reintentar
        </button>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  required?: boolean;
  className?: string;
}

export function Field({ label, error, hint, children, required, className }: FieldProps) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden> *</span>}
      </label>
      {children(id, descId)}
      {error ? (
        <span id={descId} className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={descId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; className?: string };

export function TextInput({ label, error, hint, className, required, ...rest }: InputProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id, desc) => <input id={id} className="input" aria-invalid={!!error} aria-describedby={desc} required={required} {...rest} />}
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; className?: string; children: ReactNode };

export function SelectInput({ label, error, hint, className, children, required, ...rest }: SelectProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id, desc) => (
        <select id={id} className="input" aria-invalid={!!error} aria-describedby={desc} required={required} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string; className?: string };

export function TextArea({ label, error, hint, className, required, ...rest }: TextareaProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id, desc) => <textarea id={id} className="input" aria-invalid={!!error} aria-describedby={desc} required={required} {...rest} />}
    </Field>
  );
}

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const modalStack: symbol[] = [];

export function Modal({ open, title, subtitle, onClose, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const self = Symbol('modal');
    modalStack.push(self);
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])') ?? []).filter(
        (el) => !el.hasAttribute('disabled'),
      );
    setTimeout(() => (focusables()[1] ?? focusables()[0])?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== self) return;
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      modalStack.splice(modalStack.indexOf(self), 1);
      if (!modalStack.length) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  tone = 'primary',
  busy,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'accent';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={`btn btn-${tone}`} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner size={16} />} {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
      {children}
    </Modal>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="pagination" aria-label="Paginación">
      <span>
        {from}–{to} de {total}
      </span>
      <div>
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft size={18} />
        </button>
        <span className="page-num">
          {page} / {pages}
        </span>
        <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ value: T; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          className={`tab ${value === it.value ? 'active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count !== undefined && <span className="tab-count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Maps server field errors (dot paths) to a flat record for form inputs. */
export function fieldErrorMap(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const fe of e.fieldErrors) if (!out[fe.field]) out[fe.field] = fe.message;
  return out;
}
