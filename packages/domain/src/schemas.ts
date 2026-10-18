import { z } from 'zod';
import { validateRncOrCedula } from './rnc.js';

export const uuidSchema = z.string().uuid();

export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'Invalid money string');

export const emailSchema = z.string().email().max(320);

export const skuSchema = z.string().min(1).max(64);

export const rncPlainSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .superRefine((digits, ctx) => {
    const v = validateRncOrCedula(digits);
    if (!v.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.error });
    }
  });
