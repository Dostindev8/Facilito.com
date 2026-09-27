'use client';

import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { dateTime, relativeTime } from '@/lib/format';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { NOTIF_META, useNotifications } from '@/components/shell/notifications';

export default function NotificationsPage() {
  const { user } = useAuth();
  const n = useNotifications(user?.tenantId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notificaciones</h1>
          <p>Avisos de stock, facturas vencidas, comprobantes y ventas recientes.</p>
        </div>
        {n.unread > 0 && (
          <button type="button" className="btn btn-outline" onClick={() => n.markRead(n.items.map((i) => i.id))}>
            <CheckCheck size={18} /> Marcar todas como leídas
          </button>
        )}
      </div>
      <section className="card">
        {n.loading ? (
          <Skeleton h={200} />
        ) : n.items.length === 0 ? (
          <EmptyState icon={<Bell size={26} />} title="Todo en orden" detail="No tienes notificaciones." />
        ) : (
          <ul className="notif-list">
            {n.items.map((item) => {
              const meta = NOTIF_META[item.tipo];
              const Icon = meta.icon;
              return (
                <li key={item.id}>
                  <Link href={item.href} className={`notif-item ${n.read.has(item.id) ? '' : 'unread'}`} onClick={() => n.markRead([item.id])}>
                    <span className={`notif-icon ${meta.tone}`}>
                      <Icon size={18} aria-hidden />
                    </span>
                    <span className="notif-body">
                      <span className="notif-title">{item.titulo}</span>
                      <span className="notif-detail">{item.detalle}</span>
                    </span>
                    <span className="notif-time" title={dateTime(item.fecha)}>
                      {relativeTime(item.fecha)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
