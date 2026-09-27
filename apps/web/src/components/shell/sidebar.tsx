'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  ChartColumn,
  ChevronRight,
  FileText,
  Headphones,
  House,
  MapPin,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Modal } from '@/components/ui/primitives';

export const NAV = [
  { href: '/inicio', label: 'Inicio', icon: House },
  { href: '/ventas', label: 'Ventas', icon: ShoppingCart },
  { href: '/inventario', label: 'Inventario', icon: Package },
  { href: '/facturacion', label: 'Facturación', icon: FileText },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/proveedores', label: 'Proveedores', icon: Truck },
  { href: '/reportes', label: 'Reportes', icon: ChartColumn },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
] as const;

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [support, setSupport] = useState(false);

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
        <nav className="nav">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`nav-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={label}
                onClick={onClose}
              >
                <Icon size={20} aria-hidden />
                <span className="nav-label">{label}</span>
                <ChevronRight size={16} className="chev" aria-hidden />
              </Link>
            );
          })}
        </nav>
        <div className="support-card">
          <strong>Tu negocio en buenas manos</strong>
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
        </div>
        <div className="sidebar-foot">
          <span>
            <MapPin size={14} aria-hidden /> Santo Domingo, R.D.
          </span>
          <span>Tu negocio, más simple.</span>
        </div>
      </aside>
      <Modal open={support} onClose={() => setSupport(false)} title="Soporte Facilito" subtitle="Logic Code Spot" size="sm">
        <div className="stack">
          <p>Estas guías rápidas resuelven las dudas más comunes:</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>
              <strong>Inventario:</strong> importa tus productos desde un CSV con la plantilla en Inventario → Importar.
            </li>
            <li>
              <strong>Facturas:</strong> configura tus secuencias NCF en Configuración → Comprobantes antes de emitir con valor fiscal.
            </li>
            <li>
              <strong>Anulaciones:</strong> una factura anulada conserva su número y devuelve el stock automáticamente.
            </li>
          </ul>
          <p className="muted">El canal de contacto directo se habilitará cuando el negocio configure su línea de soporte.</p>
        </div>
      </Modal>
    </>
  );
}
