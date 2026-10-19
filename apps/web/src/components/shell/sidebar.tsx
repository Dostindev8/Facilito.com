'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ChevronRight, Headphones, MapPin, ShieldCheck, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Modal } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { featureEnabled } from '@/lib/features';
import { NAV_GROUPS, type NavItem } from '@/lib/nav';

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL;

function isActive(pathname: string, item: NavItem) {
  const base = item.match ?? item.href.split('?')[0]!;
  if (base === '/inicio') return pathname === '/inicio';
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [support, setSupport] = useState(false);
  const [supportCollapsed, setSupportCollapsed] = useState(false);

  const groups = useMemo(() => {
    const showPreview = featureEnabled('navPreview');
    return NAV_GROUPS.map((g) => {
      let items = g.items.filter((i) => i.ready || showPreview);
      if (g.id === 'admin') {
        items = items.filter((i) => {
          if (i.href === '/suscripcion') {
            return !user?.platformAdmin && (user?.rol === 'owner' || user?.rol === 'manager');
          }
          return true;
        });
      }
      return { ...g, items };
    }).filter((g) => g.items.length > 0);
  }, [user?.platformAdmin, user?.rol]);

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} aria-hidden />}
      <aside id="app-sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="Menú principal">
        <div className="sidebar-brand">
          <Link href="/inicio" onClick={onClose} aria-label="Facilito, ir al inicio">
            <Logo size={44} />
          </Link>
          {open && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar menú">
              <X size={20} />
            </button>
          )}
        </div>

        <nav className="nav nav-grouped">
          {user?.platformAdmin && (
            <div className="nav-group">
              <p className="nav-group-label">Plataforma</p>
              <Link
                href="/admin"
                className={`nav-item ${pathname.startsWith('/admin') ? 'active' : ''}`}
                aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
                onClick={onClose}
              >
                <ShieldCheck size={20} aria-hidden />
                <span className="nav-label">Admin plataforma</span>
                <ChevronRight size={16} className="chev" aria-hidden />
              </Link>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.id} className="nav-group">
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item);
                const soon = !item.ready;
                return (
                  <Link
                    key={`${group.id}-${item.href}-${item.label}`}
                    href={item.href}
                    className={`nav-item ${active ? 'active' : ''} ${soon ? 'nav-item-soon' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={soon ? `${item.label} · Próximamente` : item.label}
                    onClick={onClose}
                  >
                    <Icon size={20} aria-hidden />
                    <span className="nav-label">{item.label}</span>
                    {soon && <span className="nav-soon-badge">Pronto</span>}
                    <ChevronRight size={16} className="chev" aria-hidden />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`support-card ${supportCollapsed ? 'collapsed' : ''}`}>
          <div className="support-card-head">
            <strong>Tu negocio en buenas manos</strong>
            <button
              type="button"
              className="support-collapse"
              onClick={() => setSupportCollapsed((c) => !c)}
              aria-expanded={!supportCollapsed}
              aria-label={supportCollapsed ? 'Expandir soporte' : 'Contraer soporte'}
            >
              {supportCollapsed ? '+' : '−'}
            </button>
          </div>
          {!supportCollapsed && (
            <>
              <p>¿Tienes dudas? Nuestro equipo te ayuda a sacarle el máximo a Facilito.</p>
              {SUPPORT_URL ? (
                <a className="btn btn-primary btn-sm" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
                  <Headphones size={16} /> Soporte
                </a>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setSupport(true)}>
                  <Headphones size={16} /> Soporte
                </button>
              )}
            </>
          )}
        </div>
        <div className="sidebar-foot">
          <span>
            <MapPin size={14} aria-hidden /> Santo Domingo, R.D.
          </span>
          <span>Tu negocio, más simple.</span>
        </div>
      </aside>

      <Modal open={support} onClose={() => setSupport(false)} title="Soporte Facilito" size="sm">
        <p className="muted" style={{ marginBottom: 12 }}>
          Escríbenos y te ayudamos con tu cuenta, facturación o configuración del negocio.
        </p>
        <p>
          Correo:{' '}
          <a href="mailto:soporte@logiccodespot.com" className="link-btn">
            soporte@logiccodespot.com
          </a>
        </p>
      </Modal>
    </>
  );
}

/** @deprecated Prefer NAV_GROUPS — kept for any external import of flat NAV. */
export const NAV = NAV_GROUPS.flatMap((g) => g.items.filter((i) => i.ready)).map(({ href, label, icon }) => ({
  href,
  label,
  icon,
}));
