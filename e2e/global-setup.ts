import type { FullConfig } from '@playwright/test';
import { enrolAdminTotp } from '../scripts/lib/e2e-accounts.mjs';

/**
 * Enrols a fresh authenticator for the end-to-end platform admin. Locally the API provisions that admin without 2FA on
 * every boot (E2E_PLATFORM_ADMIN_*); against a deployed environment the secret must come from E2E_ADMIN_TOTP_SECRET.
 * Workers inherit the secret through process.env.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.E2E_ADMIN_TOTP_SECRET) return;
  const baseURL = String(config.projects[0]?.use.baseURL ?? 'http://localhost:3000').replace(/\/$/, '');
  process.env.E2E_ADMIN_TOTP_SECRET = await enrolAdminTotp(baseURL);
}
