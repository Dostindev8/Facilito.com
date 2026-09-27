import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'Invalid money string');

export const emailSchema = z.string().email().max(320);

export const skuSchema = z.string().min(1).max(64);

export const rncPlainSchema = z
  .string()
  .regex(/^\d{9}$|^\d{11}$/, 'RNC must be 9 or 11 digits');
// TODO: VERIFICAR EN VIVO — exact DGII RNC validation rules
