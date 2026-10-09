import { copy } from '@/content/copy.es';

export function TrustStrip() {
  return (
    <section className="mkt-trust" aria-label="Hechos del producto">
      <ul className="mkt-wrap">
        {copy.trust.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function Manifesto() {
  return (
    <section className="mkt-manifesto" aria-label="Manifiesto">
      <div className="mkt-wrap">
        <p>{copy.manifesto}</p>
      </div>
    </section>
  );
}
