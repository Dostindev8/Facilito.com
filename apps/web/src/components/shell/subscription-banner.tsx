'use client';

import Link from 'next/link';
import { CalendarClock, Lock } from 'lucide-react';
import type { SessionUser } from '@/lib/api';
import { instantLong } from '@/lib/format';

const MANAGERS = new Set(['owner', 'manager']);

/** Grace and read-only states are enforced by the API (402 on writes); this only explains why. */
export function SubscriptionBanner({ user }: { user: SessionUser }) {
  const s = user.suscripcion;
  if (!s || user.platformAdmin) return null;
  const canPay = MANAGERS.has(user.rol);
  const fin = s.periodoFin ? instantLong(s.periodoFin) : null;

  let tone: 'warn' | 'danger';
  let text: string;
  if (s.estado === 'EN_GRACIA') {
    tone = 'warn';
    text = `Tu plan venció${fin ? ` el ${fin}` : ''}. Tienes unos días de gracia: renueva para no pasar a solo lectura.`;
  } else if (s.estado === 'SUSPENDIDA') {
    tone = 'danger';
    text = 'Cuenta en solo lectura por falta de pago. Puedes ver y exportar tus datos; para vender de nuevo, renueva el plan.';
  } else if (s.estado === 'CANCELADA') {
    tone = 'danger';
    text = 'La suscripción terminó. Tus datos se conservan en solo lectura.';
  } else {
    return null;
  }

  return (
    <div className={`sub-banner ${tone}`} role="status">
      {s.soloLectura ? <Lock size={16} aria-hidden /> : <CalendarClock size={16} aria-hidden />}
      <span>{canPay ? text : `${text} Avísale al dueño del negocio.`}</span>
      {canPay && (
        <Link href="/suscripcion" className="btn btn-sm btn-primary">
          {s.estado === 'CANCELADA' ? 'Ver suscripción' : 'Renovar'}
        </Link>
      )}
    </div>
  );
}
