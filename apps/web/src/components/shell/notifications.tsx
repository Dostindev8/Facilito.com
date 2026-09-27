'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Bell, CircleCheck, FileText, PackageX, Receipt, TriangleAlert, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useClickOutside } from '@/lib/hooks';

export interface NotificationDto {
  id: string;
  tipo: 'stock' | 'agotado' | 'vencida' | 'ncf' | 'anulada' | 'venta';
  titulo: string;
  detalle: string;
  fecha: string;
  href: string;
}

export const NOTIF_META: Record<NotificationDto['tipo'], { icon: LucideIcon; tone: string }> = {
  stock: { icon: TriangleAlert, tone: 'tone-orange' },
  agotado: { icon: PackageX, tone: 'tone-red' },
  vencida: { icon: Receipt, tone: 'tone-red' },
  ncf: { icon: FileText, tone: 'tone-purple' },
  anulada: { icon: Ban, tone: 'tone-blue' },
  venta: { icon: CircleCheck, tone: 'tone-green' },
};

const MAX_READ = 300;

function readKey(tenantId: string) {
  return `fc_notif_read:${tenantId}`;
}

function loadRead(tenantId: string): Set<string> {
  try {
    const raw = localStorage.getItem(readKey(tenantId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(-MAX_READ) : []);
  } catch {
    return new Set();
  }
}

function saveRead(tenantId: string, ids: Set<string>) {
  try {
    localStorage.setItem(readKey(tenantId), JSON.stringify([...ids].slice(-MAX_READ)));
  } catch {
    /* storage full or disabled: read state is best-effort */
  }
}

/** Notifications are derived from live data server-side; read state is per device. */
export function useNotifications(tenantId: string | undefined) {
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      setItems(await api<NotificationDto[]>('/v1/notifications'));
    } catch {
      /* keep last known list */
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    setRead(loadRead(tenantId));
    void load();
    const t = setInterval(load, 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('facilito:data-changed', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('facilito:data-changed', onFocus);
    };
  }, [tenantId, load]);

  const markRead = useCallback(
    (ids: string[]) => {
      if (!tenantId) return;
      setRead((prev) => {
        const next = new Set(prev);
        ids.forEach((i) => next.add(i));
        saveRead(tenantId, next);
        return next;
      });
    },
    [tenantId],
  );

  const unread = useMemo(() => items.filter((i) => !read.has(i.id)).length, [items, read]);
  return { items, read, unread, loading, markRead, reload: load };
}

export function NotificationsMenu({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const { items, read, unread, markRead } = useNotifications(tenantId);

  return (
    <div className="dropdown bell" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={21} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown-panel notif" role="dialog" aria-label="Notificaciones">
          <div className="dropdown-head">
            <strong>Notificaciones</strong>
            {unread > 0 && (
              <button type="button" className="link-btn" onClick={() => markRead(items.map((i) => i.id))}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="dropdown-list">
            {items.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <strong>Todo en orden</strong>
                <p>No tienes notificaciones nuevas.</p>
              </div>
            ) : (
              <ul className="notif-list">
                {items.map((n) => {
                  const meta = NOTIF_META[n.tipo];
                  const Icon = meta.icon;
                  return (
                    <li key={n.id}>
                      <Link
                        href={n.href}
                        className={`notif-item ${read.has(n.id) ? '' : 'unread'}`}
                        onClick={() => {
                          markRead([n.id]);
                          close();
                        }}
                      >
                        <span className={`notif-icon ${meta.tone}`}>
                          <Icon size={18} aria-hidden />
                        </span>
                        <span className="notif-body">
                          <span className="notif-title">{n.titulo}</span>
                          <span className="notif-detail">{n.detalle}</span>
                        </span>
                        <span className="notif-time">{relativeTime(n.fecha)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
