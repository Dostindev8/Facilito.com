'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Building2, ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import type { SessionUser } from '@/lib/api';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL, initials } from '@/lib/format';
import { useClickOutside } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';

export function ProfileMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const { logout, switchTenant } = useAuth();
  const router = useRouter();
  const toast = useToast();

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

  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="profile-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden>
          {initials(user.nombre)}
        </span>
        <span className="profile-meta">
          <strong>{user.nombre}</strong>
          <small>{user.platformAdmin ? 'Admin plataforma' : (ROLE_LABEL[user.rol] ?? user.rol)}</small>
        </span>
        <ChevronDown size={16} className="muted" aria-hidden />
        <span className="sr-only">Menú de perfil</span>
      </button>
      {open && (
        <div className="dropdown-panel" role="menu">
          <div className="dropdown-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <strong>{user.nombre}</strong>
            <small className="muted">{user.email}</small>
            <small className="muted">
              {ROLE_LABEL[user.rol]} · {user.negocio}
            </small>
          </div>
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
            <button type="button" role="menuitem" className="dropdown-item danger" onClick={doLogout}>
              <LogOut size={17} aria-hidden /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
