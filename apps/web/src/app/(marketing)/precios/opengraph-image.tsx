import { brandOg, ogContentType, ogSize } from '@/components/marketing/og-card';

export const alt = 'Precios de referencia de Facilito. Confirmar antes de contratar.';
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return brandOg('Precios', 'Referencia. Confirmar antes de contratar.');
}
