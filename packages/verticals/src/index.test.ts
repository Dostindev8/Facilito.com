import { describe, expect, it } from 'vitest';
import { validateProductAttrs, listVerticals } from './index.js';

describe('verticals', () => {
  it('lists priority verticals', () => {
    const ids = listVerticals().map((v) => v.id).sort();
    expect(ids).toEqual(['colmado', 'farmacia', 'ferreteria']);
  });

  it('validates colmado attrs', () => {
    expect(validateProductAttrs('colmado', { perecedero: true })).toEqual({ ok: true });
    expect(validateProductAttrs('colmado', { perecedero: 'si' }).ok).toBe(false);
  });

  it('validates farmacia lote obligatorio', () => {
    expect(
      validateProductAttrs('farmacia', {
        requiere_receta: true,
        lote_obligatorio: true,
      }),
    ).toEqual({ ok: true });
  });
});
