import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/** App-facing public URLs only. Marketing pages live on the separate facilitord-web deploy. */
const PATHS = ['/login', '/suscribirme', '/legal/privacidad', '/legal/terminos', '/legal/cookies'];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl().toString().replace(/\/$/, '');
  const lastModified = new Date('2026-10-16');
  return PATHS.map((path) => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency: path === '/login' ? 'weekly' : 'monthly',
    priority: path === '/login' ? 1 : 0.6,
  }));
}
