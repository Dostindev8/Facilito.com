import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Poppins, Dancing_Script } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/toast';
import { siteUrl } from '@/lib/site';
import './globals.css';

const sans = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const script = Dancing_Script({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-script', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: 'Facilito — Tu negocio, más fácil cada día', template: '%s · Facilito' },
  description: 'Ventas, inventario y facturación para negocios en República Dominicana. Facilito by Logic Code Spot.',
  applicationName: 'Facilito',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0E8A5F',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every page into dynamic rendering so the CSP nonce is applied.
  await headers();
  return (
    <html lang="es-DO" className={`${sans.variable} ${script.variable}`}>
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
