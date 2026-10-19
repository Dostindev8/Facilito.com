import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Boxes,
  Building2,
  Calculator,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  GitBranch,
  House,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  ChartColumn,
  Contact,
  Landmark,
  CalendarDays,
  BookOpen,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Existing working route — always shown when role allows. */
  ready: boolean;
  /** Preview / Próximamente target date (ISO date). */
  soonDate?: string;
  /** Optional match for active state (prefix). */
  match?: string;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

/** Domain-grouped nav. Existing hrefs preserved; new modules use /modulos/* until built. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'principal',
    label: 'Principal',
    items: [
      { href: '/inicio', label: 'Inicio', icon: House, ready: true },
      { href: '/clientes', label: 'Clientes', icon: Users, ready: true },
      { href: '/inventario', label: 'Inventario', icon: Package, ready: true },
      { href: '/modulos/crm', label: 'CRM', icon: Contact, ready: false, soonDate: '2026-12-15' },
      { href: '/modulos/automatizacion', label: 'Automatización', icon: Bot, ready: false, soonDate: '2026-12-15' },
    ],
  },
  {
    id: 'ventas',
    label: 'Ventas',
    items: [
      { href: '/ventas', label: 'Punto de venta', icon: ShoppingCart, ready: true },
      { href: '/facturacion', label: 'Facturación', icon: FileText, ready: true },
      { href: '/modulos/cotizaciones', label: 'Cotizaciones', icon: ClipboardList, ready: false, soonDate: '2026-11-30' },
    ],
  },
  {
    id: 'compras',
    label: 'Compras',
    items: [
      { href: '/proveedores', label: 'Proveedores', icon: Truck, ready: true },
      { href: '/modulos/ordenes-compra', label: 'Órdenes de compra', icon: ShoppingBag, ready: false, soonDate: '2026-11-30' },
    ],
  },
  {
    id: 'caja',
    label: 'Caja y finanzas',
    items: [
      { href: '/modulos/cuadre-caja', label: 'Cuadre de caja', icon: Wallet, ready: false, soonDate: '2026-11-15' },
      { href: '/modulos/gastos', label: 'Gastos', icon: Receipt, ready: false, soonDate: '2026-11-30' },
      { href: '/modulos/contabilidad', label: 'Contabilidad', icon: Calculator, ready: false, soonDate: '2027-01-31' },
    ],
  },
  {
    id: 'rrhh',
    label: 'RRHH',
    items: [
      { href: '/modulos/empleados', label: 'Empleados', icon: UserCog, ready: false, soonDate: '2026-12-31' },
      { href: '/modulos/nomina', label: 'Nómina', icon: Landmark, ready: false, soonDate: '2026-12-31' },
      { href: '/modulos/vacaciones', label: 'Vacaciones', icon: CalendarDays, ready: false, soonDate: '2027-01-31' },
    ],
  },
  {
    id: 'fiscal',
    label: 'Fiscal (DGII)',
    items: [
      { href: '/configuracion?tab=comprobantes', label: 'Comprobantes NCF', icon: FileSpreadsheet, ready: true },
      { href: '/reportes', label: 'Reportes 606/607', icon: ChartColumn, ready: true },
    ],
  },
  {
    id: 'reportes',
    label: 'Reportes',
    items: [{ href: '/reportes', label: 'Centro de reportes', icon: ChartColumn, ready: true }],
  },
  {
    id: 'admin',
    label: 'Administración',
    items: [
      { href: '/modulos/sucursales', label: 'Sucursales', icon: Store, ready: false, soonDate: '2026-11-30' },
      { href: '/modulos/usuarios', label: 'Usuarios y roles', icon: Building2, ready: false, soonDate: '2026-11-30' },
      { href: '/configuracion', label: 'Configuración', icon: Settings, ready: true },
      { href: '/suscripcion', label: 'Planes', icon: Warehouse, ready: true },
      { href: '/modulos/guia', label: 'Guía de inicio', icon: BookOpen, ready: false, soonDate: '2026-11-15' },
      { href: '/modulos/almacenes', label: 'Almacenes', icon: Boxes, ready: false, soonDate: '2026-11-30' },
      { href: '/modulos/flujos', label: 'Flujos', icon: GitBranch, ready: false, soonDate: '2026-12-15' },
    ],
  },
];

export const SOON_MODULES: Record<
  string,
  { title: string; detail: string; date: string; relatedHref?: string; relatedLabel?: string }
> = {
  crm: {
    title: 'CRM',
    detail: 'Embudo, seguimientos e historial 360° del cliente — mismo diseño Facilito, sin botones rotos.',
    date: '2026-12-15',
    relatedHref: '/clientes',
    relatedLabel: 'Ir a Clientes',
  },
  automatizacion: {
    title: 'Automatización',
    detail: 'Flujos listos: cobros, stock bajo → orden de compra, recordatorios. Modo prueba y pausa global.',
    date: '2026-12-15',
  },
  cotizaciones: {
    title: 'Cotizaciones',
    detail: 'Plantillas, vigencia, WhatsApp/correo y conversión a factura sin reescribir datos.',
    date: '2026-11-30',
    relatedHref: '/facturacion/nueva',
    relatedLabel: 'Emitir factura',
  },
  'ordenes-compra': {
    title: 'Órdenes de compra',
    detail: 'Desde alertas de stock, recepción parcial y entrada a kardex.',
    date: '2026-11-30',
    relatedHref: '/proveedores',
    relatedLabel: 'Ver proveedores',
  },
  'cuadre-caja': {
    title: 'Cuadre de caja',
    detail: 'Apertura por denominación, conteo ciego, corte Z y arqueos — prioridad del dueño.',
    date: '2026-11-15',
    relatedHref: '/ventas',
    relatedLabel: 'Ir al POS',
  },
  gastos: {
    title: 'Gastos',
    detail: 'Categorías, adjuntos y datos listos para el 606.',
    date: '2026-11-30',
  },
  contabilidad: {
    title: 'Contabilidad simplificada',
    detail: 'Asientos automáticos y estados gerenciales. No sustituye al contador.',
    date: '2027-01-31',
  },
  empleados: {
    title: 'Empleados',
    detail: 'Mini inventario de personal: documentos, seguro (metadatos) y alertas de vencimiento.',
    date: '2026-12-31',
  },
  nomina: {
    title: 'Nómina',
    detail: 'Parámetros TSS/ISR versionados, volantes y doble aprobación.',
    date: '2026-12-31',
  },
  vacaciones: {
    title: 'Vacaciones y licencias',
    detail: 'Saldos, aprobaciones y calendario del equipo.',
    date: '2027-01-31',
  },
  sucursales: {
    title: 'Sucursales',
    detail: 'Multi-sucursal con almacenes y cajas por local.',
    date: '2026-11-30',
  },
  usuarios: {
    title: 'Usuarios y roles',
    detail: 'Matriz de permisos y límites por plan.',
    date: '2026-11-30',
    relatedHref: '/configuracion?tab=seguridad',
    relatedLabel: 'Seguridad de cuenta',
  },
  guia: {
    title: 'Guía de inicio',
    detail: 'Checklist adaptativo por rubro hasta dejar el negocio operativo.',
    date: '2026-11-15',
    relatedHref: '/inicio',
    relatedLabel: 'Volver al inicio',
  },
  almacenes: {
    title: 'Almacenes',
    detail: 'Stock por almacén y transferencias.',
    date: '2026-11-30',
    relatedHref: '/inventario',
    relatedLabel: 'Ir a Inventario',
  },
  flujos: {
    title: 'Flujos',
    detail: 'Automatizaciones avanzadas por rubro.',
    date: '2026-12-15',
  },
};
