export const TZ = 'America/Santo_Domingo';

const moneyFmt = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 3 });
const compactFmt = new Intl.NumberFormat('es-DO', { notation: 'compact', maximumFractionDigits: 1 });

export function money(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return `RD$ ${moneyFmt.format(Number.isFinite(n) ? n : 0)}`;
}

export function moneyCompact(v: string | number): string {
  const n = Number(v);
  return n >= 10_000 ? `RD$ ${compactFmt.format(n)}` : money(n);
}

export function qty(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return qtyFmt.format(Number.isFinite(n) ? n : 0);
}

export function pct(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return `${n > 0 ? '+' : ''}${n.toLocaleString('es-DO', { maximumFractionDigits: 1 })}%`;
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateLong(iso: string): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

/** Long date of an instant (ISO timestamp) as seen in the business time zone; `dateLong` takes a bare YYYY-MM-DD. */
export function instantLong(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

export function dateShort(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function dateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
    .format(new Date(`${iso}T12:00:00Z`))
    .replace('.', '');
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'justo ahora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
  return dateShort(iso);
}

export function greetingName(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}

export function initials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'F';
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  manager: 'Gerente',
  cashier: 'Cajero',
  warehouse: 'Almacén',
  accountant: 'Contador',
  viewer: 'Consulta',
};

export const ESTADO_FACTURA_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  anulada: 'Anulada',
  vencida: 'Vencida',
};

export const METODO_PAGO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
};

export const MOTIVO_LABEL: Record<string, string> = {
  merma: 'Merma',
  devolucion: 'Devolución',
  conteo_fisico: 'Conteo físico',
  ajuste: 'Ajuste',
  compra: 'Compra',
  venta: 'Venta',
  anulacion: 'Anulación',
  inicial: 'Inventario inicial',
};

/** Decimal-safe helpers for UI previews. The server recomputes every amount. */
export function toCents(v: string | number): bigint {
  const s = String(v ?? '0').trim().replace(/,/g, '') || '0';
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = s.replace('-', '').split('.');
  const frac = (f + '000').slice(0, 3);
  let cents = BigInt(i || '0') * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n;
  return neg ? -cents : cents;
}

export function centsToString(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
