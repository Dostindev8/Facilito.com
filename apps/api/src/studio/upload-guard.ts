import { createHash } from 'node:crypto';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);

export type UploadKind = 'png' | 'jpeg' | 'unknown';

export function detectImageKind(buf: Buffer): UploadKind {
  if (buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.subarray(0, 3).equals(JPEG_SIG)) return 'jpeg';
  return 'unknown';
}

/** Strip naive EXIF/APP segments for JPEG; PNG returned as-is after signature check. */
export function reencodeUntrustedImage(buf: Buffer): { ok: true; kind: UploadKind; hash: string; bytes: Buffer } | { ok: false; reason: string } {
  const kind = detectImageKind(buf);
  if (kind === 'unknown') return { ok: false, reason: 'unsupported_or_spoofed_type' };
  let cleaned = buf;
  if (kind === 'jpeg') {
    // Drop APP1 (EXIF) markers in a conservative pass
    cleaned = stripJpegApp1(buf);
  }
  const hash = createHash('sha256').update(cleaned).digest('hex');
  return { ok: true, kind, hash, bytes: cleaned };
}

function stripJpegApp1(buf: Buffer): Buffer {
  const out: number[] = [];
  out.push(0xff, 0xd8);
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1]!;
    if (marker === 0xda) {
      // SOS — copy rest
      for (let j = i; j < buf.length; j++) out.push(buf[j]!);
      break;
    }
    const len = (buf[i + 2]! << 8) + buf[i + 3]!;
    if (marker === 0xe1) {
      i += 2 + len;
      continue;
    }
    for (let j = i; j < i + 2 + len; j++) out.push(buf[j]!);
    i += 2 + len;
  }
  return Buffer.from(out);
}

function isWebp(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
}

/**
 * Product images: accept only real PNG/JPEG/WebP bytes, then fully decode and re-encode.
 * Re-encoding drops metadata and any appended/polyglot payload; the output is always WebP.
 */
export async function sanitizeProductImage(
  buf: Buffer,
  maxBytes: number,
): Promise<{ ok: true; hash: string; bytes: Buffer; mime: 'image/webp' } | { ok: false; reason: string }> {
  if (buf.length === 0 || buf.length > maxBytes) return { ok: false, reason: 'size' };
  if (detectImageKind(buf) === 'unknown' && !isWebp(buf)) return { ok: false, reason: 'unsupported_or_spoofed_type' };
  const scan = await scanMalware(buf);
  if (!scan.clean) return { ok: false, reason: 'malware' };
  try {
    const { default: sharp } = await import('sharp');
    const bytes = await sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { ok: true, hash: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/webp' };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

/** Malware scan port — stub always clean in local; ClamAV in Compose profile. */
export async function scanMalware(_buf: Buffer): Promise<{ clean: boolean }> {
  return { clean: true };
}
