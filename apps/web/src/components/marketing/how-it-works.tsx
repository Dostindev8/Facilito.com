import { copy } from '@/content/copy.es';

export function HowItWorks() {
  return (
    <section className="mkt-section" id={copy.how.id} aria-labelledby="como">
      <div className="mkt-wrap">
        <h2 id="como">{copy.how.title}</h2>
        <p className="mkt-lead">{copy.how.lead}</p>
        <ol className="mkt-steps">
          {copy.how.steps.map((step) => (
            <li key={step.n} className="mkt-step">
              <span className="mkt-step-n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="mkt-mock" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
