'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Boxes, CircleCheck, Download, History, Package, PackageX, Pencil, Plus, Search, SlidersHorizontal, TriangleAlert, Upload } from 'lucide-react';
import { api, apiBlob, downloadBlob, errorMessage } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { money, qty } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/hooks';
import { AuthImage } from '@/components/ui/auth-image';
import { Badge, EmptyState, ErrorState, Pagination, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { notifyDataChanged } from '@/components/shell/app-shell';
import { ProductFormModal } from '@/components/inventory/product-form';
import { AdjustModal } from '@/components/inventory/adjust-modal';
import { KardexModal } from '@/components/inventory/kardex-modal';
import { ImportModal } from '@/components/inventory/import-modal';
import { ESTADO_PRODUCTO_LABEL, stockLabel, stockTone, type Page, type Product } from '@/components/inventory/types';

type StockFilter = '' | 'disponible' | 'bajo' | 'agotado';

interface Counts {
  total: number;
  disponible: number;
  bajo: number;
  agotado: number;
}

async function loadCounts(): Promise<Counts> {
  const q = (stock?: string) => api<Page<Product>>('/v1/products', { query: { pageSize: 1, stock, estado: 'activo' } }).then((r) => r.total);
  const [total, disponible, bajo, agotado] = await Promise.all([q(), q('disponible'), q('bajo'), q('agotado')]);
  return { total, disponible, bajo, agotado };
}

function InventoryView() {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canWrite = can(ROLES.inventoryWrite);

  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('');
  const [stock, setStock] = useState<StockFilter>((['disponible', 'bajo', 'agotado'].includes(params.get('stock') ?? '') ? params.get('stock') : '') as StockFilter);
  const [estado, setEstado] = useState('activo');
  const [sort, setSort] = useState('nombre');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q.trim(), 300);

  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [kardex, setKardex] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => setPage(1), [debouncedQ, categoria, stock, estado, sort]);

  const list = useAsync(
    () =>
      api<Page<Product>>('/v1/products', {
        query: { q: debouncedQ, categoria, stock, estado, sort, dir: sort === 'actualizado' ? 'desc' : 'asc', page, pageSize: 20 },
      }),
    [debouncedQ, categoria, stock, estado, sort, page],
  );
  const counts = useAsync(loadCounts, []);
  const cats = useAsync(() => api<string[]>('/v1/products/categories'), []);

  const clearParam = useCallback(
    (key: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.delete(key);
      router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (params.get('nuevo') === '1' && canWrite) {
      setEditing(null);
      setFormOpen(true);
      clearParam('nuevo');
    }
    const pid = params.get('producto');
    if (pid && /^[0-9a-f-]{36}$/i.test(pid)) {
      api<Product>(`/v1/products/${pid}`)
        .then((p) => setKardex(p))
        .catch((e) => toast.error('Producto no encontrado', errorMessage(e)))
        .finally(() => clearParam('producto'));
    }
  }, [params, canWrite, clearParam, toast]);

  const refresh = () => {
    list.reload();
    counts.reload();
    cats.reload();
    notifyDataChanged();
  };

  const exportCsv = async () => {
    try {
      downloadBlob(await apiBlob('/v1/exports/products.csv'), `productos-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast.error('No se pudo exportar', errorMessage(e));
    }
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const stats = [
    { key: '' as StockFilter, label: 'Productos activos', value: counts.data?.total, icon: Boxes, tone: 'tone-blue' },
    { key: 'disponible' as StockFilter, label: 'Disponibles', value: counts.data?.disponible, icon: CircleCheck, tone: 'tone-green' },
    { key: 'bajo' as StockFilter, label: 'Bajo stock', value: counts.data?.bajo, icon: TriangleAlert, tone: 'tone-orange' },
    { key: 'agotado' as StockFilter, label: 'Agotados', value: counts.data?.agotado, icon: PackageX, tone: 'tone-red' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inventario</h1>
          <p>Productos, existencias, ajustes y movimientos.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={exportCsv}>
            <Download size={18} /> Exportar
          </button>
          {canWrite && (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setImportOpen(true)}>
                <Upload size={18} /> Importar
              </button>
              <button type="button" className="btn btn-primary" onClick={openNew}>
                <Plus size={18} /> Nuevo producto
              </button>
            </>
          )}
        </div>
      </div>

      <div className="stat-row">
        {stats.map(({ key, label, value, icon: Icon, tone }) => (
          <button
            key={label}
            type="button"
            className="card stat"
            style={{ cursor: 'pointer', textAlign: 'left', border: stock === key ? '1px solid var(--green)' : undefined }}
            onClick={() => setStock(key)}
            aria-pressed={stock === key}
          >
            <span className={`kpi-icon ${tone}`} style={{ width: 44, height: 44 }}>
              <Icon size={20} aria-hidden />
            </span>
            <span>
              <strong>{value ?? '—'}</strong>
              <span>{label}</span>
            </span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <div className="search">
            <Search size={18} aria-hidden />
            <label htmlFor="inv-search" className="sr-only">
              Buscar productos
            </label>
            <input
              id="inv-search"
              type="search"
              className="input"
              placeholder="Buscar por nombre, SKU, categoría o código de barras"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
            />
          </div>
          <label className="sr-only" htmlFor="inv-cat">
            Categoría
          </label>
          <select id="inv-cat" className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {cats.data?.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="inv-estado">
            Estado
          </label>
          <select id="inv-estado" className="input" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="activo">Activos</option>
            <option value="inactivo">Inactivos</option>
            <option value="descontinuado">Descontinuados</option>
            <option value="todos">Todos los estados</option>
          </select>
          <label className="sr-only" htmlFor="inv-sort">
            Ordenar por
          </label>
          <select id="inv-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="nombre">Ordenar: nombre</option>
            <option value="sku">Ordenar: SKU</option>
            <option value="stock">Ordenar: stock</option>
            <option value="precio">Ordenar: precio</option>
            <option value="actualizado">Ordenar: recientes</option>
          </select>
        </div>

        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <div className="stack" style={{ gap: 10 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} h={52} />
            ))}
          </div>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Package size={26} />}
            title={debouncedQ || categoria || stock ? 'Sin resultados' : 'Aún no tienes productos'}
            detail={debouncedQ || categoria || stock ? 'Prueba con otros filtros.' : 'Agrega tu primer producto o importa tu catálogo desde un CSV.'}
            action={
              canWrite && !debouncedQ && !categoria && !stock ? (
                <button type="button" className="btn btn-primary" onClick={openNew}>
                  <Plus size={18} /> Nuevo producto
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap" aria-busy={list.loading}>
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th className="th-num">Costo</th>
                    <th className="th-num">Precio</th>
                    <th className="th-num">Margen</th>
                    <th className="th-num">Stock</th>
                    <th>Estado</th>
                    <th className="th-num">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.id}>
                      <td className="td-main" data-label="Producto">
                        <div className="cell-product">
                          <AuthImage src={p.imagenUrl} alt={p.nombre} />
                          <div style={{ minWidth: 0 }}>
                            <strong>{p.nombre}</strong>
                            <small>
                              {p.sku}
                              {p.proveedorNombre ? ` · ${p.proveedorNombre}` : ''}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td data-label="Categoría">{p.categoria}</td>
                      <td data-label="Costo" className="num">
                        {money(p.costo)}
                      </td>
                      <td data-label="Precio" className="num">
                        <strong>{money(p.precioVenta)}</strong>
                      </td>
                      <td data-label="Margen" className={`num ${p.margen !== null && Number(p.margen) < 0 ? 'text-red' : ''}`}>
                        {p.margen !== null ? `${Number(p.margen).toLocaleString('es-DO')}%` : '—'}
                      </td>
                      <td data-label="Stock" className="num">
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <strong>
                            {qty(p.stockActual)} <small className="muted">{p.unidad}</small>
                          </strong>
                          <Badge tone={stockTone(p.stockEstado)}>{stockLabel(p.stockEstado)}</Badge>
                        </div>
                      </td>
                      <td data-label="Estado">
                        <Badge tone={p.estado === 'activo' ? 'green' : 'gray'}>{ESTADO_PRODUCTO_LABEL[p.estado]}</Badge>
                      </td>
                      <td className="td-actions">
                        <div className="cell-actions">
                          <button type="button" className="icon-btn" title="Kardex" aria-label={`Kardex de ${p.nombre}`} onClick={() => setKardex(p)}>
                            <History size={18} />
                          </button>
                          {canWrite && (
                            <>
                              <button type="button" className="icon-btn" title="Ajustar stock" aria-label={`Ajustar stock de ${p.nombre}`} onClick={() => setAdjusting(p)}>
                                <SlidersHorizontal size={18} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title="Editar"
                                aria-label={`Editar ${p.nombre}`}
                                onClick={() => {
                                  setEditing(p);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil size={18} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </section>

      <ProductFormModal
        open={formOpen}
        product={editing}
        categories={cats.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refresh();
        }}
      />
      <AdjustModal
        product={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={() => {
          setAdjusting(null);
          refresh();
        }}
      />
      <KardexModal product={kardex} onClose={() => setKardex(null)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={refresh} />
    </>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<Skeleton h={300} />}>
      <InventoryView />
    </Suspense>
  );
}
