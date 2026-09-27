'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, TriangleAlert } from 'lucide-react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { AuthImage } from '@/components/ui/auth-image';
import { ConfirmDialog, Modal, SelectInput, Spinner, TextArea, TextInput, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ESTADO_PRODUCTO_LABEL, ITBIS_OPCIONES, UNIDADES, UNIDAD_LABEL, marginPreview, type Product } from './types';

interface Supplier {
  id: string;
  nombre: string;
}

const DECIMAL = /^\d{1,12}(\.\d{1,4})?$/;

function emptyForm() {
  return {
    sku: '',
    nombre: '',
    categoria: 'General',
    descripcion: '',
    unidad: 'unidad',
    costo: '',
    precioVenta: '',
    stockInicial: '0',
    stockMin: '0',
    stockMax: '',
    codigoBarras: '',
    proveedorId: '',
    estado: 'activo',
    itbisTasa: '0.18',
  };
}

type Form = ReturnType<typeof emptyForm>;

function fromProduct(p: Product): Form {
  return {
    sku: p.sku,
    nombre: p.nombre,
    categoria: p.categoria,
    descripcion: p.descripcion ?? '',
    unidad: p.unidad,
    costo: p.costo,
    precioVenta: p.precioVenta,
    stockInicial: '0',
    stockMin: p.stockMin,
    stockMax: p.stockMax ?? '',
    codigoBarras: p.codigoBarras ?? '',
    proveedorId: p.proveedorId ?? '',
    estado: p.estado,
    itbisTasa: p.itbisTasa === '0.18' || p.itbisTasa === '0.16' ? p.itbisTasa : p.itbisTasa === '0' ? '0' : '0.18',
  };
}

