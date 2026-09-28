import { getEnv } from '../config/env.js';

/**
 * Outbound email port. No provider is configured yet (third-party blocker: SMTP/SES/Resend account).
 * In development the reset link is printed to the server console so the flow can be tested end to end;
 * in any other environment nothing is logged, because the token grants account access.
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const env = getEnv();
  if (env.NODE_ENV === 'development') {
    const base = env.CORS_ORIGINS.split(',')[0]?.trim() ?? 'http://localhost:3000';
    console.info(`[mailer:dev] Password reset for ${email}: ${base}/restablecer?token=${encodeURIComponent(token)}`);
  }
}

/** Same dev-only behavior as the reset link: the confirmation link is a credential for the new address. */
export async function sendEmailChangeEmail(newEmail: string, token: string): Promise<void> {
  const env = getEnv();
  if (env.NODE_ENV === 'development') {
    const base = env.CORS_ORIGINS.split(',')[0]?.trim() ?? 'http://localhost:3000';
    console.info(`[mailer:dev] Email change to ${newEmail}: ${base}/confirmar-correo?token=${encodeURIComponent(token)}`);
  }
}

export function emailProviderConfigured(): boolean {
  return false;
}
