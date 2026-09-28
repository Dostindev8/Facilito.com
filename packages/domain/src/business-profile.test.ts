import { describe, expect, it } from 'vitest';
import {
  businessTypeError,
  filterBusinessTypes,
  instagramUrl,
  normalizeBusinessType,
  parseInstagram,
  resolveBusinessType,
} from './business-profile.js';

describe('business type (free text)', () => {
  it('accepts custom types with accents, &, - and .', () => {
    for (const v of ['Café & Repostería', 'Auto-lavado', 'Tienda Nº 1', 'S.R.L. Distribución']) {
      expect(businessTypeError(v)).toBeNull();
    }
  });

  it('enforces length 2–60 after trimming and collapsing spaces', () => {
    expect(normalizeBusinessType('  Taller   de   motos  ')).toBe('Taller de motos');
    expect(businessTypeError(' a ')).toMatch(/mínimo 2/);
    expect(businessTypeError('x'.repeat(61))).toMatch(/Máximo 60/);
    expect(businessTypeError('x'.repeat(60))).toBeNull();
  });

  it('rejects HTML/script and disallowed symbols', () => {
    expect(businessTypeError('<script>alert(1)</script>')).toMatch(/HTML/);
    expect(businessTypeError('Tienda <b>')).toMatch(/HTML/);
    expect(businessTypeError('Tienda $$$')).toMatch(/Usa solo/);
  });

  it('filters suggestions case- and accent-insensitively', () => {
    expect(filterBusinessTypes('farmacia').map((s) => s.label)).toEqual(['Farmacia']);
    expect(filterBusinessTypes('FERRETERIA').map((s) => s.label)).toEqual(['Ferretería']);
    expect(filterBusinessTypes('ria').map((s) => s.label)).toContain('Barbería');
    expect(filterBusinessTypes('', 3)).toHaveLength(3);
  });

  it('resolves catalog vs custom source and keeps the vertical profile', () => {
    expect(resolveBusinessType('farmacia')).toEqual({ tipoNegocio: 'Farmacia', source: 'catalog', vertical: 'farmacia' });
    expect(resolveBusinessType('Barbería')).toEqual({ tipoNegocio: 'Barbería', source: 'catalog', vertical: 'colmado' });
    expect(resolveBusinessType('  Venta de  motores ')).toEqual({ tipoNegocio: 'Venta de motores', source: 'custom', vertical: 'colmado' });
  });

  it('supports legacy clients that only send `vertical`', () => {
    expect(resolveBusinessType(undefined, 'ferreteria')).toEqual({ tipoNegocio: 'Ferretería', source: 'catalog', vertical: 'ferreteria' });
    expect(resolveBusinessType(undefined, 'desconocido')).toEqual({ tipoNegocio: 'Colmado', source: 'catalog', vertical: 'colmado' });
    expect(resolveBusinessType('Joyería', 'farmacia').vertical).toBe('farmacia');
  });
});

describe('Instagram handle', () => {
  it('normalizes every accepted input form to the lowercase handle', () => {
    for (const v of [
      'colmado.la_esquina',
      '@Colmado.La_Esquina',
      'instagram.com/colmado.la_esquina',
      'https://instagram.com/colmado.la_esquina',
      'https://www.instagram.com/colmado.la_esquina/',
      'https://m.instagram.com/colmado.la_esquina/?igsh=abc123',
    ]) {
      expect(parseInstagram(v)).toEqual({ ok: true, handle: 'colmado.la_esquina' });
    }
  });

  it('treats empty input as a valid "no Instagram"', () => {
    expect(parseInstagram('')).toEqual({ ok: true, handle: null });
    expect(parseInstagram('   ')).toEqual({ ok: true, handle: null });
    expect(parseInstagram(null)).toEqual({ ok: true, handle: null });
  });

  it('rejects invalid handles and non-Instagram links', () => {
    for (const v of ['con espacio', 'x'.repeat(31), '.inicio', 'fin.', 'doble..punto', 'ñandú', 'https://facebook.com/negocio', 'instagram.com/p', 'javascript:alert(1)']) {
      expect(parseInstagram(v).ok).toBe(false);
    }
  });

  it('builds the canonical profile URL', () => {
    expect(instagramUrl('negocio')).toBe('https://www.instagram.com/negocio/');
  });
});
