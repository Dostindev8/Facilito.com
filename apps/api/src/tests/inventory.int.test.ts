import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addStaff, api, bootApp, createProduct, multipartBody, register, shutdown, type Session } from './helpers.js';

let app: FastifyInstance;
let owner: Session;
let other: Session;

beforeAll(async () => {
  app = await bootApp();
  owner = await register(app);
  other = await register(app);
});
afterAll(async () => {
  await shutdown(app);
});

describe('productos — CRUD y reglas', () => {
  it('crea con SKU automático, margen calculado y stock inicial vía kardex', async () => {
    const p = await createProduct(app, owner, { categoria: 'Bebidas', nombre: 'Refresco 2L', costo: '60', precioVenta: '100', stockInicial: '24' });
    expect(p.sku).toMatch(/^BEB-\d{5}$/);
    const full = (await api(app, owner).get(`/v1/products/${p.id}`)).json();
    expect(full).toMatchObject({ margen: '40.00', stockActual: '24', stockEstado: 'ok', estado: 'activo', unidad: 'lb' });
    const k = (await api(app, owner).get(`/v1/products/${p.id}/kardex`)).json();
    expect(k.items).toHaveLength(1);
    expect(k.items[0]).toMatchObject({ motivo: 'inicial', entrada: '24', saldo: '24' });
  });

  it('SKU manual se normaliza y no se puede duplicar', async () => {
    await createProduct(app, owner, { sku: 'abc-001' });
    const dup = await api(app, owner).post('/v1/products', { nombre: 'Otro', costo: '1', precioVenta: '2', sku: 'ABC-001' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('duplicate_sku');
  });

  it('el mismo SKU sí se permite en OTRO negocio (aislamiento)', async () => {
    const res = await api(app, other).post('/v1/products', { nombre: 'Otro', costo: '1', precioVenta: '2', sku: 'ABC-001' });
    expect(res.statusCode).toBe(201);
  });

  it('precio menor al costo exige confirmación explícita', async () => {
    const body = { nombre: 'Oferta', costo: '50', precioVenta: '40' };
    const blocked = await api(app, owner).post('/v1/products', body);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('price_below_cost');
    const ok = await api(app, owner).post('/v1/products', { ...body, confirmarPrecioBajoCosto: true });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().margen).toBe('-25.00');
  });

  it('validación estricta: negativos, texto vacío, stock máx < mín, campos desconocidos', async () => {
    const cases = [
      { nombre: '', costo: '1', precioVenta: '2' },
      { nombre: 'X', costo: '-1', precioVenta: '2' },
      { nombre: 'X', costo: '1', precioVenta: 'abc' },
      { nombre: 'X', costo: '1', precioVenta: '2', stockInicial: '-5' },
      { nombre: 'X', costo: '1', precioVenta: '2', unidad: 'tonelada' },
      { nombre: 'X', costo: '1', precioVenta: '2', stockActual: '999' },
      { nombre: 'X', costo: '1', precioVenta: '2', tenantId: other.tenantId },
    ];
    for (const c of cases) {
      const r = await api(app, owner).post('/v1/products', c);
      expect(r.statusCode, JSON.stringify(c)).toBe(400);
    }
    const bounds = await api(app, owner).post('/v1/products', { nombre: 'X', costo: '1', precioVenta: '2', stockMin: '10', stockMax: '5' });
    expect(bounds.statusCode).toBe(400);
  });

  it('texto con HTML se guarda como texto plano (sin ejecutar) y sin caracteres de control', async () => {
    const p = await createProduct(app, owner, { nombre: '<img src=x onerror=alert(1)>\u0007 Jabón' });
    const r = (await api(app, owner).get(`/v1/products/${p.id}`)).json();
    expect(r.nombre).toBe('<img src=x onerror=alert(1)> Jabón');
  });

  it('actualiza parcialmente y registra en bitácora', async () => {
    const p = await createProduct(app, owner);
    const res = await api(app, owner).patch(`/v1/products/${p.id}`, { precioVenta: '50.00', estado: 'inactivo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ precioVenta: '50.00', estado: 'inactivo', margen: '36.00' });
    const audit = (await api(app, owner).get('/v1/audit')).json() as Array<{ entity: string; action: string; entity_id: string }>;
    expect(audit.some((a) => a.entity === 'producto' && a.action === 'update' && a.entity_id === p.id)).toBe(true);
  });

  it('el stock NO se puede editar directamente por PATCH', async () => {
    const p = await createProduct(app, owner);
    const res = await api(app, owner).patch(`/v1/products/${p.id}`, { stockActual: '500' });
    expect(res.statusCode).toBe(400);
  });
});

describe('ajustes de inventario', () => {
  it('entrada, salida y conteo físico con motivo obligatorio', async () => {
    const p = await createProduct(app, owner, { stockInicial: '10' });
    const inn = await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'entrada', cantidad: '5', motivo: 'compra' });
    expect(inn.json().stockActual).toBe('15');
    const out = await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'salida', cantidad: '2', motivo: 'merma', nota: 'Se dañaron' });
    expect(out.json().stockActual).toBe('13');
    const count = await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'fijar', cantidad: '11', motivo: 'conteo_fisico' });
    expect(count.json().stockActual).toBe('11');
    const k = (await api(app, owner).get(`/v1/products/${p.id}/kardex`)).json();
    expect(k.items.map((i: { motivo: string }) => i.motivo)).toEqual(['conteo_fisico', 'merma', 'compra', 'inicial']);
    expect(k.items[0]).toMatchObject({ salida: '2', saldo: '11' });
    expect(k.items[1].nota).toBe('Se dañaron');
  });

  it('nunca deja el stock negativo', async () => {
    const p = await createProduct(app, owner, { stockInicial: '3' });
    const res = await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'salida', cantidad: '4', motivo: 'merma' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('stock');
    expect((await api(app, owner).get(`/v1/products/${p.id}`)).json().stockActual).toBe('3');
    const neg = await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'fijar', cantidad: '-1', motivo: 'conteo_fisico' });
    expect(neg.statusCode).toBe(400);
  });

  it('motivo inválido o ausente → 400; cantidad cero → 400', async () => {
    const p = await createProduct(app, owner);
    expect((await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'salida', cantidad: '1' })).statusCode).toBe(400);
    expect((await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'salida', cantidad: '1', motivo: 'robo' })).statusCode).toBe(400);
    expect((await api(app, owner).post(`/v1/products/${p.id}/adjust`, { tipo: 'entrada', cantidad: '0', motivo: 'compra' })).statusCode).toBe(400);
  });

  it('ajuste idempotente por clientUuid (reintento offline)', async () => {
    const p = await createProduct(app, owner, { stockInicial: '10' });
    const body = { tipo: 'salida', cantidad: '1', motivo: 'merma', clientUuid: '0190f0f0-0000-7000-8000-000000000001' };
    const a = await api(app, owner).post(`/v1/products/${p.id}/adjust`, body);
    const b = await api(app, owner).post(`/v1/products/${p.id}/adjust`, body);
    expect(a.json().stockActual).toBe('9');
    expect(b.json()).toMatchObject({ duplicate: true, stockActual: '9' });
  });
});

