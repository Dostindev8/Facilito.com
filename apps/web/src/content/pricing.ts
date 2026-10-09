/**
 * CONFIRMAR PRECIOS
 * El producto no publica planes ni tarifas (revisión del repo, 7 oct 2026).
 * Estas cifras son referencia del brief comercial, no una oferta vigente.
 * No mostrarlas como precio cerrado hasta que Logic Code Spot las confirme.
 */
export const PRICES_CONFIRMED = false;

export interface Plan {
  id: 'gratis' | 'pro' | 'business';
  name: string;
  priceUsd: number;
  blurb: string;
  items: readonly string[];
  cta: string;
  featured: boolean;
}

export const plans: readonly Plan[] = [
  {
    id: 'gratis',
    name: 'Gratis',
    priceUsd: 0,
    blurb: 'Para abrir la cuenta y probar el panel.',
    items: ['Registro sin tarjeta', 'Ventas, inventario y facturas del producto actual', 'Un negocio'],
    cta: 'Empezar gratis',
    featured: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsd: 16,
    blurb: 'Referencia para un negocio que ya vende todos los días.',
    items: ['Todo lo del panel actual', 'Reportes', 'Soporte por el canal de contacto'],
    cta: 'Pedir este plan',
    featured: true,
  },
  {
    id: 'business',
    name: 'Business',
    priceUsd: 39,
    blurb: 'Referencia para quien opera con más de un punto.',
    items: ['Todo lo de Pro', 'Acompañamiento para la puesta en marcha', 'Prioridad de respuesta'],
    cta: 'Hablar con nosotros',
    featured: false,
  },
];

export const pricingFaqs = [
  {
    question: '¿Estos precios ya están vigentes?',
    answer:
      'No. Son una referencia mientras Logic Code Spot confirma la oferta. El registro que existe hoy no cobra ni pide tarjeta en el formulario.',
  },
  {
    question: '¿Facilito ya envía comprobantes electrónicos a la DGII?',
    answer:
      'No. Hoy puedes emitir facturas en el panel y configurar secuencias de comprobantes. El envío electrónico e-CF está marcado como próximamente y el servicio fiscal del producto sigue en modo de prueba, apagado.',
  },
  {
    question: '¿Necesito tarjeta para crear la cuenta?',
    answer: 'No. El formulario de registro pide tus datos y los del negocio. No pide tarjeta.',
  },
  {
    question: '¿Puedo entrar con Google?',
    answer: 'El botón está en la pantalla de acceso, pero el inicio con Google todavía no está disponible.',
  },
  {
    question: '¿Dónde quedan mis datos?',
    answer:
      'En la cuenta de tu negocio dentro de Facilito. El RNC y la cédula se guardan cifrados. La sesión de acceso usa una cookie httpOnly.',
  },
  {
    question: '¿Hay contrato anual?',
    answer: 'No hay una oferta anual publicada. Cuando exista, se verá en esta página.',
  },
] as const;
