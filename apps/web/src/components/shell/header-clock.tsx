'use client';

import { useEffect, useState } from 'react';
import { featureEnabled } from '@/lib/features';

const TZ = 'America/Santo_Domingo';

export function HeaderClock() {
  const enabled = featureEnabled('headerClock');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const text = new Intl.DateTimeFormat('es-DO', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);

  return (
    <time className="header-clock" dateTime={now.toISOString()} title="Hora República Dominicana">
      <span className="header-clock-dot" aria-hidden />
      {text}
    </time>
  );
}
