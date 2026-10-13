import Link from 'next/link';
import { formatDop, plans, PRICES_CONFIRMED } from '@/content/pricing';
import { site } from '@/lib/site';

export function PricingTable() {
  return (
    <>
      {!PRICES_CONFIRMED && (
        <p className="mkt-price-banner" role="note">
          Precios en pesos dominicanos por mes. El monto exacto a transferir se confirma en tu solicitud antes de pagar.
        </p>
      )}
      <div className="mkt-prices">
        {plans.map((plan) => (
          <article key={plan.id} className={`mkt-price${plan.featured ? ' featured' : ''}`}>
            <h2>{plan.name}</h2>
            <strong>
              {formatDop(plan.priceDop)}
              <span style={{ fontSize: '1rem', fontWeight: 600 }}> / mes</span>
            </strong>
            <p>{plan.blurb}</p>
            <ul>
              {plan.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="btn btn-primary" href={`${site.subscribePath}?plan=${plan.id}`} prefetch={false}>
              Suscribirme
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
