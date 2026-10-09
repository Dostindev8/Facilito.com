import type { ReactNode } from 'react';
import { CookieBanner } from '@/components/marketing/cookie-banner';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { SmoothScroll } from '@/components/marketing/smooth-scroll';
import { WhatsAppButton } from '@/components/marketing/whatsapp-button';
import './marketing.css';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mkt">
      <a className="skip-link mkt-skip" href="#contenido">
        Saltar al contenido
      </a>
      <SmoothScroll />
      <SiteHeader />
      <main id="contenido" className="mkt-main">
        {children}
      </main>
      <SiteFooter />
      <WhatsAppButton />
      <CookieBanner />
    </div>
  );
}
