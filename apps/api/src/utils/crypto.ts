import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../config/env.js';

function keyBytes(): Buffer {
  const raw = Buffer.from(getEnv().FIELD_ENCRYPTION_KEY, 'base64');
  if (raw.length >= 32) return raw.subarray(0, 32);
  return createHash('sha256').update(getEnv().FIELD_ENCRYPTION_KEY).digest();
}

/** Encrypt sensitive fields (RNC, TOTP secrets). AES-256-GCM. */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptField(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Keyed lookup hash: a plain SHA-256 of a 9/11-digit RNC is brute-forceable. */
export function hashRnc(rnc: string): string {
  return createHmac('sha256', keyBytes()).update(`rnc:${rnc.replace(/\D/g, '')}`).digest('hex');
}

export function decryptFieldSafe(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptField(payload);
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
