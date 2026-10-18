'use client';

import { CircleCheck, Shield } from 'lucide-react';
import { PLAN_CONDITIONS, PLANS, TRUST_BADGES, TRUST_POINTS, formatPlanPrice, type PlanCatalogEntry } from '@/lib/plans';
import { dop } from '@/components/billing/billing-ui';

export function PlanSummaryBar({ plan }: { plan: Pick<PlanCatalogEntry, 'id' | 'nombre' | 'precioMensualCentavos' | 'moneda' | 'maxUsuarios' | 'maxProductos' | 'copilot'> }) {
  return (
    <aside className="plan-summary-bar" aria-live="polite">
      <div>
        <strong>{plan.nombre}</strong>
        <span>
          {dop(plan.precioMensualCentavos, plan.moneda)} <small>/ mes</small>
        </span>
      </div>
      <ul>
        <li>Hasta {plan.maxUsuarios} usuarios</li>
        <li>{plan.maxProductos ? `Hasta ${plan.maxProductos.toLocaleString('es-DO')} productos` : 'Productos ilimitados'}</li>
        {plan.copilot && <li>Copilot</li>}
      </ul>
    </aside>
  );
}

export function PlanBenefits() {
  return (
    <section className="plan-section" aria-labelledby="beneficios-title">
      <h2 id="beneficios-title">Beneficios</h2>
      <p className="plan-section-lead">Lo que incluye cada plan, de un vistazo.</p>
      <div className="plan-benefits-grid">
        {PLANS.map((p) => (
          <article key={p.id} className={p.destacado ? 'featured' : undefined}>
            <h3>{p.nombre}</h3>
            <p className="plan-benefits-price">{formatPlanPrice(p.precioMensualCentavos)}</p>
            <ul>
              {p.beneficios.map((b) => (
                <li key={b}>
                  <CircleCheck size={16} aria-hidden /> {b}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PlanComparison() {
  return (
    <section className="plan-section" aria-labelledby="comparativa-title">
      <h2 id="comparativa-title">Comparativa</h2>
      <div className="plan-compare-wrap">
        <table className="plan-compare">
          <caption className="sr-only">Comparación de planes Facilito</caption>
          <thead>
            <tr>
              <th scope="col">Característica</th>
              {PLANS.map((p) => (
                <th key={p.id} scope="col">
                  {p.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Usuarios</th>
              {PLANS.map((p) => (
                <td key={p.id}>{p.maxUsuarios}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Productos</th>
              {PLANS.map((p) => (
                <td key={p.id}>{p.maxProductos ? p.maxProductos.toLocaleString('es-DO') : 'Ilimitados'}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Copilot</th>
              {PLANS.map((p) => (
                <td key={p.id}>{p.copilot ? 'Sí' : '—'}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Soporte</th>
              {PLANS.map((p) => (
                <td key={p.id}>{p.soportePrioritario ? 'Prioritario' : 'Estándar'}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Precio / mes</th>
              {PLANS.map((p) => (
                <td key={p.id}>{formatPlanPrice(p.precioMensualCentavos)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PlanTrust() {
  return (
    <section className="plan-section plan-trust" aria-labelledby="confianza-title">
      <h2 id="confianza-title">Garantías y confianza</h2>
      <ul className="plan-trust-list">
        {TRUST_POINTS.map((t) => (
          <li key={t}>
            <Shield size={16} aria-hidden /> {t}
          </li>
        ))}
      </ul>
      <ul className="plan-conditions">
        {PLAN_CONDITIONS.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {TRUST_BADGES.length > 0 && (
        <ul className="plan-trust-badges">
          {TRUST_BADGES.map((b) => (
            <li key={b.id}>
              {b.href ? (
                <a href={b.href} rel="noopener noreferrer">
                  {b.label}
                </a>
              ) : (
                b.label
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
