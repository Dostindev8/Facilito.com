export interface FeatureBlock {
  id: string;
  title: string;
  problem: string;
  solution: string;
  soon: boolean;
}

/** Only modules that exist in the app navigation and screens today. */
export const features: readonly FeatureBlock[] = [
  {
    id: 'ventas',
    title: 'Ventas',
    problem: 'El cuaderno y la caja no conversan, y al final del día no sabes cuánto entró.',
    solution: 'Registra la venta en el panel, con método de pago, y el stock se mueve con ella.',
    soon: false,
  },
  {
    id: 'inventario',
    title: 'Inventario',
    problem: 'Contar a mano o en un Excel suelto se desactualiza el mismo día.',
    solution: 'Productos, ajustes, kardex e importación desde CSV para no cargar todo uno por uno.',
    soon: false,
  },
  {
    id: 'facturacion',
    title: 'Facturación',
    problem: 'Cobrar y dejar el comprobante para después termina en desorden.',
    solution:
      'Emites la factura, ves su estado, la anulas sin perder el número y puedes abrir el PDF. Las secuencias de comprobantes se configuran en el panel. El envío electrónico a la DGII no está activo.',
    soon: false,
  },
  {
    id: 'clientes',
    title: 'Clientes',
    problem: 'Los datos del cliente viven en el teléfono de quien atendió.',
    solution: 'Una ficha por cliente, ligada a sus facturas, con el documento cifrado cuando lo registras.',
    soon: false,
  },
  {
    id: 'proveedores',
    title: 'Proveedores',
    problem: 'Las compras y los suplidores no tienen un lugar fijo.',
    solution: 'Llevas proveedores en el mismo panel, aparte de los clientes.',
    soon: false,
  },
  {
    id: 'reportes',
    title: 'Reportes',
    problem: 'Armar el resumen del mes come el domingo.',
    solution: 'Consultas de ventas y operación desde el panel, sin exportar a ciegas a otra hoja.',
    soon: false,
  },
];

export const comingSoon = ['Facturación electrónica e-CF ante la DGII', 'Conexión con Instagram'] as const;
