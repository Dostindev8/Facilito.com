'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { useAuth } from '@/lib/auth';
import { site } from '@/lib/site';

const LINKS = [
  { href: '/features', label: 'Producto' },
  { href: '/precios', label: 'Precios' },
  { href: '/nosotros', label: 'Nosotros' },
  { href: '/contacto', label: 'Contacto' },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { status } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const authed = mounted && status === 'authenticated';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    const focusable = () => [...(root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        burgerRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="mkt-header">
      <Link href="/" aria-label="Facilito, inicio">
        <Logo size={40} priority />
      </Link>
      <nav className="mkt-nav" aria-label="Secciones">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="mkt-header-cta">
        {authed ? (
          <Link className="btn btn-primary" href={site.panelPath}>
            Ir a mi negocio
          </Link>
        ) : (
          <>
            <Link className="mkt-login-link" href={site.loginPath} prefetch={false}>
              Iniciar sesión
            </Link>
            <Link className="btn btn-primary" href={site.subscribePath} prefetch={false}>
              Suscribirme
            </Link>
          </>
        )}
        <button
          ref={burgerRef}
          type="button"
          className="icon-btn mkt-burger"
          aria-expanded={open}
          aria-controls={labelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
          <span className="sr-only">{open ? 'Cerrar menú' : 'Abrir menú'}</span>
        </button>
      </div>
      {open && (
        <div ref={panelRef} id={labelId} className="mkt-menu" role="dialog" aria-modal="true" aria-label="Menú">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          {!authed && (
            <Link href={site.loginPath} onClick={() => setOpen(false)} prefetch={false}>
              Iniciar sesión
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
