import { PricingFaq } from '@/components/marketing/pricing-faq';
import { PricingTable } from '@/components/marketing/pricing-table';
import { JsonLd } from '@/components/marketing/json-ld';
import { pricingFaqs } from '@/content/pricing';
import { breadcrumbJsonLd, faqJsonLd, pageMeta } from '@/lib/seo';

export const metadata = pageMeta({
  title: 'Precios',
  description: 'Planes mensuales de Facilito en pesos dominicanos. Pagas por transferencia y activamos tu cuenta.',
  path: '/precios',
});

export default function PricingPage() {
  return (
    <div className="mkt-wrap mkt-page-head" style={{ paddingBottom: 72 }}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Inicio', path: '/' },
          { name: 'Precios', path: '/precios' },
        ])}
      />
      <JsonLd data={faqJsonLd([...pricingFaqs])} />
      <h1>Precios</h1>
      <p>Un plan mensual, sin contrato. Cancelas cuando quieras desde tu panel.</p>
      <PricingTable />
      <h2 style={{ marginTop: 40 }}>Preguntas frecuentes</h2>
      <PricingFaq />
    </div>
  );
}
