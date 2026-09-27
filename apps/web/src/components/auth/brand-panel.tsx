import { FileText, MapPin, Package, ShoppingCart } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

const VALUES = [
  { icon: ShoppingCart, tone: 'green', title: 'Ventas rápidas', detail: 'Punto de venta ágil' },
  { icon: Package, tone: 'orange', title: 'Inventario', detail: 'Control total' },
  { icon: FileText, tone: 'blue', title: 'Facturación', detail: 'Sin complicaciones' },
] as const;

export function BrandPanel() {
  return (
    <section className="brand-panel" aria-label="Facilito">
      <div className="brand-logo">
        <Logo size={64} priority />
      </div>
      <h1>
        Tu negocio, <em>más fácil</em>
        <br /> cada día
      </h1>
      <p className="brand-sub">Controla tus ventas, inventario y facturación desde un solo lugar, sin complicaciones.</p>
      <ul className="value-list">
        {VALUES.map(({ icon: Icon, tone, title, detail }) => (
          <li key={title} className="value-item">
            <span className={`value-icon ${tone}`}>
              <Icon size={22} aria-hidden />
            </span>
            <div>
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="script-line">Más tiempo para lo importante</p>
      <div className="brand-foot">
        <span>
          <MapPin size={16} aria-hidden /> Santo Domingo, República Dominicana
        </span>
        <span className="muted">Tu aliado en la gestión de tu negocio</span>
      </div>
    </section>
  );
}
