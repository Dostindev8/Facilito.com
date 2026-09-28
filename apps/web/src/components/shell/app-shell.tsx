'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/hooks';
import { AppLoadingLogo } from '@/components/brand/app-loading-logo';
import { Sidebar } from './sidebar';
import { SearchBox } from './search-box';
import { NotificationsMenu } from './notifications';
import { ProfileMenu } from './profile-menu';

export const APP_VERSION = '1.0.0';

export function AppShell({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    document.querySelector<HTMLElement>('#app-sidebar .nav-item')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.querySelector<HTMLElement>('.menu-btn')?.focus();
    };
  }, [drawer]);

  if (status !== 'authenticated' || !user) {
    return <AppLoadingLogo screen label="Cargando tu negocio…" />;
  }

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <Sidebar open={drawer} onClose={() => setDrawer(false)} />
      <div className="main-col">
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} /> Sin conexión. Los cambios no se guardarán hasta que vuelva el internet.
          </div>
        )}
        <header className="header">
          <button
            type="button"
            className="icon-btn menu-btn"
            onClick={() => setDrawer(true)}
            aria-label="Abrir menú"
            aria-controls="app-sidebar"
            aria-expanded={drawer}
          >
            <Menu size={22} />
          </button>
          <SearchBox />
          <div className="header-actions">
            <NotificationsMenu tenantId={user.tenantId} />
            <ProfileMenu user={user} />
          </div>
        </header>
        <main id="main" className="content" key={user.tenantId}>
          <div key={pathname} className="route-fade">
            {children}
          </div>
        </main>
        <footer className="app-footer">Facilito by Logic Code Spot · v{APP_VERSION}</footer>
      </div>
    </div>
  );
}

/** Lets pages tell shared widgets (notifications, KPIs) that data changed. */
export function notifyDataChanged() {
  window.dispatchEvent(new Event('facilito:data-changed'));
}
