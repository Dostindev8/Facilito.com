'use server';

import { headers } from 'next/headers';
import { createContactNotifier } from '@/lib/contact-notifier';
import { hitRateLimit } from '@/lib/rate-limit';
import { parseContact, type ContactFormState } from '@/lib/validations/contact';

async function clientKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || h.get('x-real-ip') || 'local';
}

export async function submitContact(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const raw = {
    nombre: formData.get('nombre'),
    telefono: formData.get('telefono'),
    email: formData.get('email'),
    tipoNegocio: formData.get('tipoNegocio'),
    mensaje: formData.get('mensaje'),
    motivo: formData.get('motivo'),
    company_website: formData.get('company_website') ?? '',
  };

  const parsed = parseContact(raw);
  if (!parsed.ok) {
    if (parsed.honeypot) {
      return { status: 'error', message: 'No pudimos enviar el mensaje.', fieldErrors: {} };
    }
    const first = Object.values(parsed.fieldErrors)[0] ?? 'Revisa los campos.';
    return { status: 'error', message: first, fieldErrors: parsed.fieldErrors };
  }

  const limit = hitRateLimit(`contact:${await clientKey()}`);
  if (!limit.ok) {
    return {
      status: 'error',
      message: 'Demasiados envíos. Espera un momento e intenta de nuevo.',
      fieldErrors: {},
    };
  }

  try {
    const result = await createContactNotifier().send(parsed.message);
    if (result === 'unconfigured') {
      return {
        status: 'error',
        message: 'El correo de contacto no está configurado. Escríbenos por WhatsApp si el botón está disponible, o intenta más tarde.',
        fieldErrors: {},
      };
    }
    return { status: 'success', message: 'Listo. Recibimos tu mensaje y te respondemos por el correo o el WhatsApp que dejaste.', fieldErrors: {} };
  } catch {
    return { status: 'error', message: 'No pudimos enviar el mensaje. Intenta de nuevo en unos minutos.', fieldErrors: {} };
  }
}
