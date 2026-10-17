import type { NextConfig } from 'next';

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const isProd = process.env.NODE_ENV === 'production';
const MARKETING_URL = (process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://facilitord-web.vercel.app').replace(/\/+$/, '');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ['@facilito/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Every page is dynamic (CSP nonce), so metadata would stream into <body>; it is static, so blocking costs nothing.
  htmlLimitedBots: /.*/,
  experimental: {
    inlineCss: true,
  },
  images: {
    remotePatterns: [],
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/:path*` }];
  },
  async redirects() {
    return [
      // App entry: marketing lives on the separate site (facilitord-web).
      { source: '/', destination: '/login', permanent: false },
      { source: '/panel', destination: '/inicio', permanent: false },
      // Public sign-up was removed: accounts exist only after payment and admin authorization.
      ...['/register', '/registro', '/signup', '/onboarding'].map((source) => ({ source, destination: '/suscribirme', statusCode: 301 as const })),
      // Former landing pages → dedicated marketing deploy.
      ...['/features', '/precios', '/nosotros', '/contacto', '/modulos'].map((source) => ({
        source,
        destination: MARKETING_URL,
        permanent: true,
      })),
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
