import { readFileSync, existsSync } from 'node:fs';
import * as argon2 from 'argon2';
import { SignJWT, jwtVerify, importPKCS8, importSPKI, generateKeyPair } from 'jose';
import { authenticator } from 'otplib';
import { newUuidsV7, type RoleCode } from '@facilito/domain';
import { getEnv } from '../config/env.js';
import { sha256, encryptField, decryptField } from '../utils/crypto.js';

type JwtKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let privateKey: JwtKey | null = null;
let publicKey: JwtKey | null = null;

async function loadKeys(): Promise<{ privateKey: JwtKey; publicKey: JwtKey }> {
  if (privateKey && publicKey) return { privateKey, publicKey };
  const env = getEnv();
  if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
    // Hosts that only offer single-line env vars store the PEM with literal "\n".
    const pem = (v: string) => v.replace(/\\n/g, '\n');
    privateKey = await importPKCS8(pem(env.JWT_PRIVATE_KEY), 'RS256');
    publicKey = await importSPKI(pem(env.JWT_PUBLIC_KEY), 'RS256');
    return { privateKey, publicKey };
  }
  if (!existsSync(env.JWT_PRIVATE_KEY_PATH) || !existsSync(env.JWT_PUBLIC_KEY_PATH)) {
    if (env.NODE_ENV === 'production') {
      throw new Error('JWT keys are required in production (JWT_PRIVATE_KEY/JWT_PUBLIC_KEY or key files)');
    }
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    return { privateKey, publicKey };
  }
  privateKey = await importPKCS8(readFileSync(env.JWT_PRIVATE_KEY_PATH, 'utf8'), 'RS256');
  publicKey = await importSPKI(readFileSync(env.JWT_PUBLIC_KEY_PATH, 'utf8'), 'RS256');
  return { privateKey, publicKey };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Burns the same Argon2id cost when the account does not exist, so response time does not reveal it. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(`dummy-${newUuidsV7()}`);
  await verifyPassword(await dummyHash, password);
  return false;
}

export interface AccessClaims {
  sub: string;
  tenantId: string;
  accesoId: string;
  rol: RoleCode;
  /** UI hint only: platform endpoints re-check membership in the database. */
  platformAdmin: boolean;
  /** A second factor (TOTP) was verified when this session family started. */
  mfa: boolean;
  /** Refresh-token family: revoking it ends this access token too (checked by session-status). */
  sid?: string;
  typ: 'access';
}

export async function signAccessToken(claims: Omit<AccessClaims, 'typ' | 'mfa'> & { mfa?: boolean }): Promise<string> {
  const { privateKey: key } = await loadKeys();
  const env = getEnv();
  return new SignJWT({
    tenantId: claims.tenantId,
    accesoId: claims.accesoId,
    rol: claims.rol,
    ...(claims.platformAdmin ? { pa: true } : {}),
    ...(claims.mfa ? { mfa: true } : {}),
    ...(claims.sid ? { sid: claims.sid } : {}),
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { publicKey: key } = await loadKeys();
  const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'] });
  if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('Invalid access token');
  }
  return {
    sub: payload.sub,
    tenantId: String(payload.tenantId),
    accesoId: String(payload.accesoId),
    rol: payload.rol as RoleCode,
    platformAdmin: payload.pa === true,
    mfa: payload.mfa === true,
    ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}),
    typ: 'access',
  };
}

export function newRefreshTokenValue(): { raw: string; hash: string; id: string; familyId: string } {
  const id = newUuidsV7();
  const familyId = newUuidsV7();
  const raw = `${id}.${newUuidsV7()}`;
  return { raw, hash: sha256(raw), id, familyId };
}

export function hashRefresh(raw: string): string {
  return sha256(raw);
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function encryptTotpSecret(secret: string): string {
  return encryptField(secret);
}

export function decryptTotpSecret(enc: string): string {
  return decryptField(enc);
}

/** One step either side absorbs phone clock drift; the login path blocks replays inside that window. */
const totpVerifier = authenticator.clone({ window: 1 });

export function verifyTotp(secret: string, token: string): boolean {
  return totpVerifier.verify({ token, secret });
}

export async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, { type: argon2.argon2id, memoryCost: 16384, timeCost: 2, parallelism: 1 });
}

export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  return argon2.verify(hash, pin);
}
