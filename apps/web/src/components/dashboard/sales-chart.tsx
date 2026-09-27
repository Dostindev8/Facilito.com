'use client';

import { useMemo, useState } from 'react';
import { dayLabel, money } from '@/lib/format';

const axisFmt = new Intl.NumberFormat('es-DO', { notation: 'compact', maximumFractionDigits: 1 });

export interface SeriePoint {
  dia: string;
  total: string;
  facturas: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1000;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function SalesChart({ serie, today }: { serie: SeriePoint[]; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(...serie.map((s) => Number(s.total)), 0)), [serie]);
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  const dense = serie.length > 14;

  return (
    <div className="chart" role="group" aria-label={`Ventas de los últimos ${serie.length} días`}>
      <div className="chart-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t}>{axisFmt.format(t)}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-bars" onMouseLeave={() => setActive(null)}>
          {serie.map((s, i) => {
            const h = Math.max((Number(s.total) / max) * 100, Number(s.total) > 0 ? 2 : 0);
            return (
              <button
                key={s.dia}
                type="button"
                className="bar-col"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
                aria-label={`${dayLabel(s.dia)}: ${money(s.total)}, ${s.facturas} facturas`}
              >
                <span className={`bar ${s.dia === today ? 'is-today' : ''}`} style={{ height: `${h}%` }} />
                {active === i && (
                  <span className="chart-tip" role="tooltip">
                    <strong>{money(s.total)}</strong>
                    <span>
                      {dayLabel(s.dia)} · {s.facturas} {s.facturas === 1 ? 'factura' : 'facturas'}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="chart-labels" aria-hidden>
          {serie.map((s, i) => {
            if (dense && i % 3 !== serie.length % 3 && i !== serie.length - 1) return <span key={s.dia} />;
            const [weekday, ...rest] = dayLabel(s.dia).split(' ');
            return (
              <span key={s.dia}>
                <span className="wd">{weekday}</span> <span>{rest.join(' ')}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
