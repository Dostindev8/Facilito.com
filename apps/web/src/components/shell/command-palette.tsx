'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Package, Search, User } from 'lucide-react';
import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { featureEnabled } from '@/lib/features';
import { NAV_GROUPS } from '@/lib/nav';
import { Spinner } from '@/components/ui/primitives';

type Hit =
  | { kind: 'nav'; href: string; label: string; group: string }
  | { kind: 'producto'; href: string; label: string; meta: string }
  | { kind: 'cliente'; href: string; label: string; meta: string }
  | { kind: 'factura'; href: string; label: string; meta: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<Hit[]>([]);
  const [idx, setIdx] = useState(0);

  const enabled = featureEnabled('commandPalette');

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  useEffect(() => {
    if (!open) {
      setQ('');
      setRemote([]);
      setIdx(0);
    }
  }, [open]);

  const navHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Hit[] = [];
    for (const g of NAV_GROUPS) {
      for (const i of g.items) {
        if (!i.ready && !featureEnabled('navPreview')) continue;
        if (needle && !i.label.toLowerCase().includes(needle) && !g.label.toLowerCase().includes(needle)) continue;
        out.push({ kind: 'nav', href: i.href, label: i.label, group: g.label });
      }
    }
    return out.slice(0, 8);
  }, [q]);

  useEffect(() => {
    const needle = q.trim();
    if (!open || needle.length < 2) {
      setRemote([]);
      return;
    }
    let alive = true;
    setBusy(true);
    api<{
      productos: Array<{ id: string; nombre: string; sku: string; stock: string; precio: string }>;
      clientes: Array<{ id: string; nombre: string; telefono: string | null }>;
      facturas: Array<{ id: string; numero: string; cliente_nombre: string; total: string }>;
    }>('/v1/search', { query: { q: needle } })
      .then((r) => {
        if (!alive) return;
        const hits: Hit[] = [
          ...r.productos.map((p) => ({
            kind: 'producto' as const,
            href: `/inventario?producto=${p.id}`,
            label: p.nombre,
            meta: `${p.sku} · ${money(p.precio)} · ${qty(p.stock)} u.`,
          })),
          ...r.clientes.map((c) => ({
            kind: 'cliente' as const,
            href: `/clientes?id=${c.id}`,
            label: c.nombre,
            meta: c.telefono ?? 'Cliente',
          })),
          ...r.facturas.map((f) => ({
            kind: 'factura' as const,
            href: `/facturacion/${f.id}`,
            label: f.numero,
            meta: `${f.cliente_nombre} · ${money(f.total)}`,
          })),
        ];
        setRemote(hits.slice(0, 12));
      })
      .catch(() => alive && setRemote([]))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [q, open]);

  const hits = useMemo(() => [...navHits, ...remote], [navHits, remote]);

  useEffect(() => setIdx(0), [hits.length, q]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  if (!enabled || !open) return null;

  return (
    <div className="cmdk-backdrop" role="presentation" onClick={() => setOpen(false)}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en Facilito"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input-row">
          <Search size={18} aria-hidden />
          <input
            autoFocus
            className="input"
            placeholder="Ir a… o buscar productos, clientes, facturas"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && hits[idx]) {
                e.preventDefault();
                go(hits[idx]!.href);
              }
            }}
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <div className="cmdk-list" role="listbox">
          {busy && q.trim().length >= 2 && hits.length === 0 ? (
            <div className="cmdk-empty">
              <Spinner /> Buscando…
            </div>
          ) : hits.length === 0 ? (
            <div className="cmdk-empty muted">Escribe para buscar o navegar por módulos.</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.kind}-${h.href}-${h.label}`}
                type="button"
                role="option"
                aria-selected={i === idx}
                className={`cmdk-item ${i === idx ? 'active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(h.href)}
              >
                {h.kind === 'nav' && <span className="cmdk-kind">{h.group}</span>}
                {h.kind === 'producto' && <Package size={16} className="text-green" aria-hidden />}
                {h.kind === 'cliente' && <User size={16} className="text-green" aria-hidden />}
                {h.kind === 'factura' && <FileText size={16} className="text-green" aria-hidden />}
                <span className="cmdk-label">{h.label}</span>
                {'meta' in h && <small className="muted">{h.meta}</small>}
                {h.kind === 'nav' && <small className="muted">{h.href}</small>}
              </button>
            ))
          )}
        </div>
        <footer className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> mover
          </span>
          <span>
            <kbd>Enter</kbd> abrir
          </span>
          <span>
            <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd>
          </span>
        </footer>
      </div>
    </div>
  );
}
