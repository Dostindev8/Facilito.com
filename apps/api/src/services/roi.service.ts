import { Money } from '@facilito/domain';

/** Simple ROI helper for Fase 4 — investment tracking with exact money. */
export function computeRoi(investment: string, profit: string): { roiPct: string } {
  const inv = Money.fromString(investment);
  if (inv.isZero()) {
    return { roiPct: '0.00' };
  }
  const p = Money.fromString(profit);
  return { roiPct: p.div(inv.toString()).mul(100).round(2).toFixed(2) };
}
