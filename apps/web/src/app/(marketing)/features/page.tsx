import { comingSoon, features } from '@/content/features';
import { JsonLd } from '@/components/marketing/json-ld';
import { RegisterCta } from '@/components/marketing/whatsapp-button';
import { breadcrumbJsonLd, pageMeta } from '@/lib/seo';

export const metadata = pageMeta({
  title: 'Producto',
  description: 'Ventas, inventario, facturación, clientes, proveedores y reportes. Lo que Facilito hace hoy, sin promesas de más.',
  path: '/features',
});

export default function FeaturesPage() {
  return (
    <div className="mkt-wrap mkt-page-head" style={{ paddingBottom: 72 }}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Inicio', path: '/' },
          { name: 'Producto', path: '/features' },
        ])}
      />
      <h1>Producto</h1>
      <p>Cada bloque es un módulo que ya está en el panel. Lo que no está, no se vende como si estuviera.</p>
      {features.map((feature) => (
        <article key={feature.id} className="mkt-feature" id={feature.id}>
          <h2>{feature.title}</h2>
          <p>
            <strong>El problema. </strong>
            {feature.problem}
          </p>
          <p>
            <strong>Con Facilito. </strong>
            {feature.solution}
          </p>
          <RegisterCta>Empezar gratis</RegisterCta>
        </article>
      ))}
      <h2 style={{ marginTop: 36 }}>Próximamente</h2>
      <ul>
        {comingSoon.map((item) => (
          <li key={item}>
            <span className="mkt-soon">Próximamente</span> {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
