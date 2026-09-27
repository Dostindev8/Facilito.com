'use client';

import { useCallback, useEffect, useState } from 'react';
import { User, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useClickOutside, useDebounced } from '@/lib/hooks';

export interface CustomerChoice {
  id: string | null;
  nombre: string;
}

interface Customer {
  id: string;
  nombre: string;
  telefono: string | null;
  documento: string | null;
}

export function CustomerPicker({ value, onChange }: { value: CustomerChoice; onChange: (c: CustomerChoice) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Customer[]>([]);
  const debounced = useDebounced(q.trim(), 250);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<{ items: Customer[] }>('/v1/customers', { query: { q: debounced, pageSize: 8 } })
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [debounced, open]);

  const isGeneral = !value.id && value.nombre === 'Cliente general';

  return (
    <div className="field product-picker" ref={ref}>
      <label htmlFor="customer-search">Cliente</label>
      {!isGeneral ? (
        <div className="row" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '6px 6px 6px 14px', minHeight: 46 }}>
          <User size={18} className="text-green" aria-hidden />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{value.nombre}</strong>
            {!value.id && <small className="muted"> · ocasional</small>}
          </span>
          <button type="button" className="icon-btn" aria-label="Quitar cliente" onClick={() => onChange({ id: null, nombre: 'Cliente general' })}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <input
          id="customer-search"
          className="input"
          placeholder="Cliente general · buscar o escribir nombre"
          value={q}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      )}
      {open && isGeneral && (
        <div className="picker-results" role="listbox" aria-label="Clientes">
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={false}
              className="picker-item"
              onClick={() => {
                onChange({ id: c.id, nombre: c.nombre });
                setQ('');
                setOpen(false);
              }}
            >
              <User size={16} className="text-green" aria-hidden />
              <span className="grow">
                <strong>{c.nombre}</strong>
                <small>{[c.telefono, c.documento].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</small>
              </span>
            </button>
          ))}
          {q.trim().length >= 2 && (
            <button
              type="button"
              className="picker-item"
              onClick={() => {
                onChange({ id: null, nombre: q.trim().slice(0, 200) });
                setQ('');
                setOpen(false);
              }}
            >
              <UserPlus size={16} className="text-green" aria-hidden />
              <span className="grow">
                <strong>Usar “{q.trim()}”</strong>
                <small>Cliente ocasional (no se guarda en la lista)</small>
              </span>
            </button>
          )}
          {items.length === 0 && q.trim().length < 2 && <p className="muted" style={{ padding: 10, fontSize: '0.85rem' }}>Sin clientes registrados. Escribe un nombre.</p>}
        </div>
      )}
    </div>
  );
}