export function ProductFormModal({
  open,
  product,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: Product | null;
  categories: string[];
  onClose: () => void;
  onSaved: (p: Product) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [confirmLow, setConfirmLow] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = !!product;

  useEffect(() => {
    if (!open) return;
    setForm(product ? fromProduct(product) : emptyForm());
    setErrors({});
    setAlert(null);
    setImage(null);
    api<{ items: Supplier[] }>('/v1/suppliers', { query: { pageSize: 100 } })
      .then((r) => setSuppliers(r.items))
      .catch(() => setSuppliers([]));
  }, [open, product]);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const margin = marginPreview(form.costo || '0', form.precioVenta || '0');
  const belowCost = form.costo !== '' && form.precioVenta !== '' && Number(form.precioVenta) < Number(form.costo);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.nombre.trim()) e.nombre = 'El nombre es obligatorio';
    if (form.sku && !/^[A-Za-z0-9._-]{1,40}$/.test(form.sku.trim())) e.sku = 'Letras, números, punto o guion (máx. 40)';
    if (!form.categoria.trim()) e.categoria = 'Indica una categoría';
    for (const k of ['costo', 'precioVenta', 'stockMin'] as const) {
      if (!DECIMAL.test(form[k].trim() || 'x')) e[k] = 'Número válido (ej. 125.50)';
    }
    if (!editing && !DECIMAL.test(form.stockInicial.trim() || '0')) e.stockInicial = 'Número válido';
    if (form.stockMax.trim()) {
      if (!DECIMAL.test(form.stockMax.trim())) e.stockMax = 'Número válido';
      else if (Number(form.stockMax) < Number(form.stockMin || 0)) e.stockMax = 'Debe ser mayor o igual al mínimo';
    }
    if (form.codigoBarras.trim() && !/^[0-9A-Za-z-]{4,64}$/.test(form.codigoBarras.trim())) e.codigoBarras = 'Código de barras inválido';
    if (image && image.size > 2 * 1024 * 1024) e.image = 'La imagen supera 2 MB';
    return e;
  };

  const payload = (confirmar: boolean) => {
    const base = {
      nombre: form.nombre.trim(),
      categoria: form.categoria.trim(),
      descripcion: form.descripcion.trim() || null,
      unidad: form.unidad,
      costo: form.costo.trim(),
      precioVenta: form.precioVenta.trim(),
      stockMin: form.stockMin.trim() || '0',
      stockMax: form.stockMax.trim() || null,
      codigoBarras: form.codigoBarras.trim() || null,
      proveedorId: form.proveedorId || null,
      estado: form.estado,
      itbisTasa: form.itbisTasa,
      ...(confirmar ? { confirmarPrecioBajoCosto: true } : {}),
    };
    if (editing) return { ...base, ...(form.sku.trim() && form.sku.trim().toUpperCase() !== product!.sku ? { sku: form.sku.trim() } : {}) };
    return { ...base, sku: form.sku.trim() || null, stockInicial: form.stockInicial.trim() || '0' };
  };

  const save = async (confirmar = false) => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setAlert(null);
    try {
      const saved = editing
        ? await api<Product>(`/v1/products/${product!.id}`, { method: 'PATCH', body: payload(confirmar) })
        : await api<Product>('/v1/products', { method: 'POST', body: payload(confirmar) });
      let final = saved;
      if (image) {
        try {
          const fd = new FormData();
          fd.append('file', image, image.name);
          await api(`/v1/products/${saved.id}/image`, { method: 'POST', body: fd });
          final = await api<Product>(`/v1/products/${saved.id}`);
        } catch (err) {
          toast.error('Producto guardado, pero la imagen no se subió', errorMessage(err));
        }
      }
      setConfirmLow(false);
      toast.success(editing ? 'Producto actualizado' : 'Producto creado', `${final.nombre} · ${final.sku}`);
      onSaved(final);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'price_below_cost') {
        setConfirmLow(true);
      } else {
        setConfirmLow(false);
        const fe = fieldErrorMap(err);
        if (err instanceof ApiError && err.code === 'duplicate_sku') fe.sku = err.detail;
        if (err instanceof ApiError && err.code === 'duplicate_barcode') fe.codigoBarras = err.detail;
        setErrors(fe);
        setAlert(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        subtitle={editing ? `${product!.sku} · ${product!.nombre}` : 'Si dejas el SKU vacío lo generamos automáticamente.'}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="product-form" className="btn btn-primary" disabled={busy}>
              {busy && <Spinner size={16} />} {editing ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </>
        }
      >
        <form id="product-form" onSubmit={submit} noValidate className="stack">
          {alert && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{alert}</span>
            </div>
          )}
          <div className="form-grid">
            <TextInput label="Nombre" required value={form.nombre} onChange={(e) => set('nombre', e.target.value)} maxLength={200} error={errors.nombre} className="span-2" />
            <TextInput
              label="SKU"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value.toUpperCase())}
              maxLength={40}
              placeholder="Automático"
              error={errors.sku}
              hint={editing ? undefined : 'Déjalo vacío para generarlo'}
            />
            <TextInput label="Código de barras" value={form.codigoBarras} onChange={(e) => set('codigoBarras', e.target.value)} maxLength={64} inputMode="numeric" error={errors.codigoBarras} />
            <TextInput label="Categoría" required value={form.categoria} onChange={(e) => set('categoria', e.target.value)} maxLength={80} list="product-categories" error={errors.categoria} />
            <datalist id="product-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <SelectInput label="Unidad de medida" value={form.unidad} onChange={(e) => set('unidad', e.target.value)}>
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {UNIDAD_LABEL[u]}
                </option>
              ))}
            </SelectInput>
            <TextInput label="Costo (RD$)" required inputMode="decimal" value={form.costo} onChange={(e) => set('costo', e.target.value.replace(/[^\d.]/g, ''))} error={errors.costo} placeholder="0.00" />
            <TextInput
              label="Precio de venta (RD$)"
              required
              inputMode="decimal"
              value={form.precioVenta}
              onChange={(e) => set('precioVenta', e.target.value.replace(/[^\d.]/g, ''))}
              error={errors.precioVenta}
              placeholder="0.00"
              hint={margin !== null ? `Margen: ${margin.toLocaleString('es-DO')}% · Ganancia ${money(Number(form.precioVenta) - Number(form.costo || 0))}` : undefined}
            />
            {belowCost && (
              <div className="form-alert warn span-2" role="status">
                <TriangleAlert size={18} /> <span>El precio de venta es menor que el costo. Te pediremos confirmación al guardar.</span>
              </div>
            )}
            {!editing && (
              <TextInput label="Stock inicial" inputMode="decimal" value={form.stockInicial} onChange={(e) => set('stockInicial', e.target.value.replace(/[^\d.]/g, ''))} error={errors.stockInicial} />
            )}
            <TextInput label="Stock mínimo" inputMode="decimal" value={form.stockMin} onChange={(e) => set('stockMin', e.target.value.replace(/[^\d.]/g, ''))} error={errors.stockMin} hint="Te avisamos al llegar a este nivel" />
            <TextInput label="Stock máximo" inputMode="decimal" value={form.stockMax} onChange={(e) => set('stockMax', e.target.value.replace(/[^\d.]/g, ''))} error={errors.stockMax} placeholder="Opcional" />
            <SelectInput label="Proveedor" value={form.proveedorId} onChange={(e) => set('proveedorId', e.target.value)} error={errors.proveedorId}>
              <option value="">Sin proveedor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="ITBIS" value={form.itbisTasa} onChange={(e) => set('itbisTasa', e.target.value)}>
              {ITBIS_OPCIONES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Estado" value={form.estado} onChange={(e) => set('estado', e.target.value)}>
              {Object.entries(ESTADO_PRODUCTO_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectInput>
            <TextArea label="Descripción" value={form.descripcion} onChange={(e) => set('descripcion', e.target.value)} maxLength={1000} className="span-2" rows={3} />
            <div className="field span-2">
              <span className="field-label" style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink-2)' }}>
                Imagen
              </span>
              <div className="row wrap">
                {image ? (
                  <span className="thumb" style={{ width: 64, height: 64 }}>
                    <ImagePlus size={24} aria-hidden />
                  </span>
                ) : (
                  <AuthImage src={product?.imagenUrl ?? null} alt={product?.nombre ?? 'Producto'} size={64} />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  id="product-image"
                  onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                />
                <label htmlFor="product-image" className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                  <ImagePlus size={16} /> {image ? 'Cambiar imagen' : 'Subir imagen'}
                </label>
                {image && (
                  <span className="muted" style={{ fontSize: '0.85rem', overflowWrap: 'anywhere' }}>
                    {image.name}
                  </span>
                )}
              </div>
              <span className={errors.image ? 'field-error' : 'field-hint'}>{errors.image ?? 'PNG, JPG o WebP · máx. 2 MB. La optimizamos automáticamente.'}</span>
            </div>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmLow}
        title="Precio menor al costo"
        tone="accent"
        busy={busy}
        confirmLabel="Guardar de todos modos"
        message={
          <p>
            Vas a vender <strong>{form.nombre || 'este producto'}</strong> a {money(form.precioVenta)}, por debajo de su costo de {money(form.costo)}. Cada venta
            generará pérdida. ¿Deseas continuar?
          </p>
        }
        onConfirm={() => void save(true)}
        onClose={() => setConfirmLow(false)}
      />
    </>
  );
}
