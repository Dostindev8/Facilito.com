import { describe, expect, it } from 'vitest';
import { dateLong, instantLong } from './format';

describe('fechas largas', () => {
  it('dateLong formatea un día sin hora', () => {
    expect(dateLong('2026-11-12')).toBe('12 de noviembre de 2026');
  });

  it('instantLong acepta el ISO completo que manda la API y usa la hora de Santo Domingo', () => {
    expect(instantLong('2026-11-12T15:30:00.000Z')).toBe('12 de noviembre de 2026');
    expect(instantLong('2026-11-13T02:00:00.000Z')).toBe('12 de noviembre de 2026');
  });
});
