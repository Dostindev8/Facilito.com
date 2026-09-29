import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '../config/env.js';

const smtp = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  options: [] as Array<Record<string, unknown>>,
  fail: false,
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      smtp.options.push(options);
      return {
        sendMail: async (msg: Record<string, unknown>) => {
          if (smtp.fail) throw Object.assign(new Error('auth failed'), { code: 'EAUTH' });
          smtp.sent.push(msg);
        },
      };
    },
  },
}));

const SMTP_ENV = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'logiccodespot@gmail.com',
  SMTP_PASS: 'app-password-test',
  APP_PUBLIC_URL: 'https://facilito.example/',
};

async function loadMailer() {
  vi.resetModules();
  resetEnvForTests();
  return import('../services/mailer.js');
}

beforeEach(() => {
  smtp.sent.length = 0;
  smtp.options.length = 0;
  smtp.fail = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('mailer SMTP', () => {
  it('sin credenciales no intenta enviar', async () => {
    const m = await loadMailer();
    expect(m.emailProviderConfigured()).toBe(false);
    await m.sendPasswordResetEmail('ana@facilito.test', 'tok');
    expect(smtp.options).toHaveLength(0);
  });

  it('envía el reset con TLS, remitente de la cuenta y enlace absoluto', async () => {
    for (const [k, v] of Object.entries(SMTP_ENV)) vi.stubEnv(k, v);
    const m = await loadMailer();
    expect(m.emailProviderConfigured()).toBe(true);
    await m.sendPasswordResetEmail('ana@facilito.test', 'a+b/c=');

    expect(smtp.options[0]).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'logiccodespot@gmail.com' } });
    const msg = smtp.sent[0]!;
    expect(msg).toMatchObject({ from: '"Facilito" <logiccodespot@gmail.com>', to: 'ana@facilito.test' });
    const link = 'https://facilito.example/restablecer?token=a%2Bb%2Fc%3D';
    expect(msg.text).toContain(link);
    expect(msg.html).toContain(link);
    expect(msg.html).toContain('https://facilito.example/brand/facilito-mark.png');
  });

  it('el aviso de cambio escapa HTML y enmascara el correo nuevo', async () => {
    for (const [k, v] of Object.entries(SMTP_ENV)) vi.stubEnv(k, v);
    const m = await loadMailer();
    await m.sendEmailChangeNoticeEmail('ana@facilito.test', '<script>x@evil.test');
    const html = String(smtp.sent[0]!.html);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;s');
    expect(String(smtp.sent[0]!.text)).not.toContain('script>x@');
  });

  it('una falla SMTP se convierte en MailDeliveryError sin registrar el token', async () => {
    for (const [k, v] of Object.entries(SMTP_ENV)) vi.stubEnv(k, v);
    const m = await loadMailer();
    smtp.fail = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(m.sendEmailChangeEmail('ana@facilito.test', 'secret-token-123')).rejects.toBeInstanceOf(m.MailDeliveryError);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]![0])).toContain('EAUTH');
    expect(String(log.mock.calls[0]![0])).not.toContain('secret-token-123');
    log.mockRestore();
  });
});
