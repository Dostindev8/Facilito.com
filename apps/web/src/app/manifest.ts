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
      { src: '/brand/facilito-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/facilito-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/facilito-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/facilito-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
