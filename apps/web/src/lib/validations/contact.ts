import { z } from 'zod';
import { normalizeRdPhone } from '../phone';
import { BUSINESS_TYPES, CONTACT_LIMITS, CONTACT_MOTIVES } from './contact-fields';

export * from './contact-fields';

export const contactSchema = z
  .object({
    nombre: z.string().trim().min(2, 'Escribe tu nombre.').max(CONTACT_LIMITS.name, 'El nombre es demasiado largo.'),
    telefono: z.string().trim().min(10, 'Escribe un celular de República Dominicana.').max(20),
    email: z.string().trim().max(CONTACT_LIMITS.email).email('Escribe un correo válido.'),
    tipoNegocio: z.enum(BUSINESS_TYPES, { error: 'Elige el tipo de negocio.' }),
    mensaje: z.string().trim().min(10, 'Cuéntanos un poco más (mínimo 10 caracteres).').max(CONTACT_LIMITS.message, 'El mensaje es demasiado largo.'),
    motivo: z.enum(CONTACT_MOTIVES, { error: 'Elige un motivo.' }),
    company_website: z.string().max(CONTACT_LIMITS.honeypot).optional(),
  })
  .strict();

export type ContactInput = z.infer<typeof contactSchema>;

export interface ContactMessage {
  nombre: string;
  telefono: string;
  email: string;
  tipoNegocio: (typeof BUSINESS_TYPES)[number];
  mensaje: string;
  motivo: (typeof CONTACT_MOTIVES)[number];
}

export type ContactParse =
  | { ok: true; message: ContactMessage }
  | { ok: false; honeypot: true }
  | { ok: false; honeypot: false; fieldErrors: Record<string, string> };

export function parseContact(raw: unknown): ContactParse {
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, honeypot: false, fieldErrors };
  }
  if (parsed.data.company_website && parsed.data.company_website.trim() !== '') {
    return { ok: false, honeypot: true };
  }
  const telefono = normalizeRdPhone(parsed.data.telefono);
  if (!telefono) {
    return { ok: false, honeypot: false, fieldErrors: { telefono: 'Usa un celular 809, 829 o 849.' } };
  }
  return {
    ok: true,
    message: {
      nombre: parsed.data.nombre,
      telefono,
      email: parsed.data.email,
      tipoNegocio: parsed.data.tipoNegocio,
      mensaje: parsed.data.mensaje,
      motivo: parsed.data.motivo,
    },
  };
}
