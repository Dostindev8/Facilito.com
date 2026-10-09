import { brandOg, ogContentType, ogSize } from '@/components/marketing/og-card';

export const alt = 'Facilito: tu negocio, más fácil cada día. Ventas, inventario y facturación para República Dominicana.';
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return brandOg('Tu negocio, más fácil cada día.', 'Ventas, inventario y facturación.');
}
