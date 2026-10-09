import Link from 'next/link';
import { site, whatsappHref, WHATSAPP_DEMO_TEXT } from '@/lib/site';

export function WhatsAppButton() {
  const href = whatsappHref(WHATSAPP_DEMO_TEXT);
  if (!href) return null;
  return (
    <a className="mkt-wa" href={href} target="_blank" rel="noopener noreferrer">
      WhatsApp
    </a>
  );
}

export function RegisterCta({ children }: { children: string }) {
  return (
    <Link className="btn btn-primary" href={site.registerPath} prefetch={false}>
      {children}
    </Link>
  );
}
