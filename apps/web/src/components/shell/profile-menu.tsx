'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Building2, ChevronDown, Clock3, FileText, LogOut, Settings, UserRound } from 'lucide-react';
import type { SessionUser } from '@/lib/api';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL, dateTime, initials, money } from '@/lib/format';
import { featureEnabled } from '@/lib/features';
import { useClickOutside } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';
import { APP_VERSION } from '@/lib/app-version';

const LAST_ACCESS_KEY = 'facilito:lastAccessAt';

type RecentInvoice = {
  id: string;
  numero: string;
  cliente: string;
  total: string;
  estado: string;
};

export function ProfileMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [lastAccess, setLastAccess] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInvoice[]>([]);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const { logout, switchTenant } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const rich = featureEnabled('richProfileMenu');

  useEffect(() => {
    try {
      const prev = localStorage.getItem(LAST_ACCESS_KEY);
      setLastAccess(prev);
      localStorage.setItem(LAST_ACCESS_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open || !rich) return;
    let alive = true;
    api<{ recientes: RecentInvoice[] }>('/v1/dashboard', { query: { dias: 7 } })
      .then((d) => {
        if (alive) setRecent((d.recientes ?? []).slice(0, 3));
      })
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, [open, rich]);

  const doLogout = async () => {
    close();
    await logout();
    router.replace('/login');
  };

  const doSwitch = async (tenantId: string) => {
    close();
    try {
      await switchTenant(tenantId);
      router.replace('/inicio');
      router.refresh();
    } catch (e) {
      toast.error('No se pudo cambiar de negocio', errorMessage(e));
    }
  };

  const roleBadge = user.platformAdmin ? 'Admin plataforma' : (ROLE_LABEL[user.rol] ?? user.rol);

  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="profile-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden>
          {initials(user.nombre)}
        </span>
        <span className="profile-meta">
          <strong>{user.nombre}</strong>
          <small>{roleBadge}</small>
        </span>
        <ChevronDown size={16} className="muted" aria-hidden />
        <span className="sr-only">Menú de perfil</span>
      </button>
      {open && (
        <div className="dropdown-panel profile-panel" role="menu">
          <div className="dropdown-head profile-head">
            <span className="avatar avatar-lg" aria-hidden>
              {initials(user.nombre)}
            </span>
            <div>
              <strong>{user.nombre}</strong>
              <small className="muted">{user.email}</small>
              <span className={`role-pill ${user.platformAdmin ? 'platform' : ''}`}>{roleBadge}</span>
              <small className="muted">
                {ROLE_LABEL[user.rol]} · {user.negocio}
              </small>
            </div>
          </div>

          {rich && (
            <div className="profile-section">
              <p className="profile-section-label">Mi actividad reciente</p>
              {recent.length === 0 ? (
                <p className="muted profile-empty">Aún no hay facturas recientes.</p>
              ) : (
                <ul className="profile-activity">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <Link href={`/facturacion/${r.id}`} className="dropdown-item" role="menuitem" onClick={close}>
                        <FileText size={16} aria-hidden />
                        <span>
                          <strong>{r.numero}</strong>
                          <small className="muted">
                            {r.cliente} · {r.estado}
                          </small>
                        </span>
                        <small>{money(r.total)}</small>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/facturacion" className="profile-link" onClick={close}>
                Ver todas las facturas
              </Link>
            </div>
          )}

          <div className="dropdown-list">
            {user.businesses.length > 1 && (
              <>
                {user.businesses
                  .filter((b) => b.tenantId !== user.tenantId)
                  .map((b) => (
                    <button key={b.tenantId} type="button" role="menuitem" className="dropdown-item" onClick={() => doSwitch(b.tenantId)}>
                      <Building2 size={17} aria-hidden /> Cambiar a {b.razonSocial}
                    </button>
                  ))}
              </>
            )}
            <Link href="/configuracion?tab=cuenta" role="menuitem" className="dropdown-item" onClick={close}>
              <UserRound size={17} aria-hidden /> Mi cuenta
            </Link>
            <Link href="/configuracion" role="menuitem" className="dropdown-item" onClick={close}>
              <Settings size={17} aria-hidden /> Configuración
            </Link>
          </div>

          {rich && (
            <div className="profile-meta-block">
              <div>
                <span className="muted">Versión</span>
                <strong>Facilito v{APP_VERSION}</strong>
              </div>
              <div>
                <span className="muted">
                  <Clock3 size={12} aria-hidden /> Último acceso
                </span>
                <strong>{lastAccess ? dateTime(lastAccess) : 'Este inicio de sesión'}</strong>
              </div>
            </div>
          )}

          <div className="dropdown-list">
            <button type="button" role="menuitem" className="dropdown-item danger" onClick={doLogout}>
              <LogOut size={17} aria-hidden /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
