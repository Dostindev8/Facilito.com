/**
 * Facilito brand tokens — sampled from official LCS logo (emerald hand + orange check).
 * Surfaces stay mint-white; UI language is business Spanish.
 */
export const brand = {
  name: 'Facilito',
  byline: 'by Logic Code Spot',
  colors: {
    primary: '#0B7A45',
    primaryLight: '#1F9A5A',
    primaryDark: '#064E32',
    accent: '#F47B20',
    ink: '#1B2838',
    mintBand: '#E4F6F2',
    mintSurface: '#F4FBFA',
    white: '#FFFFFF',
    danger: '#B42318',
    warning: '#B54708',
    success: '#0B7A45',
  },
  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    squircle: '22%',
  },
  font: {
    sans: '"Inter", "Segoe UI", system-ui, sans-serif',
  },
} as const;

export type BrandTokens = typeof brand;
