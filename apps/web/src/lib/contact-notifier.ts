import nodemailer from 'nodemailer';
import type { ContactMessage } from './validations/contact';

export interface ContactNotifier {
  send(message: ContactMessage): Promise<'sent' | 'unconfigured'>;
}

function smtpReady(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Test/e2e sink. Never logs the message body. */
const sink: ContactNotifier = {
  async send() {
    return 'sent';
  },
};

const smtp: ContactNotifier = {
  async send(message) {
    if (!smtpReady()) return 'unconfigured';
    const to = process.env.CONTACT_TO_EMAIL || process.env.MAIL_REPLY_TO || process.env.SMTP_USER;
    if (!to) return 'unconfigured';
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = process.env.SMTP_SECURE !== 'false';
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      replyTo: message.email,
      subject: `Facilito · contacto · ${message.motivo}`,
      text: [
        `Motivo: ${message.motivo}`,
        `Nombre: ${message.nombre}`,
        `WhatsApp: ${message.telefono}`,
        `Correo: ${message.email}`,
        `Negocio: ${message.tipoNegocio}`,
        '',
        message.mensaje,
      ].join('\n'),
    });
    return 'sent';
  },
};

export function createContactNotifier(): ContactNotifier {
  if (process.env.CONTACT_DELIVERY === 'sink') return sink;
  return smtp;
}
