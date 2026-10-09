import Link from 'next/link';
import { copy } from '@/content/copy.es';
import { site, whatsappHref, WHATSAPP_DEMO_TEXT } from '@/lib/site';

export function FinalCta() {
  const wa = whatsappHref(WHATSAPP_DEMO_TEXT);
  return (
    <section className="mkt-final" aria-labelledby="cierre">
      <div className="mkt-wrap">
        <div className="mkt-final-box">
          <h2 id="cierre">{copy.final.title}</h2>
          <p>{copy.final.body}</p>
          <div className="mkt-actions">
            <Link className="btn btn-primary" href={site.registerPath} prefetch={false}>
              Empezar gratis
            </Link>
            {wa ? (
              <a className="btn btn-accent" href={wa} target="_blank" rel="noopener noreferrer">
                {copy.final.whatsapp}
              </a>
            ) : (
              <Link className="btn btn-accent" href="/contacto">
                Contacto
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
