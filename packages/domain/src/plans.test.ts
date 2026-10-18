import { describe, expect, it } from 'vitest';
import { PLANS, formatPlanPrice, getPlan, plansForDbSeed } from './plans.js';

describe('plan catalog (single source of truth)', () => {
  it('tiene los tres planes acordados con precios en centavos', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['inicial', 'profesional', 'negocio']);
    expect(getPlan('profesional')?.precioMensualCentavos).toBe(149_000);
    expect(getPlan('inicial')?.precioMensualCentavos).toBe(69_000);
    expect(getPlan('negocio')?.maxProductos).toBeNull();
    expect(PLANS.find((p) => p.destacado)?.id).toBe('profesional');
  });

  it('formatea RD$ con locale es-DO', () => {
    expect(formatPlanPrice(149_000)).toMatch(/1.?490/);
  });

  it('expone filas de seed alineadas al catálogo', () => {
    expect(plansForDbSeed()).toHaveLength(3);
    expect(plansForDbSeed()[1]?.precio_mensual_centavos).toBe(149_000);
  });
});
