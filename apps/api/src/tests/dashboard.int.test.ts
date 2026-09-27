import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addStaff, api, bootApp, createProduct, register, shutdown, type Session } from './helpers.js';

let app: FastifyInstance;
let s: Session;

beforeAll(async () => {
  app = await bootApp();
  s = await register(app, { razonSocial: 'Colmado La Esquina' });
  const arroz = await createProduct(app, s, { nombre: 'Arroz', precioVenta: '50', costo: '30', stockInicial: '100', stockMin: '5' });
  const leche = await createProduct(app, s, { nombre: 'Leche', precioVenta: '80', costo: '60', stockInicial: '4', stockMin: '5' });
  const c = (await api(app, s).post('/v1/customers', { nombre: 'Pedro Martínez' })).json();
  for (const [pid, qty, cliente] of [
    [arroz.id, '2', c.id],
    [arroz.id, '1', null],
    [leche.id, '1', c.id],
  ] as const) {
    await api(app, s).post('/v1/invoices', { clientUuid: randomUUID(), metodoPago: 'efectivo', ncfTipo: null, clienteId: cliente, lineas: [{ productoId: pid, cantidad: qty }] });
  }
});
afterAll(async () => {
  await shutdown(app);
});

describe('dashboard con datos reales', () => {
  it('KPIs del día y comparación con ayer', async () => {
    const d = (await api(app, s).get('/v1/dashboard')).json();
    expect(d.kpis.ventas.valor).toBe('271.40');
    expect(d.kpis.productos.valor).toBe('4');
    expect(d.kpis.facturas.valor).toBe('3');
    expect(d.kpis.clientes.valor).toBe('2');
    expect(d.kpis.ventas.cambio).toBeNull();
    expect(d.negocio).toMatchObject({ nombre: 'Colmado La Esquina', estado: 'activo', ubicacion: 'Santo Domingo, R.D.' });
    expect(d.negocio.rnc).toMatch(/^\d-\d{2}-\d{5}-\d$/);
  });

  it('serie de 7/14/30 días con ceros rellenados', async () => {
    for (const dias of [7, 14, 30]) {
      const d = (await api(app, s).get(`/v1/dashboard?dias=${dias}`)).json();
      expect(d.serie).toHaveLength(dias);
      expect(d.serie.at(-1).total).toBe('271.40');
      expect(d.serie[0].total).toBe('0.00');
    }
    expect((await api(app, s).get('/v1/dashboard?dias=9')).statusCode).toBe(400);
  });

  it('ventas recientes, más vendidos y bajo stock', async () => {
    const d = (await api(app, s).get('/v1/dashboard')).json();
    expect(d.recientes).toHaveLength(3);
    expect(d.recientes[0]).toMatchObject({ numero: 'FAC-000003', cliente: 'Pedro Martínez', estado: 'pagada' });
    expect(d.masVendidos[0]).toMatchObject({ nombre: 'Arroz', unidades: '3' });
    expect(d.bajoStock.map((p: { nombre: string }) => p.nombre)).toEqual(['Leche']);
  });

  it('una fecha pasada sin ventas muestra ceros', async () => {
    const d = (await api(app, s).get('/v1/dashboard?fecha=2026-01-15')).json();
    expect(d.fecha).toBe('2026-01-15');
    expect(d.kpis.ventas.valor).toBe('0.00');
  });

  it('el RNC se enmascara para roles operativos', async () => {
    const cashier = await addStaff(app, s.tenantId, 'cashier');
    const d = (await api(app, cashier).get('/v1/dashboard')).json();
    expect(d.negocio.rnc).toMatch(/^•+\d{4}$/);
  });

  it('otro negocio ve su propio tablero vacío', async () => {
    const other = await register(app);
    const d = (await api(app, other).get('/v1/dashboard')).json();
    expect(d.kpis.facturas.valor).toBe('0');
    expect(d.recientes).toHaveLength(0);
  });
});

describe('notificaciones y búsqueda global', () => {
  it('notificaciones derivadas: bajo stock y ventas', async () => {
    const n = (await api(app, s).get('/v1/notifications')).json() as Array<{ tipo: string; detalle: string }>;
    expect(n.some((x) => x.tipo === 'stock' && x.detalle.includes('Leche'))).toBe(true);
    expect(n.filter((x) => x.tipo === 'venta')).toHaveLength(3);
  });

  it('búsqueda global en productos, clientes y facturas', async () => {
    const r = (await api(app, s).get('/v1/search?q=pedro')).json();
    expect(r.clientes[0].nombre).toBe('Pedro Martínez');
    expect(r.facturas.length).toBeGreaterThan(0);
    expect((await api(app, s).get('/v1/search?q=arr')).json().productos[0].nombre).toBe('Arroz');
    expect((await api(app, s).get('/v1/search?q=a')).statusCode).toBe(400);
  });

  it('búsqueda no cruza negocios', async () => {
    const other = await register(app);
    const r = (await api(app, other).get('/v1/search?q=pedro')).json();
    expect(r.clientes).toHaveLength(0);
    expect(r.facturas).toHaveLength(0);
  });
});

describe('configuración y proveedores', () => {
  it('lee y actualiza configuración; valida valores', async () => {
    const g = (await api(app, s).get('/v1/settings')).json();
    expect(g).toMatchObject({ itbisModo: 'linea', itbisTasa: '0.18', permiteStockNegativo: false });
    const u = await api(app, s).patch('/v1/settings', { nombreComercial: 'La Esquina', telefono: '809-555-1234', direccion: 'Calle 1, Ensanche Ozama' });
    expect(u.json()).toMatchObject({ nombreComercial: 'La Esquina', telefono: '809-555-1234' });
    expect((await api(app, s).patch('/v1/settings', { itbisTasa: '0.5' })).statusCode).toBe(400);
    expect((await api(app, s).patch('/v1/settings', { rnc: '000' })).statusCode).toBe(400);
  });

  it('proveedores: CRUD, RNC cifrado y enmascarado, vinculación a producto', async () => {
    const pr = await api(app, s).post('/v1/suppliers', { nombre: 'Distribuidora Caribe', documento: '101010101', email: 'ventas@caribe.do' });
    expect(pr.statusCode).toBe(201);
    expect(pr.json().documento).toBe('•••••0101');
    const detail = (await api(app, s).get(`/v1/suppliers/${pr.json().id}`)).json();
    expect(detail.documento).toBe('101010101');
    const p = await createProduct(app, s, { proveedorId: pr.json().id });
    const list = (await api(app, s).get(`/v1/products?proveedorId=${pr.json().id}`)).json();
    expect(list.items[0]).toMatchObject({ id: p.id, proveedorNombre: 'Distribuidora Caribe' });
    expect((await api(app, s).post('/v1/suppliers', { nombre: 'X', email: 'no-es-email' })).statusCode).toBe(400);
  });
});
