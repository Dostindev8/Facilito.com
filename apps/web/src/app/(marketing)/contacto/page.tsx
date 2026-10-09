import { ContactForm } from '@/components/marketing/contact-form';
import { JsonLd } from '@/components/marketing/json-ld';
import { CONTACT_MOTIVES } from '@/lib/validations/contact';
import { breadcrumbJsonLd, pageMeta } from '@/lib/seo';
import { site, whatsappHref, WHATSAPP_DEMO_TEXT } from '@/lib/site';

export const metadata = pageMeta({
  title: 'Contacto',
  description: 'Pide una demo o escribe a Facilito. Santo Domingo, República Dominicana.',
  path: '/contacto',
});

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const initial = CONTACT_MOTIVES.find((item) => item === motivo) ?? 'ventas';
  const wa = whatsappHref(WHATSAPP_DEMO_TEXT);
  const map = 'https://www.google.com/maps/search/?api=1&query=Santo%20Domingo%20Republica%20Dominicana';

  return (
    <div className="mkt-wrap mkt-page-head" style={{ paddingBottom: 72 }}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Inicio', path: '/' },
          { name: 'Contacto', path: '/contacto' },
        ])}
      />
      <h1>Contacto</h1>
      <p>Cuéntanos del negocio. Si el correo no está configurado en el servidor, el formulario lo dice claro y no finge que envió.</p>
      <div className="mkt-contact">
        <ContactForm initialMotivo={initial} />
        <aside className="mkt-contact-side">
          <h2>También por aquí</h2>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          ) : (
            <p>El WhatsApp se publica cuando el negocio configura NEXT_PUBLIC_WHATSAPP_E164.</p>
          )}
          {site.email ? <a href={`mailto:${site.email}`}>{site.email}</a> : <p>Correo público pendiente de configurar.</p>}
          <p>
            {site.city}, {site.country}
          </p>
          <a href={map} target="_blank" rel="noopener noreferrer">
            Ver Santo Domingo en el mapa
          </a>
        </aside>
      </div>
    </div>
  );
}
