import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { site, whatsappHref, WHATSAPP_DEMO_TEXT } from '@/lib/site';

const PRODUCT = [
  { href: '/features', label: 'Producto' },
  { href: '/precios', label: 'Precios' },
  { href: '/nosotros', label: 'Nosotros' },
  { href: '/contacto', label: 'Contacto' },
] as const;

const LEGAL = [
  { href: '/legal/privacidad', label: 'Privacidad' },
  { href: '/legal/terminos', label: 'Términos' },
  { href: '/legal/cookies', label: 'Cookies' },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();
  const wa = whatsappHref(WHATSAPP_DEMO_TEXT);
  return (
    <footer className="mkt-footer">
      <div className="mkt-wrap mkt-footer-grid">
        <div>
          <Logo size={40} />
          <p>by {site.maker}</p>
          <p>
            {site.city}, {site.country}
          </p>
        </div>
        <nav aria-label="Pie">
          {PRODUCT.map((link) => (
            <div key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </div>
          ))}
        </nav>
        <div>
          <nav aria-label="Legal">
            {LEGAL.map((link) => (
              <div key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </div>
            ))}
          </nav>
          {site.email ? (
            <p>
              <a href={`mailto:${site.email}`}>{site.email}</a>
            </p>
          ) : null}
          {wa ? (
            <p>
              <a href={wa} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </p>
          ) : null}
          <p>
            <a href="#contenido">Volver arriba</a>
          </p>
          <small>
            © {year} {site.legalName}
          </small>
        </div>
      </div>
    </footer>
  );
}