describe('listado, filtros y alertas', () => {
  let s: Session;
  beforeAll(async () => {
    s = await register(app);
    await createProduct(app, s, { nombre: 'Leche Rica 1L', categoria: 'Lácteos', stockInicial: '0', stockMin: '5' });
    await createProduct(app, s, { nombre: 'Queso Blanco', categoria: 'Lácteos', stockInicial: '2', stockMin: '5' });
    await createProduct(app, s, { nombre: 'Pan Sobao', categoria: 'Panadería', stockInicial: '50', stockMin: '5', codigoBarras: '7460000000011' });
    const inactive = await createProduct(app, s, { nombre: 'Galleta vieja', categoria: 'Panadería', stockInicial: '9' });
    await api(app, s).patch(`/v1/products/${inactive.id}`, { estado: 'descontinuado' });
  });

  it('filtra por categoría, agotado, bajo stock y estado', async () => {
    const byCat = (await api(app, s).get('/v1/products?categoria=L%C3%A1cteos')).json();
    expect(byCat.total).toBe(2);
    expect((await api(app, s).get('/v1/products?stock=agotado')).json().items.map((p: { nombre: string }) => p.nombre)).toEqual(['Leche Rica 1L']);
    expect((await api(app, s).get('/v1/products?stock=bajo')).json().items.map((p: { nombre: string }) => p.nombre)).toEqual(['Queso Blanco']);
    expect((await api(app, s).get('/v1/products?estado=descontinuado')).json().total).toBe(1);
  });

  it('búsqueda por nombre, SKU o código de barras; comodines tratados literalmente', async () => {
    expect((await api(app, s).get('/v1/products?q=queso')).json().total).toBe(1);
    expect((await api(app, s).get('/v1/products?q=7460000000011')).json().items[0].nombre).toBe('Pan Sobao');
    expect((await api(app, s).get('/v1/products?q=%25')).json().total).toBe(0);
    expect((await api(app, s).get("/v1/products?q=' OR 1=1 --")).json().total).toBe(0);
  });

  it('paginación y orden', async () => {
    const page = (await api(app, s).get('/v1/products?pageSize=2&page=2&sort=nombre')).json();
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(4);
    expect((await api(app, s).get('/v1/products?pageSize=1000')).statusCode).toBe(400);
    expect((await api(app, s).get('/v1/products?sort=precio;drop')).statusCode).toBe(400);
  });

  it('alertas de bajo stock con datos reales (solo activos)', async () => {
    const low = (await api(app, s).get('/v1/products/low-stock')).json() as Array<{ nombre: string; stockEstado: string }>;
    expect(low.map((p) => p.nombre).sort()).toEqual(['Leche Rica 1L', 'Queso Blanco']);
    expect(low.find((p) => p.nombre === 'Leche Rica 1L')?.stockEstado).toBe('agotado');
  });

  it('categorías distintas', async () => {
    expect((await api(app, s).get('/v1/products/categories')).json()).toEqual(['Lácteos', 'Panadería']);
  });
});

