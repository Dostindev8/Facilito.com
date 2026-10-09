/**
 * Public brand facts. Secrets never belong here — only NEXT_PUBLIC_* and non-sensitive defaults.
 * SMTP and API keys stay in server-only modules.
 */

const LOCAL_URL = 'http://localhost:3000';

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function siteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.WEB_PUBLIC_URL || LOCAL_URL;
  try {
    return new URL(trimSlash(raw));
  } catch {
    return new URL(LOCAL_URL);
  }
}

export const site = {
  name: 'Facilito',
  legalName: 'Facilito by Logic Code Spot',
  maker: 'Logic Code Spot',
  tagline: 'Tu negocio, más fácil cada día',
  closing: 'Más tiempo para lo importante',
  description:
    'Controla ventas, inventario y facturación desde un solo lugar. Hecho en República Dominicana, para negocios dominicanos.',
  locale: 'es_DO' as const,
  lang: 'es-DO' as const,
  city: 'Santo Domingo',
  country: 'República Dominicana',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ?? '',
  /** Digits only, country code included. Empty until the business publishes a line. */
  whatsappE164: (process.env.NEXT_PUBLIC_WHATSAPP_E164 ?? '').replace(/\D/g, ''),
  registerPath: '/register',
  loginPath: '/login',
  panelPath: '/inicio',
} as const;

export function absoluteUrl(path: string): string {
  const base = siteUrl().toString().replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function whatsappHref(text: string): string | null {
  if (!site.whatsappE164) return null;
  return `https://wa.me/${site.whatsappE164}?text=${encodeURIComponent(text)}`;
}

export const WHATSAPP_DEMO_TEXT = 'Hola, quiero una demo de Facilito para mi negocio.';
