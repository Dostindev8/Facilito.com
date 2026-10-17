import { describe, expect, it } from 'vitest';
import {
  addMonths,
  canTransition,
  effectiveSubscriptionState,
  graceEndsAt,
  nextPeriodEnd,
  SUBSCRIPTION_EVENTS,
  SUBSCRIPTION_STATES,
  subscriptionAllowsLogin,
  subscriptionAllowsWrites,
  SubscriptionTransitionError,
  transition,
} from './subscription.js';

describe('máquina de estados de la suscripción', () => {
  it('camino feliz: pago → autorización → activa → vencida → en gracia → pagada', () => {
    let s = transition('PENDIENTE_PAGO', 'pago_confirmado');
    expect(s).toBe('PENDIENTE_AUTORIZACION');
    s = transition(s, 'autorizar');
    expect(s).toBe('ACTIVA');
    s = transition(s, 'vencimiento');
    expect(s).toBe('EN_GRACIA');
    expect(transition(s, 'pago_registrado')).toBe('ACTIVA');
    expect(transition(s, 'fin_gracia')).toBe('SUSPENDIDA');
  });

  it('no se puede activar sin pasar por la autorización', () => {
    expect(() => transition('PENDIENTE_PAGO', 'autorizar')).toThrow(SubscriptionTransitionError);
    expect(canTransition('PENDIENTE_PAGO', 'autorizar')).toBe(false);
  });

  it('una solicitud rechazada es terminal', () => {
    for (const e of SUBSCRIPTION_EVENTS) expect(canTransition('RECHAZADA', e)).toBe(false);
  });

  it('una suscripción activa no se puede rechazar ni re-autorizar', () => {
    expect(() => transition('ACTIVA', 'rechazar')).toThrow(/Transición inválida/);
    expect(() => transition('ACTIVA', 'autorizar')).toThrow(SubscriptionTransitionError);
  });

  it('suspendida y cancelada conservan el acceso de lectura, nunca escritura', () => {
    expect(subscriptionAllowsLogin('SUSPENDIDA')).toBe(true);
    expect(subscriptionAllowsWrites('SUSPENDIDA')).toBe(false);
    expect(subscriptionAllowsWrites('CANCELADA')).toBe(false);
    expect(subscriptionAllowsWrites('EN_GRACIA')).toBe(true);
    expect(subscriptionAllowsLogin('PENDIENTE_AUTORIZACION')).toBe(false);
    expect(subscriptionAllowsLogin('RECHAZADA')).toBe(false);
  });

  it('cada estado tiene al menos una salida salvo RECHAZADA', () => {
    for (const s of SUBSCRIPTION_STATES.filter((x) => x !== 'RECHAZADA')) {
      expect(SUBSCRIPTION_EVENTS.some((e) => canTransition(s, e))).toBe(true);
    }
  });
});

describe('periodos de facturación', () => {
  it('suma meses de calendario sin desbordar el fin de mes', () => {
    expect(addMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(addMonths(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('un pago adelantado extiende desde el vencimiento; uno tardío desde la fecha de pago', () => {
    const end = new Date('2026-11-10T00:00:00Z');
    expect(nextPeriodEnd(end, new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-12-10T00:00:00.000Z');
    expect(nextPeriodEnd(end, new Date('2026-11-20T00:00:00Z')).toISOString()).toBe('2026-12-20T00:00:00.000Z');
    expect(nextPeriodEnd(null, new Date('2026-10-06T00:00:00Z')).toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });

  it('la gracia dura 7 días', () => {
    expect(graceEndsAt(new Date('2026-10-01T00:00:00Z')).toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

describe('estado efectivo según el reloj', () => {
  const end = new Date('2026-10-01T00:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('dentro del periodo no cambia', () => {
    expect(effectiveSubscriptionState('ACTIVA', end, false, at('2026-09-30T23:59:59Z'))).toBe('ACTIVA');
  });

  it('vencida entra en gracia y, pasada la gracia, queda suspendida aunque el barrido no haya corrido', () => {
    expect(effectiveSubscriptionState('ACTIVA', end, false, at('2026-10-03T00:00:00Z'))).toBe('EN_GRACIA');
    expect(effectiveSubscriptionState('ACTIVA', end, false, at('2026-10-08T00:00:01Z'))).toBe('SUSPENDIDA');
    expect(effectiveSubscriptionState('EN_GRACIA', end, false, at('2026-10-09T00:00:00Z'))).toBe('SUSPENDIDA');
  });

  it('cancelar al final del periodo cancela al vencer, sin gracia', () => {
    expect(effectiveSubscriptionState('ACTIVA', end, true, at('2026-10-01T00:00:01Z'))).toBe('CANCELADA');
  });

  it('estados terminales o pendientes no dependen del reloj', () => {
    expect(effectiveSubscriptionState('SUSPENDIDA', end, false, at('2030-01-01T00:00:00Z'))).toBe('SUSPENDIDA');
    expect(effectiveSubscriptionState('PENDIENTE_AUTORIZACION', null, false)).toBe('PENDIENTE_AUTORIZACION');
  });
});