describe('importación / exportación CSV', () => {
  it('importa filas válidas y reporta errores por fila', async () => {
    const s = await register(app);
    const csv = [
      'SKU;Nombre;Categoría;Costo;Precio venta;Stock inicial;Stock mínimo',
      ';Harina 5 lb;Granos;80;110;20;5',
      'HAR-2;Harina 10 lb;Granos;150;120;10;2',
      ';;Granos;10;20;1;1',
      ';Aceite;Aceites;abc;200;1;1',
      'HAR-9;"Azúcar ""Crema""";Granos;30;45;12;3',
      'HAR-9;Duplicado;Granos;30;45;12;3',
    ].join('\r\n');
    const mp = multipartBody('file', 'productos.csv', 'text/csv', Buffer.from('\uFEFF' + csv, 'utf8'));
    const res = await app.inject({ method: 'POST', url: '/v1/products/import', headers: { authorization: `Bearer ${s.token}`, ...mp.headers }, payload: mp.body });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.total).toBe(6);
    expect(r.creados).toBe(2);
    const byRow = Object.fromEntries((r.errores as Array<{ fila: number; campo: string }>).map((e) => [e.fila, e.campo]));
    expect(byRow[3]).toBe('precio_venta');
    expect(byRow[4]).toBe('nombre');
    expect(byRow[5]).toBe('costo');
    expect(byRow[7]).toBe('sku');
    const list = (await api(app, s).get('/v1/products?q=Crema')).json();
    expect(list.items[0].nombre).toBe('Azúcar "Crema"');
  });

  it('rechaza archivos sin columnas mínimas o con extensión no permitida', async () => {
    const s = await register(app);
    const bad = multipartBody('file', 'x.csv', 'text/csv', Buffer.from('foo,bar\n1,2'));
    const r1 = await app.inject({ method: 'POST', url: '/v1/products/import', headers: { authorization: `Bearer ${s.token}`, ...bad.headers }, payload: bad.body });
    expect(r1.statusCode).toBe(400);
    const exe = multipartBody('file', 'x.exe', 'application/octet-stream', Buffer.from('MZ'));
    const r2 = await app.inject({ method: 'POST', url: '/v1/products/import', headers: { authorization: `Bearer ${s.token}`, ...exe.headers }, payload: exe.body });
    expect(r2.statusCode).toBe(400);
  });

  it('la exportación neutraliza fórmulas (CSV injection)', async () => {
    const s = await register(app);
    await createProduct(app, s, { nombre: '=HYPERLINK("http://evil")' });
    const res = await api(app, s).get('/v1/exports/products.csv');
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('productos.csv');
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('imágenes de producto', () => {
  it('acepta PNG real, la re-codifica a WebP y la sirve solo al negocio dueño', async () => {
    const p = await createProduct(app, owner);
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#0E8A5F' } }).png().toBuffer();
    const mp = multipartBody('file', 'foto.png', 'image/png', png);
    const up = await app.inject({ method: 'POST', url: `/v1/products/${p.id}/image`, headers: { authorization: `Bearer ${owner.token}`, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(200);
    expect(up.json().imagenUrl).toMatch(/^\/api\/v1\/products\/.+\/image\?v=/);
    const img = await api(app, owner).get(`/v1/products/${p.id}/image`);
    expect(img.headers['content-type']).toBe('image/webp');
    expect((await api(app, other).get(`/v1/products/${p.id}/image`)).statusCode).toBe(404);
  });

  it('rechaza archivo disfrazado de imagen', async () => {
    const p = await createProduct(app, owner);
    const mp = multipartBody('file', 'foto.png', 'image/png', Buffer.from('<?php system($_GET["c"]); ?>'));
    const res = await app.inject({ method: 'POST', url: `/v1/products/${p.id}/image`, headers: { authorization: `Bearer ${owner.token}`, ...mp.headers }, payload: mp.body });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('image');
  });
});

describe('aislamiento multi-tenant y roles', () => {
  it('otro negocio no puede ver, editar, ajustar ni ver kardex', async () => {
    const p = await createProduct(app, owner);
    const o = api(app, other);
    expect((await o.get(`/v1/products/${p.id}`)).statusCode).toBe(404);
    expect((await o.patch(`/v1/products/${p.id}`, { precioVenta: '1' })).statusCode).toBe(404);
    expect((await o.post(`/v1/products/${p.id}/adjust`, { tipo: 'salida', cantidad: '1', motivo: 'merma' })).statusCode).toBe(404);
    expect((await o.get(`/v1/products/${p.id}/kardex`)).statusCode).toBe(404);
    const list = (await o.get('/v1/products?pageSize=100')).json();
    expect(list.items.some((x: { id: string }) => x.id === p.id)).toBe(false);
  });

  it('cajero puede leer pero no crear ni ajustar productos', async () => {
    const cashier = await addStaff(app, owner.tenantId, 'cashier');
    expect((await api(app, cashier).get('/v1/products')).statusCode).toBe(200);
    expect((await api(app, cashier).post('/v1/products', { nombre: 'X', costo: '1', precioVenta: '2' })).statusCode).toBe(403);
    const p = await createProduct(app, owner);
    expect((await api(app, cashier).post(`/v1/products/${p.id}/adjust`, { tipo: 'entrada', cantidad: '1', motivo: 'compra' })).statusCode).toBe(403);
  });

  it('almacén sí puede ajustar', async () => {
    const warehouse = await addStaff(app, owner.tenantId, 'warehouse');
    const p = await createProduct(app, owner);
    expect((await api(app, warehouse).post(`/v1/products/${p.id}/adjust`, { tipo: 'entrada', cantidad: '1', motivo: 'compra' })).statusCode).toBe(200);
  });

  it('identificador malformado → 400 (no 500)', async () => {
    expect((await api(app, owner).get('/v1/products/not-a-uuid')).statusCode).toBe(400);
  });
});
