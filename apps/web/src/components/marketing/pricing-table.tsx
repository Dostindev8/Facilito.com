import Link from 'next/link';
import { plans, PRICES_CONFIRMED } from '@/content/pricing';
import { site } from '@/lib/site';

export function PricingTable() {
  return (
    <>
      {!PRICES_CONFIRMED && (
        <p className="mkt-price-banner" role="note">
          Precios de referencia. No son una oferta vigente: hay que confirmarlos con {site.maker} antes de contratar.
        </p>
      )}
      <div className="mkt-prices">
        {plans.map((plan) => (
          <article key={plan.id} className={`mkt-price${plan.featured ? ' featured' : ''}`}>
            <h2>{plan.name}</h2>
            <strong>
              US${plan.priceUsd}
              <span style={{ fontSize: '1rem', fontWeight: 600 }}> / mes</span>
            </strong>
            <p>{plan.blurb}</p>
            <ul>
              {plan.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="btn btn-primary" href={plan.id === 'gratis' ? site.registerPath : '/contacto?motivo=ventas'} prefetch={plan.id === 'gratis' ? false : undefined}>
              {plan.cta}
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
