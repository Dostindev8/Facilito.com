/**
 * Mirrors `billing.plan` (migration 009). The checkout always charges the amount stored in the database,
 * so a mismatch here only affects the marketing copy — keep both in sync when prices change.
 * CONFIRMAR PRECIOS: Logic Code Spot todavía no confirma las tarifas ni si incluyen ITBIS
 * (docs/audit/DECISIONES_PENDIENTES.md).
 */
export const PRICES_CONFIRMED = false;

export interface Plan {
  id: 'inicial' | 'profesional' | 'negocio';
  name: string;
  priceDop: number;
  blurb: string;
  items: readonly string[];
  featured: boolean;
}

export const plans: readonly Plan[] = [
  {
    id: 'inicial',
    name: 'Inicial',
    priceDop: 690,
    blurb: 'Para el negocio que empieza a organizar sus ventas.',
    items: ['Ventas, facturación, inventario y reportes', 'Hasta 2 usuarios', 'Hasta 500 productos'],
    featured: false,
  },
  {
    id: 'profesional',
    name: 'Profesional',
    priceDop: 1490,
    blurb: 'Para el negocio que ya vende todos los días.',
    items: ['Todo lo de Inicial', 'Hasta 5 usuarios', 'Hasta 5,000 productos', 'Asistente Copilot'],
    featured: true,
  },
  {
    id: 'negocio',
    name: 'Negocio',
    priceDop: 2490,
    blurb: 'Para equipos con varios empleados.',
    items: ['Todo lo de Profesional', 'Hasta 15 usuarios', 'Productos ilimitados', 'Prioridad en soporte'],
    featured: false,
  },
];

export const pricingFaqs = [
  {
    question: '¿Cómo me suscribo?',
    answer:
      'Elige un plan, llena los datos de tu negocio y paga por transferencia bancaria. Sube la foto o el PDF del comprobante y nuestro equipo lo verifica. Al aprobarlo te llega un enlace para crear tu contraseña.',
  },
  {
    question: '¿Cuánto tarda la aprobación?',
    answer: 'Revisamos los comprobantes en horario laborable. Puedes ver el estado de tu solicitud en cualquier momento con el enlace que te damos al suscribirte.',
  },
  {
    question: '¿Puedo pagar con tarjeta?',
    answer: 'Todavía no. Por ahora el pago es por transferencia bancaria. Cuando habilitemos el pago con tarjeta lo verás aquí.',
  },
  {
    question: '¿Qué pasa si no renuevo a tiempo?',
    answer:
      'Tienes 7 días de gracia con todo funcionando. Después la cuenta pasa a solo lectura: puedes ver y exportar tus datos, pero no registrar ventas nuevas. Nunca borramos tus datos por falta de pago.',
  },
  {
    question: '¿Puedo cancelar?',
    answer: 'Sí, desde Suscripción en tu panel. Sigues usando Facilito hasta el final del mes que pagaste y no se renueva.',
  },
  {
    question: '¿Facilito ya envía comprobantes electrónicos a la DGII?',
    answer:
      'No. Hoy puedes emitir facturas en el panel y configurar secuencias de comprobantes. El envío electrónico e-CF está marcado como próximamente.',
  },
  {
    question: '¿Dónde quedan mis datos?',
    answer:
      'En la cuenta de tu negocio dentro de Facilito. El RNC y la cédula se guardan cifrados. La sesión de acceso usa una cookie httpOnly.',
  },
] as const;

export function formatDop(amount: number): string {
  return `RD$${amount.toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
}
