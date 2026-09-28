export type EstadoFactura = 'pendiente' | 'pagada' | 'anulada' | 'vencida';
export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'credito';

export interface InvoiceHeader {
  id: string;
  numero: number;
  numeroLabel: string;
  ncf: string | null;
  ncfTipo: string | null;
  clienteId: string | null;
  clienteNombre: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  itbisModo: 'linea' | 'global';
  subtotal: string;
  descuentoTotal: string;
  itbisTotal: string;
  total: string;
  estado: EstadoFactura;
  metodoPago: MetodoPago;
  notas: string | null;
  motivoAnulacion: string | null;
  anuladaAt: string | null;
  pagadaAt: string | null;
  lineasCount: number;
  unidades: string;
}

export interface InvoiceLine {
  linea: number;
  productoId: string;
  sku: string | null;
  descripcion: string;
  cantidad: string;
  unidad: string | null;
  precioUnitario: string;
  descuento: string;
  itbisTasa: string;
  subtotal: string;
  itbis: string;
  total: string;
}

export interface InvoiceDetail extends InvoiceHeader {
  lineas: InvoiceLine[];
  duplicate?: boolean;
}

export interface BusinessSettings {
  id: string;
  razonSocial: string;
  nombreComercial: string;
  rnc: string | null;
  direccion: string | null;
  ubicacion: string;
  telefono: string | null;
  email: string | null;
  estado: string;
  itbisModo: 'linea' | 'global';
  itbisTasa: string;
  ncfTipoDefault: string | null;
  sujetoDgii: boolean;
  permiteStockNegativo: boolean;
  verticales: string[];
  tipoNegocio: string;
  instagram: {
    handle: string;
    url: string;
    connected: boolean;
    lastSyncedAt: string | null;
  } | null;
}

export interface NcfSequence {
  tipo: string;
  descripcion: string;
  siguiente: number;
  hasta: number;
  disponibles: number;
  vence: string | null;
  activo: boolean;
}

export interface NcfConfig {
  tipos: Record<string, string>;
  secuencias: NcfSequence[];
}

export const DISCOUNT_CAP_PCT: Record<string, number> = {
  owner: 100,
  manager: 50,
  cashier: 10,
  warehouse: 0,
  accountant: 0,
  viewer: 0,
};
