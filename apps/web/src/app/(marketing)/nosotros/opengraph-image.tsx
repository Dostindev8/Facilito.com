import { brandOg, ogContentType, ogSize } from '@/components/marketing/og-card';

export const alt = 'Facilito by Logic Code Spot, hecho en Santo Domingo.';
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return brandOg('Nosotros', 'Hecho en Santo Domingo.');
}
