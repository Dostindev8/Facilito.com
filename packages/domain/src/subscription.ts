/**
 * Subscription lifecycle. The only way to get a Facilito account is: pay -> be authorized by a platform admin ->
 * accept a single-use invitation. Every state change goes through `transition`, so an invalid move is an error
 * instead of a silent write.
 */
export const SUBSCRIPTION_STATES = [
  'PENDIENTE_PAGO',
  'PENDIENTE_AUTORIZACION',
  'ACTIVA',
  'EN_GRACIA',
  'SUSPENDIDA',
  'CANCELADA',
  'RECHAZADA',
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const SUBSCRIPTION_EVENTS = [
  'pago_confirmado',
  'pago_reportado',
  'autorizar',
  'rechazar',
  'vencimiento',
  'pago_fallido',
  'fin_gracia',
  'pago_registrado',
  'suspender',
  'reactivar',
  'cancelar',
] as const;
export type SubscriptionEvent = (typeof SUBSCRIPTION_EVENTS)[number];

const TRANSITIONS: Readonly<Record<SubscriptionState, Partial<Record<SubscriptionEvent, SubscriptionState>>>> = {
  PENDIENTE_PAGO: {
    pago_confirmado: 'PENDIENTE_AUTORIZACION',
    pago_reportado: 'PENDIENTE_AUTORIZACION',
    rechazar: 'RECHAZADA',
    cancelar: 'CANCELADA',
  },
  PENDIENTE_AUTORIZACION: { autorizar: 'ACTIVA', rechazar: 'RECHAZADA' },
  ACTIVA: {
    vencimiento: 'EN_GRACIA',
    pago_fallido: 'EN_GRACIA',
    pago_registrado: 'ACTIVA',
    suspender: 'SUSPENDIDA',
    cancelar: 'CANCELADA',
  },
  EN_GRACIA: { pago_registrado: 'ACTIVA', fin_gracia: 'SUSPENDIDA', suspender: 'SUSPENDIDA', cancelar: 'CANCELADA' },
  SUSPENDIDA: { pago_registrado: 'ACTIVA', reactivar: 'ACTIVA', cancelar: 'CANCELADA' },
  CANCELADA: { pago_registrado: 'ACTIVA', reactivar: 'ACTIVA' },
  RECHAZADA: {},
};

export class SubscriptionTransitionError extends Error {
  constructor(
    readonly from: SubscriptionState,
    readonly event: SubscriptionEvent,
  ) {
    super(`Transición inválida: ${event} desde ${from}`);
    this.name = 'SubscriptionTransitionError';
  }
}

export function canTransition(from: SubscriptionState, event: SubscriptionEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function transition(from: SubscriptionState, event: SubscriptionEvent): SubscriptionState {
  const to = TRANSITIONS[from][event];
  if (!to) throw new SubscriptionTransitionError(from, event);
  return to;
}

/** States whose business can sign in. Write access is decided separately by `subscriptionAllowsWrites`. */
export function subscriptionAllowsLogin(state: SubscriptionState): boolean {
  return state === 'ACTIVA' || state === 'EN_GRACIA' || state === 'SUSPENDIDA' || state === 'CANCELADA';
}

/** Suspended and cancelled businesses keep read and export access: their data is never deleted or hidden. */
export function subscriptionAllowsWrites(state: SubscriptionState): boolean {
  return state === 'ACTIVA' || state === 'EN_GRACIA';
}

export const GRACE_PERIOD_DAYS = 7;
export const BILLING_PERIOD_MONTHS = 1;

/** Adds whole calendar months, clamping to the last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** A renewal paid early extends from the current end; one paid late starts from the payment date. */
export function nextPeriodEnd(currentEnd: Date | null, paidAt: Date, months = BILLING_PERIOD_MONTHS): Date {
  const base = currentEnd && currentEnd.getTime() > paidAt.getTime() ? currentEnd : paidAt;
  return addMonths(base, months);
}

export function graceEndsAt(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + GRACE_PERIOD_DAYS * 86_400_000);
}

/**
 * The state the clock implies, independent of whether the daily sweep already persisted it. Access checks use
 * this, so a missed cron run never grants writes past the grace period.
 */
export function effectiveSubscriptionState(
  state: SubscriptionState,
  periodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
  now: Date = new Date(),
): SubscriptionState {
  if (!periodEnd || (state !== 'ACTIVA' && state !== 'EN_GRACIA')) return state;
  if (now.getTime() <= periodEnd.getTime()) return state;
  if (cancelAtPeriodEnd) return 'CANCELADA';
  return now.getTime() > graceEndsAt(periodEnd).getTime() ? 'SUSPENDIDA' : 'EN_GRACIA';
}
