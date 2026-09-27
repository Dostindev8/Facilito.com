export interface Product {
  id: string;
  sku: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  unidad: string;
  costo: string;
  precioVenta: string;
  margen: string | null;
  stockActual: string;
  stockMin: string;
  stockMax: string | null;
  codigoBarras: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  estado: 'activo' | 'inactivo' | 'descontinuado';
  itbisTasa: string;
  permiteNegativo: boolean;
  imagenUrl: string | null;
  stockEstado: 'agotado' | 'bajo' | 'ok';
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const UNIDADES = ['unidad', 'lb', 'kg', 'g', 'litro', 'ml', 'galon', 'caja', 'paquete', 'docena', 'metro', 'par'] as const;

export const UNIDAD_LABEL: Record<string, string> = {
  unidad: 'Unidad',
  lb: 'Libra',
  kg: 'Kilogramo',
  g: 'Gramo',
  litro: 'Litro',
  ml: 'Mililitro',
  galon: 'Galón',
  caja: 'Caja',
  paquete: 'Paquete',
  docena: 'Docena',
  metro: 'Metro',
  par: 'Par',
};

// TODO: VERIFICAR EN VIVO — tasas de ITBIS vigentes.
export const ITBIS_OPCIONES = [
  { value: '0.18', label: '18% (general)' },
  { value: '0.16', label: '16% (reducida)' },
  { value: '0', label: 'Exento' },
];

export const ESTADO_PRODUCTO_LABEL: Record<string, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  descontinuado: 'Descontinuado',
};

export function stockTone(e: Product['stockEstado']): 'red' | 'orange' | 'green' {
  return e === 'agotado' ? 'red' : e === 'bajo' ? 'orange' : 'green';
}

export function stockLabel(e: Product['stockEstado']): string {
  return e === 'agotado' ? 'Agotado' : e === 'bajo' ? 'Bajo' : 'Disponible';
}

export function marginPreview(costo: string, precio: string): number | null {
  const c = Number(costo);
  const p = Number(precio);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return Math.round(((p - c) / p) * 10000) / 100;
}
