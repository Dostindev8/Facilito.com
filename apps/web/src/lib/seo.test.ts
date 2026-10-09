import { describe, expect, it } from 'vitest';
import { absoluteUrl, siteUrl } from './site';
import { breadcrumbJsonLd, softwareJsonLd } from './seo';

describe('seo helpers', () => {
  it('arma URL absoluta sin doble barra', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://facilito.example/';
    expect(siteUrl().origin).toBe('https://facilito.example');
    expect(absoluteUrl('/precios')).toBe('https://facilito.example/precios');
  });

  it('no inventa reseñas ni precio en el software', () => {
    const data = softwareJsonLd();
    expect(data.aggregateRating).toBeUndefined();
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|price/);
  });

  it('numera las migas', () => {
    const data = breadcrumbJsonLd([
      { name: 'Inicio', path: '/' },
      { name: 'Precios', path: '/precios' },
    ]);
    const items = data.itemListElement as { position: number }[];
    expect(items.map((item) => item.position)).toEqual([1, 2]);
  });
});
