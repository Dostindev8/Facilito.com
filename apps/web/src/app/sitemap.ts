import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

const PATHS = ['/', '/features', '/precios', '/nosotros', '/contacto', '/legal/privacidad', '/legal/terminos', '/legal/cookies'];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl().toString().replace(/\/$/, '');
  const lastModified = new Date('2026-10-07');
  return PATHS.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    lastModified,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.6,
  }));
}
