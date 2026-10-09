import { JsonLd } from '@/components/marketing/json-ld';
import { breadcrumbJsonLd, pageMeta } from '@/lib/seo';
import { site } from '@/lib/site';

export const metadata = pageMeta({
  title: 'Nosotros',
  description: 'Facilito es de Logic Code Spot, en Santo Domingo. Software de gestión para negocios dominicanos.',
  path: '/nosotros',
});

export default function AboutPage() {
  return (
    <article className="mkt-legal">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Inicio', path: '/' },
          { name: 'Nosotros', path: '/nosotros' },
        ])}
      />
      <h1>Nosotros</h1>
      <p>
        {site.legalName} nace en {site.city} para que un colmado, una ferretería o un salón no dependan de un cuaderno y de tres hojas de cálculo para saber si el día cerró bien.
      </p>
      <h2>La misión</h2>
      <p>
        Menos fricción en la caja y en el inventario. El lema es simple: {site.tagline} El cierre que buscamos: {site.closing}
      </p>
      <h2>Quién lo hace</h2>
      <p>
        {site.maker} diseña y mantiene Facilito. No publicamos cifras de clientes ni reseñas: preferimos que el producto se vea en el panel, no en una estrella inventada.
      </p>
      <div className="mkt-mock" aria-hidden style={{ minHeight: 160, marginTop: 24 }}>
        <span />
        <span />
        <span />
      </div>
      <p>Ilustración propia con los colores de la marca. No usamos fotos de stock.</p>
    </article>
  );
}
