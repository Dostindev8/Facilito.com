import type { ReactNode } from 'react';
import Link from 'next/link';
import { CookieBanner } from '@/components/marketing/cookie-banner';
import { Logo } from '@/components/brand/logo';
import { site } from '@/lib/site';
import './marketing.css';

/** Slim public chrome for checkout and legal — not the marketing landing (that lives on facilitord-web). */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mkt public-app">
      <a className="skip-link mkt-skip" href="#contenido">
        Saltar al contenido
      </a>
      <header className="public-top">
        <Link href="/login" className="public-top-brand" aria-label="Facilito — iniciar sesión">
          <Logo size={36} />
        </Link>
        <nav className="public-top-nav" aria-label="Accesos">
          <a href={site.marketingUrl} rel="noopener noreferrer">
            Sitio web
          </a>
          <Link href="/login" className="btn btn-primary">
            Iniciar sesión
          </Link>
        </nav>
      </header>
      <main id="contenido" className="mkt-main public-main">
        {children}
      </main>
      <footer className="public-foot">
        <p>
          © {new Date().getFullYear()} {site.legalName}
        </p>
        <nav aria-label="Legal">
          <Link href="/legal/privacidad">Privacidad</Link>
          <Link href="/legal/terminos">Términos</Link>
          <Link href="/legal/cookies">Cookies</Link>
          <a href={site.marketingUrl} rel="noopener noreferrer">
            Marketing
          </a>
        </nav>
      </footer>
      <CookieBanner />
    </div>
  );
}
