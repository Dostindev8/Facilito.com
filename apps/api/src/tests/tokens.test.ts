import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Tokens = typeof import('../auth/tokens.js');

const claims = { sub: 'u-1', tenantId: 't-1', accesoId: 'a-1', rol: 'owner' as const, platformAdmin: false };
const saved = { ...process.env };

function rsaPem() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/** tokens.ts caches keys and env per module instance, so each scenario loads a fresh copy. */
async function freshTokens(env: Record<string, string>): Promise<Tokens> {
  Object.assign(process.env, env);
  vi.resetModules();
  return import('../auth/tokens.js');
}

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  vi.resetModules();
});

describe('llaves JWT RS256', () => {
  it('acepta PEM en variables de una sola línea (\\n literal), como en Vercel', async () => {
    const { privateKey, publicKey } = rsaPem();
    const t = await freshTokens({
      JWT_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
      JWT_PUBLIC_KEY: publicKey.replace(/\n/g, '\\n'),
    });
    const token = await t.signAccessToken({ ...claims, mfa: true, sid: 'fam-1' });
    expect(await t.verifyAccessToken(token)).toMatchObject({ ...claims, mfa: true, sid: 'fam-1', typ: 'access' });
  });

  it('lee las llaves desde archivos', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fc-jwt-'));
    try {
      const { privateKey, publicKey } = rsaPem();
      writeFileSync(path.join(dir, 'k.pem'), privateKey);
      writeFileSync(path.join(dir, 'k.pub'), publicKey);
      const t = await freshTokens({ JWT_PRIVATE_KEY_PATH: path.join(dir, 'k.pem'), JWT_PUBLIC_KEY_PATH: path.join(dir, 'k.pub') });
      expect((await t.verifyAccessToken(await t.signAccessToken(claims))).mfa).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('en producción se niega a arrancar sin llaves en vez de generar unas efímeras', async () => {
    const t = await freshTokens({ NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    await expect(t.signAccessToken(claims)).rejects.toThrow(/JWT keys are required in production/);
  });
});

describe('verificación de tokens', () => {
  it('rechaza un token firmado con otra llave, un HS256 y un token que no es de acceso', async () => {
    const t = await freshTokens({});
    const other = rsaPem();
    const foreignKey = await (await import('jose')).importPKCS8(other.privateKey, 'RS256');
    const foreign = await new SignJWT({ ...claims, typ: 'access' }).setProtectedHeader({ alg: 'RS256' }).setSubject('u-1').setExpirationTime('5m').sign(foreignKey);
    await expect(t.verifyAccessToken(foreign)).rejects.toThrow();

    const hs = await new SignJWT({ ...claims, typ: 'access' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u-1').sign(new TextEncoder().encode('x'.repeat(32)));
    await expect(t.verifyAccessToken(hs)).rejects.toThrow();

    const valid = await t.signAccessToken(claims);
    const [header, payload, signature] = valid.split('.');
    const tampered = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    tampered.rol = 'owner';
    tampered.pa = true;
    await expect(t.verifyAccessToken(`${header}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`)).rejects.toThrow();
  });

  it('una contraseña contra un hash corrupto devuelve false sin lanzar', async () => {
    const t = await freshTokens({});
    expect(await t.verifyPassword('not-a-hash', 'Segura12345')).toBe(false);
    expect(await t.verifyAgainstDummy('Segura12345')).toBe(false);
  });

  it('el PIN usa Argon2id y solo valida el correcto', async () => {
    const t = await freshTokens({});
    const hash = await t.hashPin('4321');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await t.verifyPin(hash, '4321')).toBe(true);
    expect(await t.verifyPin(hash, '1234')).toBe(false);
  });
});
