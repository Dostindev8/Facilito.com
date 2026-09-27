'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FileText, Package, Search, User } from 'lucide-react';
import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useClickOutside, useDebounced } from '@/lib/hooks';
import { Spinner } from '@/components/ui/primitives';

interface SearchResult {
  productos: Array<{ id: string; nombre: string; sku: string; stock: string; precio: string }>;
  clientes: Array<{ id: string; nombre: string; telefono: string | null }>;
  facturas: Array<{ id: string; numero: string; cliente_nombre: string; total: string; ncf: string | null }>;
}

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SearchResult | null>(null);
  const debounced = useDebounced(q.trim(), 300);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);

  useEffect(() => {
    if (debounced.length < 2) {
      setRes(null);
      return;
    }
    let alive = true;
    setBusy(true);
    api<SearchResult>('/v1/search', { query: { q: debounced } })
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ productos: [], clientes: [], facturas: [] }))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [debounced]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  const empty = res && !res.productos.length && !res.clientes.length && !res.facturas.length;

  return (
    <div className="search" ref={ref} role="search">
      <Search size={18} aria-hidden />
      <label htmlFor="global-search" className="sr-only">
        Buscar productos, clientes, ventas
      </label>
      <input
        id="global-search"
        className="input"
        type="search"
        placeholder="Buscar productos, clientes, ventas..."
        autoComplete="off"
        value={q}
        maxLength={100}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && debounced.length >= 2}
        aria-controls="global-search-results"
      />
      {open && debounced.length >= 2 && (
        <div id="global-search-results" className="search-results">
          {busy && !res ? (
            <div className="row" style={{ padding: 12 }}>
              <Spinner /> <span className="muted">Buscando…</span>
            </div>
          ) : empty ? (
            <p className="muted" style={{ padding: 12 }}>
              Sin resultados para “{debounced}”.
            </p>
          ) : res ? (
            <>
              {res.productos.length > 0 && (
                <div className="search-group">
                  <h4>Productos</h4>
                  {res.productos.map((p) => (
                    <button key={p.id} type="button" className="search-item" onClick={() => go(`/inventario?producto=${p.id}`)}>
                      <Package size={16} className="text-green" aria-hidden />
                      <span>
                        {p.nombre} <small>· {p.sku}</small>
                      </span>
                      <small>
                        {money(p.precio)} · {qty(p.stock)} u.
                      </small>
                    </button>
                  ))}
                </div>
              )}
              {res.clientes.length > 0 && (
                <div className="search-group">
                  <h4>Clientes</h4>
                  {res.clientes.map((c) => (
                    <button key={c.id} type="button" className="search-item" onClick={() => go(`/clientes?id=${c.id}`)}>
                      <User size={16} className="text-green" aria-hidden />
                      <span>{c.nombre}</span>
                      {c.telefono && <small>{c.telefono}</small>}
                    </button>
                  ))}
                </div>
              )}
              {res.facturas.length > 0 && (
                <div className="search-group">
                  <h4>Facturas</h4>
                  {res.facturas.map((f) => (
                    <button key={f.id} type="button" className="search-item" onClick={() => go(`/facturacion/${f.id}`)}>
                      <FileText size={16} className="text-green" aria-hidden />
                      <span>
                        {f.numero} <small>· {f.cliente_nombre}</small>
                      </span>
                      <small>{money(f.total)}</small>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
