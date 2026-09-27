import { Decimal } from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyScale = 0 | 2 | 4;

/** Exact money arithmetic — never use JS number for money. */
export class Money {
  private readonly value: Decimal;

  private constructor(value: Decimal) {
    if (!value.isFinite()) {
      throw new Error('Money value must be finite');
    }
    this.value = value;
  }

  static fromString(raw: string): Money {
    return new Money(new Decimal(raw));
  }

  static fromDecimal(value: Decimal): Money {
    return new Money(value);
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  sub(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  mul(factor: string | number | Decimal): Money {
    return new Money(this.value.times(factor));
  }

  div(divisor: string | number | Decimal): Money {
    return new Money(this.value.div(divisor));
  }

  /** Half-up to currency/tax scale. TODO: VERIFICAR EN VIVO — DGII rounding rules. */
  round(scale: MoneyScale = 2): Money {
    return new Money(this.value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP));
  }

  toFixed(scale: MoneyScale = 2): string {
    return this.round(scale).value.toFixed(scale);
  }

  toString(): string {
    return this.value.toString();
  }

  cmp(other: Money): number {
    return this.value.comparedTo(other.value);
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isZero(): boolean {
    return this.value.isZero();
  }
}

export function neutralizeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}
