import type { ReactNode } from 'react';
import { AuthBackground } from './auth-background';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <AuthBackground />
      <div className="auth-card">{children}</div>
    </main>
  );
}

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) {
    return '/inicio';
  }
  return next;
}
