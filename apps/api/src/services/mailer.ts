import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../config/env.js';

/**
 * Outbound email over SMTP (e.g. Gmail with an app password). Without SMTP credentials, development prints
 * the link to the console so flows stay testable; any other environment logs nothing, because the token in
 * the link grants account access.
 */

export class MailDeliveryError extends Error {}

const GREEN = '#0E8A5F';
const INK = '#1B2838';
const MUTED = '#6B7785';

let transporter: Transporter | null = null;

export function emailProviderConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function appUrl(): string {
  const env = getEnv();
  const base = env.APP_PUBLIC_URL || env.CORS_ORIGINS.split(',')[0]?.trim() || 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

function getTransporter(): Transporter {
  const env = getEnv();
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    requireTLS: !env.SMTP_SECURE,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

interface Message {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

function render(m: Message): { html: string; text: string } {
  const base = appUrl();
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${escapeHtml(t)}</p>`;
  const button = m.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:${GREEN}">
<a href="${escapeHtml(m.action.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(m.action.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${MUTED}">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${escapeHtml(m.action.url)}" style="color:${GREEN};word-break:break-all">${escapeHtml(m.action.url)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F6F4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3F6F4;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px 28px">
<tr><td style="padding-bottom:20px"><img src="${escapeHtml(base)}/brand/facilito-mark.png" width="44" height="44" alt="Facilito" style="display:block;border:0"></td></tr>
<tr><td>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:${INK}">${escapeHtml(m.heading)}</h1>
${m.paragraphs.map(p).join('\n')}
${button}
<p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED}">${escapeHtml(m.footnote)}</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${MUTED}">Facilito by Logic Code Spot · Santo Domingo, R.D.</p>
</td></tr></table></body></html>`;
  const text = [m.heading, '', ...m.paragraphs, '', ...(m.action ? [`${m.action.label}: ${m.action.url}`, ''] : []), m.footnote, '', 'Facilito by Logic Code Spot'].join('\n');
  return { html, text };
}

async function deliver(m: Message): Promise<void> {
  const env = getEnv();
  const { html, text } = render(m);
  try {
    await getTransporter().sendMail({
      from: env.MAIL_FROM || `"Facilito" <${env.SMTP_USER}>`,
      ...(env.MAIL_REPLY_TO ? { replyTo: env.MAIL_REPLY_TO } : {}),
      to: m.to,
      subject: m.subject,
      text,
      html,
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
  } catch (err) {
    // Never log the message: it carries the token. The SMTP error code is enough to diagnose.
    const code = (err as { code?: string; responseCode?: number }).code ?? (err as { responseCode?: number }).responseCode;
    console.error(`[mailer] delivery failed (${code ?? 'unknown'}) subject="${m.subject}"`);
    throw new MailDeliveryError('email delivery failed');
  }
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const url = `${appUrl()}/restablecer?token=${encodeURIComponent(token)}`;
  if (!emailProviderConfigured()) {
    if (getEnv().NODE_ENV === 'development') console.info(`[mailer:dev] Password reset for ${email}: ${url}`);
    return;
  }
  await deliver({
    to: email,
    subject: 'Restablece tu contraseña de Facilito',
    heading: 'Restablece tu contraseña',
    paragraphs: ['Recibimos una solicitud para restablecer la contraseña de tu cuenta de Facilito.', 'El enlace vence en 30 minutos y solo se puede usar una vez.'],
    action: { label: 'Crear nueva contraseña', url },
    footnote: 'Si no pediste este cambio, ignora este correo: tu contraseña actual sigue funcionando.',
  });
}

export async function sendEmailChangeEmail(newEmail: string, token: string): Promise<void> {
  const url = `${appUrl()}/confirmar-correo?token=${encodeURIComponent(token)}`;
  if (!emailProviderConfigured()) {
    if (getEnv().NODE_ENV === 'development') console.info(`[mailer:dev] Email change to ${newEmail}: ${url}`);
    return;
  }
  await deliver({
    to: newEmail,
    subject: 'Confirma tu nuevo correo en Facilito',
    heading: 'Confirma tu nuevo correo',
    paragraphs: ['Pediste usar esta dirección para entrar a Facilito. Confírmala para completar el cambio.', 'El enlace vence en 60 minutos. Al confirmarlo cerraremos tus sesiones abiertas.'],
    action: { label: 'Confirmar correo', url },
    footnote: 'Si no reconoces esta solicitud, ignora este correo y no se hará ningún cambio.',
  });
}

export function invitationUrl(token: string): string {
  return `${appUrl()}/activar?token=${encodeURIComponent(token)}`;
}

/** Returns whether an email actually left; the admin panel always gets the link to share it another way. */
export async function sendInvitationEmail(email: string, nombre: string, negocio: string, token: string, horas: number): Promise<boolean> {
  const url = invitationUrl(token);
  if (!emailProviderConfigured()) {
    if (getEnv().NODE_ENV === 'development') console.info(`[mailer:dev] Invitation for ${email}: ${url}`);
    return false;
  }
  await deliver({
    to: email,
    subject: 'Tu cuenta de Facilito está lista',
    heading: `¡Bienvenido a Facilito, ${nombre}!`,
    paragraphs: [
      `Confirmamos tu pago y aprobamos la cuenta de ${negocio}.`,
      `Crea tu contraseña para entrar. El enlace vence en ${horas} horas y solo se puede usar una vez.`,
    ],
    action: { label: 'Crear mi contraseña', url },
    footnote: 'Si no solicitaste una cuenta de Facilito, ignora este correo.',
  });
  return true;
}

export async function sendNewRequestNotice(to: string[], negocio: string, plan: string): Promise<void> {
  if (!emailProviderConfigured() || !to.length) return;
  await deliver({
    to: to.join(','),
    subject: `Nueva solicitud de suscripción: ${negocio}`,
    heading: 'Hay una solicitud esperando autorización',
    paragraphs: [`${negocio} pidió el plan ${plan} y subió su comprobante de pago.`, 'Verifica la transferencia en el banco antes de autorizar.'],
    action: { label: 'Revisar solicitudes', url: `${appUrl()}/admin?tab=solicitudes` },
    footnote: 'Recibes este aviso porque eres administrador de Facilito.',
  });
}

export async function sendRequestRejectedEmail(email: string, negocio: string, motivo: string): Promise<void> {
  if (!emailProviderConfigured()) return;
  await deliver({
    to: email,
    subject: 'Sobre tu solicitud de Facilito',
    heading: 'No pudimos aprobar tu solicitud',
    paragraphs: [`Revisamos la solicitud de ${negocio} y no pudimos aprobarla.`, `Motivo: ${motivo}`, 'Si ya hiciste el pago, responde este correo y te ayudamos.'],
    footnote: 'Facilito nunca te pedirá tu contraseña por correo.',
  });
}

export async function sendPaymentReceivedEmail(email: string, negocio: string, monto: string, periodoFin: string): Promise<void> {
  if (!emailProviderConfigured()) return;
  await deliver({
    to: email,
    subject: 'Recibimos tu pago de Facilito',
    heading: 'Pago confirmado',
    paragraphs: [`Registramos tu pago de ${monto} para ${negocio}.`, `Tu suscripción está activa hasta el ${periodoFin}.`],
    action: { label: 'Ver mi suscripción', url: `${appUrl()}/suscripcion` },
    footnote: 'Puedes descargar el recibo desde la sección Suscripción.',
  });
}

export async function sendInvoiceEmail(
  to: string,
  negocio: string,
  numero: string,
  total: string,
  pdf: { filename: string; bytes: Buffer },
): Promise<void> {
  await deliver({
    to,
    subject: `Factura ${numero} de ${negocio}`,
    heading: `Factura ${numero}`,
    paragraphs: [`${negocio} te envía la factura ${numero} por ${total}.`, 'La encontrarás adjunta en PDF.'],
    footnote: `Enviado por ${negocio} a través de Facilito. Si tienes preguntas, responde a este correo o contacta al negocio.`,
    attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: 'application/pdf' }],
  });
}

/** Security notice to the address that is being replaced, so the owner learns about a change they did not make. */
export async function sendEmailChangeNoticeEmail(currentEmail: string, newEmail: string): Promise<void> {
  if (!emailProviderConfigured()) return;
  const [user = '', domain = ''] = newEmail.split('@');
  const masked = `${user.slice(0, 2)}${'•'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
  await deliver({
    to: currentEmail,
    subject: 'Se solicitó cambiar el correo de tu cuenta de Facilito',
    heading: 'Solicitud de cambio de correo',
    paragraphs: [`Se pidió cambiar el correo de acceso de tu cuenta a ${masked}.`, 'Mientras no se confirme desde esa dirección, sigues entrando con este correo.'],
    action: { label: 'Revisar mi cuenta', url: `${appUrl()}/configuracion?tab=cuenta` },
    footnote: 'Si no fuiste tú, entra, cancela el cambio y cambia tu contraseña de inmediato.',
  });
}
