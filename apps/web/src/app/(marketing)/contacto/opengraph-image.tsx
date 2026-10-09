import { brandOg, ogContentType, ogSize } from '@/components/marketing/og-card';

export const alt = 'Contacto de Facilito en Santo Domingo.';
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return brandOg('Contacto', 'Santo Domingo, República Dominicana.');
}
