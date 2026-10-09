import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Facilito',
    short_name: 'Facilito',
    description: 'Ventas, inventario y facturación para negocios en República Dominicana.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0d855b',
    lang: 'es-DO',
    icons: [
      { src: '/brand/facilito-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/facilito-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
