import { describe, expect, it } from 'vitest';
import { detectImageKind, reencodeUntrustedImage } from '../studio/upload-guard.js';

describe('upload guard', () => {
  it('rejects spoofed files', () => {
    const fake = Buffer.from('not-an-image');
    expect(detectImageKind(fake)).toBe('unknown');
    expect(reencodeUntrustedImage(fake).ok).toBe(false);
  });

  it('accepts png signature', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageKind(png)).toBe('png');
    const r = reencodeUntrustedImage(png);
    expect(r.ok).toBe(true);
  });
});
