import { brandOg, ogContentType, ogSize } from '@/components/marketing/og-card';

export const alt = 'Módulos de Facilito: ventas, inventario y facturación.';
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return brandOg('Producto', 'Lo que Facilito hace hoy.');
}
