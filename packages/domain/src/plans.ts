/**
 * Single source of truth for Facilito subscription plans (monthly, DOP cents).
 * Web UI, API seed, emails and admin all read from here — never hardcode prices elsewhere.
 */

export type PlanId = 'inicial' | 'profesional' | 'negocio';

export interface PlanCatalogEntry {
  id: PlanId;
  nombre: string;
  descripcion: string;
  /** Monthly price in centavos (RD$). */
  precioMensualCentavos: number;
  moneda: 'DOP';
  maxUsuarios: number;
  /** null = unlimited */
  maxProductos: number | null;
  copilot: boolean;
  soportePrioritario: boolean;
  destacado: boolean;
  orden: number;
  beneficios: readonly string[];
}

export const PLAN_CONDITIONS = [
  'Pago por transferencia bancaria',
  'Sin tarjeta y sin contrato',
  'La cuenta se crea solo después de verificar el pago',
  'Al aprobar el pago te enviamos un enlace para crear tu contraseña',
] as const;

/** Real trust points only — never invent certifications. Dostin may append real badges later. */
export const TRUST_POINTS = [
  'Sin tarjeta',
  'Sin contrato',
  'Tu cuenta se crea solo tras verificar el pago',
  'Tus datos se tratan según nuestra Política de Privacidad',
] as const;

/** Configurable badges — keep empty until real seals exist. */
export const TRUST_BADGES: readonly { id: string; label: string; href?: string }[] = [];

export const PLANS: readonly PlanCatalogEntry[] = [
  {
    id: 'inicial',
    nombre: 'Inicial',
    descripcion: 'Ventas, facturación, inventario y reportes para un negocio que empieza.',
    precioMensualCentavos: 69_000,
    moneda: 'DOP',
    maxUsuarios: 2,
    maxProductos: 500,
    copilot: false,
    soportePrioritario: false,
    destacado: false,
    orden: 1,
    beneficios: ['Ventas y facturación', 'Inventario y reportes', 'Hasta 2 usuarios', 'Hasta 500 productos'],
  },
  {
    id: 'profesional',
    nombre: 'Profesional',
    descripcion: 'Todo lo de Inicial con más usuarios, más productos y el asistente Copilot.',
    precioMensualCentavos: 149_000,
    moneda: 'DOP',
    maxUsuarios: 5,
    maxProductos: 5_000,
    copilot: true,
    soportePrioritario: false,
    destacado: true,
    orden: 2,
    beneficios: ['Todo lo de Inicial', 'Hasta 5 usuarios', 'Hasta 5,000 productos', 'Asistente Copilot'],
  },
  {
    id: 'negocio',
    nombre: 'Negocio',
    descripcion: 'Para negocios con varios empleados: productos ilimitados y prioridad en soporte.',
    precioMensualCentavos: 249_000,
    moneda: 'DOP',
    maxUsuarios: 15,
    maxProductos: null,
    copilot: true,
    soportePrioritario: true,
    destacado: false,
    orden: 3,
    beneficios: ['Todo lo de Profesional', 'Hasta 15 usuarios', 'Productos ilimitados', 'Prioridad en soporte'],
  },
] as const;

export function getPlan(id: string): PlanCatalogEntry | undefined {
  return PLANS.find((p) => p.id === id);
}

export function planIds(): PlanId[] {
  return PLANS.map((p) => p.id);
}

/** Rows for seed / INSERT (snake_case DB columns). */
export function plansForDbSeed() {
  return PLANS.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio_mensual_centavos: p.precioMensualCentavos,
    max_usuarios: p.maxUsuarios,
    max_productos: p.maxProductos,
    copilot: p.copilot,
    orden: p.orden,
  }));
}

export function formatPlanPrice(centavos: number, moneda: string = 'DOP'): string {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(centavos / 100);
}
