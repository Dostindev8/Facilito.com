import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/inicio',
        '/ventas',
        '/inventario',
        '/facturacion',
        '/clientes',
        '/proveedores',
        '/reportes',
        '/configuracion',
        '/admin',
        '/notificaciones',
        '/recuperar',
        '/restablecer',
        '/confirmar-correo',
      ],
    },
    sitemap: `${siteUrl().toString().replace(/\/$/, '')}/sitemap.xml`,
    host: siteUrl().origin,
  };
}
