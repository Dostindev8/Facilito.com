/** Keep in sync with the custom properties in marketing.css. Durations are seconds for motion, ms in CSS. */

export const MOTION = {
  ease: [0.16, 1, 0.3, 1] as const,
  fast: 0.15,
  base: 0.32,
  slow: 0.9,
  reducedFade: 0.2,
} as const;

export const HEADER_OFFSET_PX = 88;
export const WORD_STAGGER_MS = 70;
export const HERO_PARALLAX = '18%';
