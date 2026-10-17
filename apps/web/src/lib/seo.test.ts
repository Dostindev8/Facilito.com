import { describe, expect, it } from 'vitest';
import { absoluteUrl, siteUrl } from './site';
import { breadcrumbJsonLd, softwareJsonLd } from './seo';

describe('seo helpers', () => {
  it('arma URL absoluta sin doble barra', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://facilito.example/';
    expect(siteUrl().origin).toBe('https://facilito.example');
    expect(absoluteUrl('/login')).toBe('https://facilito.example/login');
  });

  it('sin URL configurada usa el dominio de producción de Vercel y nunca localhost en un deploy', () => {
    const saved = { site: process.env.NEXT_PUBLIC_SITE_URL, web: process.env.WEB_PUBLIC_URL, vercel: process.env.VERCEL_PROJECT_PRODUCTION_URL };
    try {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.WEB_PUBLIC_URL;
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'facilitord.vercel.app';
      expect(siteUrl().origin).toBe('https://facilitord.vercel.app');
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      expect(siteUrl().origin).toBe('http://localhost:3000');
    } finally {
      for (const [key, value] of [
        ['NEXT_PUBLIC_SITE_URL', saved.site],
        ['WEB_PUBLIC_URL', saved.web],
        ['VERCEL_PROJECT_PRODUCTION_URL', saved.vercel],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('no inventa reseñas ni precio en el software', () => {
    const data = softwareJsonLd();
    expect(data.aggregateRating).toBeUndefined();
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|price/);
  });

  it('numera las migas', () => {
    const data = breadcrumbJsonLd([
      { name: 'Login', path: '/login' },
      { name: 'Suscribirme', path: '/suscribirme' },
    ]);
    const items = data.itemListElement as { position: number }[];
    expect(items.map((item) => item.position)).toEqual([1, 2]);
  });
});
