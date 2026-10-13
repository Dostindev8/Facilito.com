import { provisionPlatformAdmin } from './platform-admin.js';
import { getDriver } from './client.js';

/**
 * Usage (credentials come from the environment, never from argv or the repo):
 *   PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=... [PLATFORM_ADMIN_NAME=...] [PLATFORM_ADMIN_RESET_TOTP=1] pnpm --filter @facilito/api platform:admin
 * PLATFORM_ADMIN_RESET_TOTP=1 removes the second factor (lost phone); the provisioning already revokes every session.
 * Needs DATABASE_DRIVER=pg and DATABASE_ADMIN_URL. FIELD_ENCRYPTION_KEY only has to satisfy env validation: nothing
 * written here is encrypted.
 */
async function main(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required');
  const resetTotp = process.env.PLATFORM_ADMIN_RESET_TOTP === '1';
  const r = await provisionPlatformAdmin({ email, password, nombre: process.env.PLATFORM_ADMIN_NAME ?? 'Administrador', resetTotp });
  console.log(`Platform admin ${r.created ? 'created' : 'updated'}: persona ${r.personaId}, workspace ${r.tenantId}`);
  if (resetTotp && !r.created) console.log('2FA removed: the admin must enrol a new authenticator on the next login.');
  await (await getDriver()).close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
