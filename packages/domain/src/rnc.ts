/**
 * RNC (9) and cédula (11) format + check-digit validation for República Dominicana.
 * Format is authoritative; check-digit follows the commonly published mod-10 algorithms.
 */

const DIGITS = /^\d+$/;

export function stripRnc(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

/** Cédula: weights 1,2 alternating on first 10 digits; check = (10 - sum%10) % 10. */
export function cedulaCheckDigitValid(digits11: string): boolean {
  if (!/^\d{11}$/.test(digits11)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(digits11[i]) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits11[10]);
}

/** RNC empresa (9): factor sequence 7,9,8,6,5,4,3,2 on first 8; mod 11 check digit. */
export function rncCheckDigitValid(digits9: string): boolean {
  if (!/^\d{9}$/.test(digits9)) return false;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits9[i]) * weights[i]!;
  const mod = sum % 11;
  const check = mod === 0 ? 2 : mod === 1 ? 1 : 11 - mod;
  return check === Number(digits9[8]);
}

export type RncValidation =
  | { ok: true; kind: 'rnc' | 'cedula'; digits: string }
  | { ok: false; error: string };

export function validateRncOrCedula(raw: string): RncValidation {
  const digits = stripRnc(raw);
  if (!digits) return { ok: false, error: 'Escribe el RNC o la cédula' };
  if (!DIGITS.test(digits)) return { ok: false, error: 'Solo números (puedes usar guiones)' };
  if (digits.length === 9) {
    if (!rncCheckDigitValid(digits)) return { ok: false, error: 'Ese RNC no es válido (revisa el dígito verificador)' };
    return { ok: true, kind: 'rnc', digits };
  }
  if (digits.length === 11) {
    if (!cedulaCheckDigitValid(digits)) return { ok: false, error: 'Esa cédula no es válida (revisa el dígito verificador)' };
    return { ok: true, kind: 'cedula', digits };
  }
  return { ok: false, error: 'RNC de 9 dígitos o cédula de 11' };
}

/** Optional WhatsApp/phone (RD): +1 809/829/849 or local 10 digits. */
export function validateRdPhone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const digits = v.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (!/^\d{10,11}$/.test(digits)) return 'Usa un teléfono válido (ej. 809-555-0000)';
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return 'El número debe tener 10 dígitos';
  if (!/^(809|829|849)\d{7}$/.test(local)) return 'Usa un código de área dominicano (809, 829 o 849)';
  return null;
}

/** Deterministic valid RNC for tests/fixtures (not for production IDs). */
export function forgeValidRnc(seed: number): string {
  const body = String(10_000_000 + Math.abs(seed) % 89_999_999).padStart(8, '0').slice(-8);
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(body[i]) * weights[i]!;
  const mod = sum % 11;
  const check = mod === 0 ? 2 : mod === 1 ? 1 : 11 - mod;
  return `${body}${check}`;
}
