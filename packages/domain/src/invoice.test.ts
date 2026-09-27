import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTotals,
  computeMargin,
  formatNcf,
  InvoiceCalcError,
  percentChange,
} from './invoice.js';

const line = (cantidad: string, precioUnitario: string, descuento = '0', itbisTasa = '0.18') => ({
  cantidad,
  precioUnitario,
  descuento,
  itbisTasa,
});

describe('computeInvoiceTotals — linea', () => {
  it('computes ITBIS 18% per line with discounts', () => {
    const t = computeInvoiceTotals([line('2', '100.00', '10.00'), line('1', '50.00')], 'linea', '0.18');
    expect(t.bruto).toBe('250.00');
    expect(t.descuentoTotal).toBe('10.00');
    expect(t.subtotal).toBe('240.00');
    expect(t.lines[0]).toEqual({ subtotal: '190.00', itbis: '34.20', total: '224.20' });
    expect(t.itbisTotal).toBe('43.20');
    expect(t.total).toBe('283.20');
  });

  it('rounds half-up per line', () => {
    // 0.35 * 0.18 = 0.063 -> 0.06 ; 3 lines of 0.35
    const t = computeInvoiceTotals([line('1', '0.35'), line('1', '0.35'), line('1', '0.35')], 'linea', '0.18');
    expect(t.itbisTotal).toBe('0.18');
    expect(t.total).toBe('1.23');
  });

  it('keeps exempt lines at zero tax', () => {
    const t = computeInvoiceTotals([line('1', '100', '0', '0'), line('1', '100')], 'linea', '0.18');
    expect(t.itbisTotal).toBe('18.00');
  });

  it('handles fractional quantities (lb/kg)', () => {
    const t = computeInvoiceTotals([line('1.5', '45.50')], 'linea', '0.18');
    expect(t.subtotal).toBe('68.25');
    expect(t.itbisTotal).toBe('12.29');
  });
});

describe('computeInvoiceTotals — global', () => {
  it('rounds once and allocates remainder so lines sum to header', () => {
    const t = computeInvoiceTotals([line('1', '0.35'), line('1', '0.35'), line('1', '0.35')], 'global', '0.18');
    // base 1.05 * 0.18 = 0.189 -> 0.19
    expect(t.itbisTotal).toBe('0.19');
    const sum = t.lines.reduce((a, l) => a + Math.round(Number(l.itbis) * 100), 0);
    expect(sum).toBe(19);
  });

  it('excludes exempt lines from the taxable base', () => {
    const t = computeInvoiceTotals([line('1', '100', '0', '0'), line('1', '100')], 'global', '0.18');
    expect(t.itbisTotal).toBe('18.00');
    expect(t.lines[0]!.itbis).toBe('0.00');
  });
});

describe('computeInvoiceTotals — validation', () => {
  it('rejects empty invoices', () => {
    expect(() => computeInvoiceTotals([], 'linea', '0.18')).toThrow(InvoiceCalcError);
  });
  it('rejects zero or negative quantity', () => {
    expect(() => computeInvoiceTotals([line('0', '10')], 'linea', '0.18')).toThrow(/cantidad/);
    expect(() => computeInvoiceTotals([line('-1', '10')], 'linea', '0.18')).toThrow(/cantidad/);
  });
  it('rejects discount larger than the line', () => {
    expect(() => computeInvoiceTotals([line('1', '10', '11')], 'linea', '0.18')).toThrow(/descuento/);
  });
  it('rejects negative price', () => {
    expect(() => computeInvoiceTotals([line('1', '-10')], 'linea', '0.18')).toThrow(/precio/);
  });
});

describe('helpers', () => {
  it('computes margin over price', () => {
    expect(computeMargin('60', '100')).toBe('40.00');
    expect(computeMargin('10', '0')).toBeNull();
  });
  it('computes percent change', () => {
    expect(percentChange('112', '100')).toBe('12');
    expect(percentChange('50', '0')).toBeNull();
  });
  it('formats NCF', () => {
    expect(formatNcf('B02', 1)).toBe('B0200000001');
  });
});
