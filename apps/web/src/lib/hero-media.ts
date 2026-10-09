import fs from 'node:fs';
import path from 'node:path';

export const HERO_POSTER = '/media/facilito-hero-poster.webp';
export const HERO_POSTER_WIDTH = 1024;
export const HERO_POSTER_HEIGHT = 727;

const LOOP_FILES = ['facilito-hero-1080-loop.mp4', 'facilito-hero-720-loop.mp4'] as const;

/** True only when the encoded loops exist. The original Fondofacilito.mp4 is never served. */
export function heroVideoAvailable(): boolean {
  return LOOP_FILES.every((name) => fs.existsSync(path.join(process.cwd(), 'public', 'media', name)));
}
