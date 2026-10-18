import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginIntro } from '@/components/auth/login-intro';
import { LoginCard } from './login-card';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
  description: 'Facilito: ventas, inventario y facturación para tu negocio en República Dominicana.',
  robots: { index: true, follow: false },
};

export default function LoginPage() {
  return (
    <AuthLayout>
      <LoginIntro>
        <Suspense fallback={null}>
          <LoginCard />
        </Suspense>
      </LoginIntro>
    </AuthLayout>
  );
}
