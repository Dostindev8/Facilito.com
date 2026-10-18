/**
 * Business-profile rules shared by the API (authoritative) and the web forms (instant feedback).
 * Pure functions with no dependencies so the browser bundle stays small.
 */

import { OTHER_BUSINESS_TYPE_SLUG, allBusinessTypeOptions, type VerticalId } from './business-types.js';

export type { VerticalId };

export const BUSINESS_TYPE_MIN = 2;
export const BUSINESS_TYPE_MAX = 60;

export type BusinessTypeSource = 'catalog' | 'custom';

export interface BusinessTypeSuggestion {
  label: string;
  /** Feature profile (lots, FEFO, attributes) enabled for this type. */
  vertical?: VerticalId;
}

export const DEFAULT_VERTICAL: VerticalId = 'colmado';

/** Flat catalog for combobox filter / resolve (excludes the "Otro" sentinel). */
export const BUSINESS_TYPE_SUGGESTIONS: readonly BusinessTypeSuggestion[] = allBusinessTypeOptions()
  .filter((o) => o.slug !== OTHER_BUSINESS_TYPE_SLUG)
  .map((o) => ({ label: o.label, ...(o.vertical ? { vertical: o.vertical } : {}) }));

const LEGACY_VERTICAL_LABEL: Record<VerticalId, string> = {
  colmado: 'Colmado',
  ferreteria: 'Ferretería',
  farmacia: 'Farmacia',
};

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const BUSINESS_TYPE_CHARS = /^[\p{L}\p{M}\p{N} &.-]+$/u;

/** Lowercase without diacritics, for accent-insensitive matching ("farmacia" finds "Farmacia"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function normalizeBusinessType(raw: string): string {
  return raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Returns a user-facing error, or null when the (normalized) value is acceptable. */
export function businessTypeError(raw: string): string | null {
  const v = normalizeBusinessType(raw);
  if (v.length < BUSINESS_TYPE_MIN) return 'Escribe el tipo de negocio (mínimo 2 caracteres)';
  if (v.length > BUSINESS_TYPE_MAX) return `Máximo ${BUSINESS_TYPE_MAX} caracteres`;
  if (/[<>]/.test(v)) return 'No se permiten etiquetas HTML';
  if (!BUSINESS_TYPE_CHARS.test(v)) return 'Usa solo letras, números, espacios, “&”, “-” o “.”';
  return null;
}

export function findBusinessType(raw: string): BusinessTypeSuggestion | undefined {
  const key = foldText(normalizeBusinessType(raw));
  return BUSINESS_TYPE_SUGGESTIONS.find((s) => foldText(s.label) === key);
}

export function filterBusinessTypes(query: string, limit = 24): BusinessTypeSuggestion[] {
  const key = foldText(normalizeBusinessType(query));
  const list = key ? BUSINESS_TYPE_SUGGESTIONS.filter((s) => foldText(s.label).includes(key)) : BUSINESS_TYPE_SUGGESTIONS;
  return list.slice(0, limit);
}

export interface ResolvedBusinessType {
  tipoNegocio: string;
  source: BusinessTypeSource;
  vertical: VerticalId;
}

/**
 * Catalog matches keep the catalog spelling and feature profile; anything else is stored exactly as typed
 * (normalized) with the default profile. `legacyVertical` supports clients that still send only `vertical`.
 */
export function resolveBusinessType(raw: string | undefined, legacyVertical?: string): ResolvedBusinessType {
  const legacy = legacyVertical && legacyVertical in LEGACY_VERTICAL_LABEL ? (legacyVertical as VerticalId) : undefined;
  if (raw === undefined || normalizeBusinessType(raw) === '') {
    const vertical = legacy ?? DEFAULT_VERTICAL;
    return { tipoNegocio: LEGACY_VERTICAL_LABEL[vertical], source: 'catalog', vertical };
  }
  const tipo = normalizeBusinessType(raw);
  const hit = findBusinessType(tipo);
  if (hit) return { tipoNegocio: hit.label, source: 'catalog', vertical: hit.vertical ?? legacy ?? DEFAULT_VERTICAL };
  return { tipoNegocio: tipo, source: 'custom', vertical: legacy ?? DEFAULT_VERTICAL };
}

/* ───────────── Instagram ───────────── */

const IG_HANDLE = /^[a-z0-9._]{1,30}$/;
const IG_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)\/?(?:[?#].*)?$/i;
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct', 'about', 'developer', 'legal']);

export type InstagramParse = { ok: true; handle: string | null } | { ok: false; error: string };

/**
 * Accepts `x`, `@x`, `instagram.com/x`, `https://www.instagram.com/x/` (with query/hash) and returns the
 * lowercase handle. Empty input is valid (the field is optional) and yields `handle: null`.
 */
export function parseInstagram(raw: string | null | undefined): InstagramParse {
  const v = (raw ?? '').trim();
  if (!v) return { ok: true, handle: null };
  const fromUrl = IG_URL.exec(v)?.[1];
  if (!fromUrl && /[/:]/.test(v)) return { ok: false, error: 'Pega un enlace de instagram.com o escribe solo el @usuario' };
  const handle = (fromUrl ?? v).replace(/^@/, '').toLowerCase();
  const valid =
    IG_HANDLE.test(handle) && !handle.startsWith('.') && !handle.endsWith('.') && !handle.includes('..') && !IG_RESERVED.has(handle);
  return valid ? { ok: true, handle } : { ok: false, error: 'Ese usuario de Instagram no parece válido' };
}

export function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}
