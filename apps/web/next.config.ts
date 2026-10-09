import type { NextConfig } from 'next';

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const isProd = process.env.NODE_ENV === 'production';

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
      { source: '/panel', destination: '/inicio', permanent: false },
      { source: '/onboarding', destination: '/login?tab=registro', permanent: false },
      { source: '/register', destination: '/login?tab=registro', permanent: false },
      { source: '/modulos', destination: '/features', permanent: true },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
