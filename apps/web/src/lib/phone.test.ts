import { describe, expect, it } from 'vitest';
import { normalizeRdPhone } from './phone';

describe('normalizeRdPhone', () => {
  it('acepta celular con espacios, guiones y +1', () => {
    expect(normalizeRdPhone('+1 (809) 555-0101')).toBe('+18095550101');
    expect(normalizeRdPhone('8295550101')).toBe('+18295550101');
    expect(normalizeRdPhone('1-849-555-0101')).toBe('+18495550101');
  });

  it('rechaza fijo, corto y prefijo que no es móvil', () => {
    expect(normalizeRdPhone('809555')).toBeNull();
    expect(normalizeRdPhone('80955501011')).toBeNull();
    expect(normalizeRdPhone('4025550101')).toBeNull();
    expect(normalizeRdPhone('')).toBeNull();
  });
});
