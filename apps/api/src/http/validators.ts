import { z } from 'zod';
import { businessTypeError, normalizeBusinessType, parseInstagram, rncPlainSchema, validateRdPhone } from '@facilito/domain';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Plain text: trimmed, no control characters. Output is always escaped by the UI/PDF/CSV layers. */
export const safeText = (min: number, max: number) =>
  z
    .string({ invalid_type_error: 'Debe ser texto' })
    .transform((s) => s.replace(CONTROL_CHARS, '').trim())
    .pipe(z.string().min(min, min === 1 ? 'Campo requerido' : `Mínimo ${min} caracteres`).max(max, `Máximo ${max} caracteres`));

export const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((s) => {
      if (s == null) return null;
      const v = s.replace(CONTROL_CHARS, '').trim();
      return v.length ? v : null;
    })
    .pipe(z.string().max(max, `Máximo ${max} caracteres`).nullable());

const DECIMAL = /^\d{1,14}(\.\d{1,4})?$/;

/** Non-negative decimal as string; accepts numbers from JSON and normalizes them. */
export const amount = (label = 'Monto') =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim().replace(/,/g, '')))
    .refine((v) => DECIMAL.test(v), `${label} inválido`);

export const positiveQty = (label = 'Cantidad') =>
  amount(label).refine((v) => Number(v) > 0, `${label} debe ser mayor que cero`);

export const optionalEmail = z
  .union([z.string(), z.null()])
  .optional()
  .transform((s) => (s == null || s.trim() === '' ? null : s.trim().toLowerCase()))
  .pipe(z.string().email('Email inválido').max(320).nullable());

export const optionalPhone = z
  .union([z.string(), z.null()])
  .optional()
  .transform((s, ctx) => {
    if (s == null || s.trim() === '') return null;
    const v = s.trim();
    const err = validateRdPhone(v);
    if (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      return z.NEVER;
    }
    return v;
  });

export const documentoDo = z
  .union([z.string(), z.null()])
  .optional()
  .transform((s, ctx) => {
    if (s == null || s.trim() === '') return null;
    const parsed = rncPlainSchema.safeParse(s);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error.issues[0]?.message ?? 'RNC o cédula inválido' });
      return z.NEVER;
    }
    return parsed.data;
  });

/** Free-text business type (2–60, letters/numbers/accents/&/-/.), normalized. Rules shared with the web form. */
export const businessTypeField = z
  .string({ invalid_type_error: 'Debe ser texto' })
  .max(200, 'Máximo 60 caracteres')
  .superRefine((v, ctx) => {
    const error = businessTypeError(v);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  })
  .transform(normalizeBusinessType);

/** Optional Instagram handle or profile URL → lowercase handle or null. */
export const instagramField = z
  .union([z.string().max(200, 'Enlace demasiado largo'), z.null()])
  .optional()
  .transform((v, ctx) => {
    const r = parseInstagram(v);
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
      return z.NEVER;
    }
    return r.handle;
  });

export const uuidParam = z.object({ id: z.string().uuid('Identificador inválido') });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Escapes LIKE wildcards so user search text is matched literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
