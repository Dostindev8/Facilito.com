import { describe, expect, it } from 'vitest';
import { forgeValidRnc, rncCheckDigitValid, validateRdPhone, validateRncOrCedula } from './rnc.js';

describe('RNC / cédula', () => {
  it('acepta RNC forjados con dígito verificador', () => {
    for (const seed of [1, 42, 999, 501_000_000]) {
      const rnc = forgeValidRnc(seed);
      expect(rnc).toHaveLength(9);
      expect(rncCheckDigitValid(rnc)).toBe(true);
      expect(validateRncOrCedula(rnc).ok).toBe(true);
    }
  });

  it('rechaza formato y dígito inválidos', () => {
    expect(validateRncOrCedula('123').ok).toBe(false);
    expect(validateRncOrCedula('123456789').ok).toBe(false);
  });

  it('valida teléfono RD opcional', () => {
    expect(validateRdPhone('')).toBeNull();
    expect(validateRdPhone('809-555-0000')).toBeNull();
    expect(validateRdPhone('555-555-0000')).toMatch(/área/);
  });
});
