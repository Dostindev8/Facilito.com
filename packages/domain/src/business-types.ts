/**
 * Categorized business-type catalog for checkout / settings.
 * Flattened suggestions are derived in business-profile for resolve/filter.
 */

export type VerticalId = 'colmado' | 'ferreteria' | 'farmacia';

export interface BusinessTypeOption {
  slug: string;
  label: string;
  vertical?: VerticalId;
}

export interface BusinessTypeCategory {
  id: string;
  label: string;
  options: readonly BusinessTypeOption[];
}

export const OTHER_BUSINESS_TYPE_SLUG = 'otro';

export const BUSINESS_TYPE_CATEGORIES: readonly BusinessTypeCategory[] = [
  {
    id: 'comercio',
    label: 'Comercio',
    options: [
      { slug: 'colmado', label: 'Colmado', vertical: 'colmado' },
      { slug: 'supermercado', label: 'Supermercado', vertical: 'colmado' },
      { slug: 'minimarket', label: 'Minimarket', vertical: 'colmado' },
      { slug: 'tienda-ropa', label: 'Tienda de ropa' },
      { slug: 'zapateria', label: 'Zapatería' },
      { slug: 'ferreteria', label: 'Ferretería', vertical: 'ferreteria' },
      { slug: 'farmacia', label: 'Farmacia', vertical: 'farmacia' },
      { slug: 'perfumeria', label: 'Perfumería' },
      { slug: 'tienda-celulares', label: 'Tienda de celulares' },
      { slug: 'tienda-electrodomesticos', label: 'Tienda de electrodomésticos' },
      { slug: 'jugueteria', label: 'Juguetería' },
      { slug: 'libreria-papeleria', label: 'Librería/papelería' },
      { slug: 'tienda-mascotas', label: 'Tienda de mascotas' },
      { slug: 'joyeria', label: 'Joyería' },
      { slug: 'vapes-tabaqueria', label: 'Vapes/tabaquería' },
      { slug: 'licoreria', label: 'Licorería' },
      { slug: 'distribuidora', label: 'Distribuidora' },
      { slug: 'mayorista', label: 'Mayorista' },
      { slug: 'repuestos-vehiculos', label: 'Repuestos de vehículos' },
    ],
  },
  {
    id: 'comida',
    label: 'Comida y bebida',
    options: [
      { slug: 'restaurante', label: 'Restaurante' },
      { slug: 'cafeteria', label: 'Cafetería' },
      { slug: 'panaderia-reposteria', label: 'Panadería/repostería' },
      { slug: 'food-truck', label: 'Food truck' },
      { slug: 'comida-rapida', label: 'Comida rápida' },
      { slug: 'carniceria', label: 'Carnicería' },
      { slug: 'pescaderia', label: 'Pescadería' },
      { slug: 'fruteria', label: 'Frutería' },
      { slug: 'heladeria', label: 'Heladería' },
      { slug: 'bar-discoteca', label: 'Bar/discoteca' },
      { slug: 'catering', label: 'Catering' },
    ],
  },
  {
    id: 'belleza-salud',
    label: 'Belleza y salud',
    options: [
      { slug: 'barberia', label: 'Barbería' },
      { slug: 'salon-belleza', label: 'Salón de belleza' },
      { slug: 'spa', label: 'Spa' },
      { slug: 'unas', label: 'Uñas' },
      { slug: 'gimnasio', label: 'Gimnasio' },
      { slug: 'consultorio', label: 'Consultorio' },
      { slug: 'clinica', label: 'Clínica' },
      { slug: 'laboratorio', label: 'Laboratorio' },
      { slug: 'optica', label: 'Óptica' },
      { slug: 'veterinaria', label: 'Veterinaria' },
    ],
  },
  {
    id: 'servicios',
    label: 'Servicios',
    options: [
      { slug: 'taller-mecanico', label: 'Taller mecánico' },
      { slug: 'car-wash', label: 'Car wash' },
      { slug: 'lavanderia', label: 'Lavandería' },
      { slug: 'imprenta', label: 'Imprenta' },
      { slug: 'agencia-viajes', label: 'Agencia de viajes' },
      { slug: 'inmobiliaria', label: 'Inmobiliaria' },
      { slug: 'estudio-fotografico', label: 'Estudio fotográfico' },
      { slug: 'servicios-limpieza', label: 'Servicios de limpieza' },
      { slug: 'seguridad', label: 'Seguridad' },
      { slug: 'transporte-logistica', label: 'Transporte/logística' },
      { slug: 'construccion', label: 'Construcción' },
      { slug: 'electricidad-plomeria', label: 'Electricidad/plomería' },
      { slug: 'consultoria', label: 'Consultoría' },
      { slug: 'contabilidad', label: 'Contabilidad' },
    ],
  },
  {
    id: 'educacion-otros',
    label: 'Educación y otros',
    options: [
      { slug: 'academia', label: 'Academia/centro educativo' },
      { slug: 'iglesia-ong', label: 'Iglesia/ONG' },
      { slug: 'hotel-hospedaje', label: 'Hotel/hospedaje' },
      { slug: 'alquiler-equipos', label: 'Alquiler de equipos' },
      { slug: 'agropecuario', label: 'Agropecuario' },
      { slug: 'artesania', label: 'Artesanía' },
      { slug: 'ecommerce', label: 'E-commerce/negocio online' },
      { slug: 'freelancer', label: 'Freelancer/profesional independiente' },
      { slug: OTHER_BUSINESS_TYPE_SLUG, label: 'Otro (escribir el mío)' },
    ],
  },
] as const;

export function allBusinessTypeOptions(): BusinessTypeOption[] {
  return BUSINESS_TYPE_CATEGORIES.flatMap((c) => [...c.options]);
}

export function findBusinessTypeBySlug(slug: string): BusinessTypeOption | undefined {
  return allBusinessTypeOptions().find((o) => o.slug === slug);
}

export function findBusinessTypeByLabel(label: string): BusinessTypeOption | undefined {
  const key = label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return allBusinessTypeOptions().find((o) => o.label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() === key);
}

export function filterBusinessTypeCategories(query: string): BusinessTypeCategory[] {
  const key = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!key) return [...BUSINESS_TYPE_CATEGORIES];
  return BUSINESS_TYPE_CATEGORIES.map((c) => ({
    ...c,
    options: c.options.filter(
      (o) =>
        o.label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(key) ||
        o.slug.includes(key) ||
        c.label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(key),
    ),
  })).filter((c) => c.options.length > 0);
}
