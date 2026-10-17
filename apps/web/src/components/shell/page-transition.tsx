'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AppLoadingLogo } from '@/components/brand/app-loading-logo';

/** Brand handoff for (app) routes. Logo ~420 ms (AppLoadingLogo fades in after 150 ms). Reduced motion → fade only. */
export function PageTransition({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setReady(true);
      return;
    }
    const t = window.setTimeout(() => setReady(true), 420);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return <AppLoadingLogo screen label="Cambiando de pantalla…" />;
  }

  return <div className="route-fade">{children}</div>;
}
