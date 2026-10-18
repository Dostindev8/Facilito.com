/**
 * Web façade over the domain plan catalog (single source of truth).
 * Prefer this module in UI; never hardcode RD$ prices in components.
 */

export {
  PLANS,
  PLAN_CONDITIONS,
  TRUST_POINTS,
  TRUST_BADGES,
  getPlan,
  planIds,
  formatPlanPrice,
  type PlanCatalogEntry,
  type PlanId,
} from '@facilito/domain/plans';

import { PLANS, type PlanCatalogEntry, type PlanId } from '@facilito/domain/plans';

export interface PlanOptionView {
  id: string;
  nombre: string;
  descripcion: string;
  precioMensualCentavos: number;
  moneda: string;
  maxUsuarios: number;
  maxProductos: number | null;
  copilot: boolean;
  soportePrioritario?: boolean;
  destacado?: boolean;
  beneficios?: readonly string[];
}

/** Catalog shaped like the public API list — used as fallback when billing.plan is unavailable. */
export function catalogAsApiItems(): PlanOptionView[] {
  return PLANS.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precioMensualCentavos: p.precioMensualCentavos,
    moneda: p.moneda,
    maxUsuarios: p.maxUsuarios,
    maxProductos: p.maxProductos,
    copilot: p.copilot,
    soportePrioritario: p.soportePrioritario,
    destacado: p.destacado,
    beneficios: p.beneficios,
  }));
}

export function enrichPlan(api: PlanOptionView): PlanCatalogEntry | PlanOptionView {
  const cat = PLANS.find((p) => p.id === api.id);
  if (!cat) return api;
  return {
    ...cat,
    precioMensualCentavos: api.precioMensualCentavos,
    moneda: (api.moneda as 'DOP') || cat.moneda,
    maxUsuarios: api.maxUsuarios,
    maxProductos: api.maxProductos,
    copilot: api.copilot,
  };
}

export function isPlanId(id: string | null | undefined): id is PlanId {
  return Boolean(id && PLANS.some((p) => p.id === id));
}
