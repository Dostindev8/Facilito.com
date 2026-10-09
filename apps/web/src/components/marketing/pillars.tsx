import { ClipboardList, Package, Receipt } from 'lucide-react';
import { copy } from '@/content/copy.es';

const ICONS = [Receipt, Package, ClipboardList] as const;

export function Pillars() {
  return (
    <section className="mkt-section" aria-labelledby="pilares">
      <div className="mkt-wrap">
        <h2 id="pilares">Lo que ya puedes hacer</h2>
        <div className="mkt-grid-3">
          {copy.pillars.map((pillar, index) => {
            const Icon = ICONS[index] ?? Receipt;
            return (
              <article key={pillar.title} className="mkt-card">
                <div className="mkt-icon">
                  <Icon size={22} aria-hidden />
                </div>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
