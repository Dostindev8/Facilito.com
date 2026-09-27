'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ScanBarcode, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useClickOutside, useDebounced } from '@/lib/hooks';
import { Badge } from '@/components/ui/primitives';
import { stockLabel, stockTone, type Page, type Product } from '@/components/inventory/types';

export interface ProductPickerHandle {
  focus: () => void;
}

export const ProductPicker = forwardRef<ProductPickerHandle, { onPick: (p: Product) => void; allowNegative: boolean }>(function ProductPicker(
  { onPick, allowNegative },
  handle,
) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q.trim(), 200);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);

  useImperativeHandle(handle, () => ({ focus: () => inputRef.current?.focus() }), []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    api<Page<Product>>('/v1/products', { query: { q: debounced, estado: 'activo', pageSize: 8, sort: 'nombre' } })
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setActive(0);
      })
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced, open]);

  const selectable = (p: Product) => allowNegative || p.permiteNegativo || Number(p.stockActual) > 0;

  const pick = (p: Product) => {
    if (!selectable(p)) return;
    onPick(p);
    setQ('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="product-picker" ref={ref}>
      <div className="search" style={{ maxWidth: 'none' }}>
        <Search size={18} aria-hidden />
        <label htmlFor="product-picker" className="sr-only">
          Agregar producto
        </label>
        <input
          ref={inputRef}
          id="product-picker"
          className="input"
          style={{ background: '#fff', borderColor: 'var(--line)' }}
          placeholder="Buscar producto por nombre, SKU o escanear código"
          value={q}
          autoComplete="off"
          maxLength={100}
          role="combobox"
          aria-expanded={open}
          aria-controls="product-picker-list"
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const exact = items.find((p) => p.codigoBarras && p.codigoBarras === q.trim());
              const target = exact ?? items[active];
              if (target) pick(target);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        <ScanBarcode size={18} aria-hidden style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
      </div>
      {open && (
        <div id="product-picker-list" className="picker-results" role="listbox" aria-label="Productos">
          {items.length === 0 ? (
            <p className="muted" style={{ padding: 12, fontSize: '0.9rem' }}>
              {loading ? 'Buscando…' : debounced ? `Sin productos para “${debounced}”.` : 'No hay productos activos.'}
            </p>
          ) : (
            items.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className="picker-item"
                disabled={!selectable(p)}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(p)}
              >
                <span className="grow">
                  <strong>{p.nombre}</strong>
                  <small>
                    {p.sku} · {qty(p.stockActual)} {p.unidad} disponibles
                  </small>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <strong>{money(p.precioVenta)}</strong>
                  {p.stockEstado !== 'ok' && <Badge tone={stockTone(p.stockEstado)}>{stockLabel(p.stockEstado)}</Badge>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
});
