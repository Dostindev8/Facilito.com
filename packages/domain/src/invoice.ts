import { Money } from './money.js';

export type ItbisMode = 'linea' | 'global';

export interface InvoiceLineInput {
  cantidad: string;
  precioUnitario: string;
  /** Monetary discount for the whole line, not a percentage. */
  descuento: string;
  /** 0 for exempt products; otherwise the product rate (e.g. "0.18"). */
  itbisTasa: string;
}

export interface InvoiceLineTotals {
  subtotal: string;
  itbis: string;
  total: string;
}

export interface InvoiceTotals {
  lines: InvoiceLineTotals[];
  bruto: string;
  descuentoTotal: string;
  subtotal: string;
  itbisTotal: string;
  total: string;
}

export class InvoiceCalcError extends Error {
  constructor(
    public readonly code: 'EMPTY' | 'QUANTITY' | 'PRICE' | 'DISCOUNT',
    public readonly lineIndex: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Computes invoice totals with exact decimals and half-up rounding to 2 places.
 * - linea: ITBIS rounded per line, total = sum of lines.
 * - global: ITBIS rounded once over the taxable base, then allocated to lines
 *   (remainder on the last taxable line) so lines always add up to the header.
 * TODO: VERIFICAR EN VIVO — reglas DGII de redondeo de ITBIS por línea vs. total.
 */
export function computeInvoiceTotals(
  inputs: InvoiceLineInput[],
  mode: ItbisMode,
  globalRate: string,
): InvoiceTotals {
  if (inputs.length === 0) throw new InvoiceCalcError('EMPTY', -1, 'La factura necesita al menos una línea');

  let bruto = Money.zero();
  let descuentoTotal = Money.zero();
  const subtotals: Money[] = [];

  inputs.forEach((line, i) => {
    const qty = Money.fromString(line.cantidad);
    const price = Money.fromString(line.precioUnitario);
    const disc = Money.fromString(line.descuento || '0');
    if (qty.isNegative() || qty.isZero()) {
      throw new InvoiceCalcError('QUANTITY', i, 'La cantidad debe ser mayor que cero');
    }
    if (price.isNegative()) throw new InvoiceCalcError('PRICE', i, 'El precio no puede ser negativo');
    if (disc.isNegative()) throw new InvoiceCalcError('DISCOUNT', i, 'El descuento no puede ser negativo');
    const gross = price.mul(qty.toString()).round(2);
    if (disc.cmp(gross) > 0) {
      throw new InvoiceCalcError('DISCOUNT', i, 'El descuento no puede superar el importe de la línea');
    }
    bruto = bruto.add(gross);
    descuentoTotal = descuentoTotal.add(disc.round(2));
    subtotals.push(gross.sub(disc).round(2));
  });

  let itbisPerLine: Money[];
  if (mode === 'linea') {
    itbisPerLine = subtotals.map((s, i) => s.mul(inputs[i]!.itbisTasa).round(2));
  } else {
    const taxable = subtotals.map((s, i) => (Money.fromString(inputs[i]!.itbisTasa).isZero() ? Money.zero() : s));
    const base = taxable.reduce((a, b) => a.add(b), Money.zero());
    const totalItbis = base.mul(globalRate).round(2);
    itbisPerLine = taxable.map(() => Money.zero());
    const lastTaxable = taxable.map((t) => !t.isZero()).lastIndexOf(true);
    if (lastTaxable >= 0 && !base.isZero()) {
      let allocated = Money.zero();
      taxable.forEach((t, i) => {
        if (i === lastTaxable || t.isZero()) return;
        const share = totalItbis.mul(t.toString()).div(base.toString()).round(2);
        itbisPerLine[i] = share;
        allocated = allocated.add(share);
      });
      itbisPerLine[lastTaxable] = totalItbis.sub(allocated).round(2);
    }
  }

  const lines = subtotals.map((s, i) => ({
    subtotal: s.toFixed(2),
    itbis: itbisPerLine[i]!.toFixed(2),
    total: s.add(itbisPerLine[i]!).toFixed(2),
  }));
  const subtotal = subtotals.reduce((a, b) => a.add(b), Money.zero());
  const itbisTotal = itbisPerLine.reduce((a, b) => a.add(b), Money.zero());

  return {
    lines,
    bruto: bruto.toFixed(2),
    descuentoTotal: descuentoTotal.toFixed(2),
    subtotal: subtotal.toFixed(2),
    itbisTotal: itbisTotal.toFixed(2),
    total: subtotal.add(itbisTotal).toFixed(2),
  };
}

/** Margin over sale price, in percent with 2 decimals; null when price is zero. */
export function computeMargin(costo: string, precioVenta: string): string | null {
  const price = Money.fromString(precioVenta);
  if (price.isZero()) return null;
  return Money.fromString(precioVenta).sub(Money.fromString(costo)).div(price.toString()).mul(100).round(2).toFixed(2);
}

/** Percent change vs. previous value; null when there is no baseline. */
export function percentChange(current: string, previous: string): string | null {
  const prev = Money.fromString(previous);
  if (prev.isZero()) return null;
  return Money.fromString(current).sub(prev).div(prev.toString()).mul(100).round(0).toFixed(0);
}

export function formatNcf(tipo: string, secuencia: bigint | number): string {
  // TODO: VERIFICAR EN VIVO — formato NCF B-series: serie + tipo + 8 dígitos.
  return `${tipo}${String(secuencia).padStart(8, '0')}`;
}
