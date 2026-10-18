import { describe, expect, it } from 'vitest';
import { PLANS, catalogAsApiItems, enrichPlan, getPlan } from './plans';

describe('web plans façade', () => {
  it('expone el catálogo como ítems de API', () => {
    const items = catalogAsApiItems();
    expect(items).toHaveLength(3);
    expect(items[1]?.id).toBe('profesional');
    expect(enrichPlan(items[1]!).beneficios?.length).toBeGreaterThan(0);
    expect(getPlan('inicial')).toEqual(PLANS[0]);
  });
});
