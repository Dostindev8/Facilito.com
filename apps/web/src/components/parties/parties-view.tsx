'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, Search, TriangleAlert, Truck, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Role } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateShort } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/hooks';
import { Badge, EmptyState, ErrorState, Modal, Pagination, SelectInput, Skeleton, Spinner, TextInput, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface Party {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  estado: string;
  createdAt: string;
}

interface Config {
  kind: 'cliente' | 'proveedor';
  path: 'customers' | 'suppliers';
  title: string;
  singular: string;
  subtitle: string;
  docLabel: string;
  writeRoles: readonly Role[];
}

export const CUSTOMERS: Config = {
  kind: 'cliente',
  path: 'customers',
  title: 'Clientes',
  singular: 'cliente',
  subtitle: 'Tu cartera de clientes para facturar a crédito y con comprobante fiscal.',
  docLabel: 'Cédula o RNC',
  writeRoles: ['owner', 'manager', 'cashier'],
};

export const SUPPLIERS: Config = {
  kind: 'proveedor',
  path: 'suppliers',
  title: 'Proveedores',
  singular: 'proveedor',
  subtitle: 'Quién te abastece: se asocia a tus productos e importaciones.',
  docLabel: 'RNC',
  writeRoles: ['owner', 'manager', 'warehouse'],
};

export function PartiesView({ config }: { config: Config }) {
  const { can } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const canWrite = can(config.writeRoles);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const [editing, setEditing] = useState<Party | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nombre: '', documento: '', telefono: '', email: '', estado: 'activo' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [dq]);

  const list = useAsync(() => api<{ items: Party[]; total: number; page: number; pageSize: number }>(`/v1/${config.path}`, { query: { q: dq, page, pageSize: 20 } }), [dq, page]);

  const openEdit = useCallback(
    async (p: Party | null) => {
      setErrors({});
      setAlert(null);
      if (!p) {
        setEditing(null);
        setForm({ nombre: '', documento: '', telefono: '', email: '', estado: 'activo' });
        setOpen(true);
        return;
      }
      try {
        const full = await api<Party>(`/v1/${config.path}/${p.id}`);
        setEditing(full);
        setForm({ nombre: full.nombre, documento: full.documento ?? '', telefono: full.telefono ?? '', email: full.email ?? '', estado: full.estado });
        setOpen(true);
      } catch (e) {
        toast.error('No se pudo abrir', errorMessage(e));
      }
    },
    [config.path, toast],
  );

  useEffect(() => {
    const id = params.get('id');
    if (id && /^[0-9a-f-]{36}$/i.test(id) && canWrite) {
      void openEdit({ id } as Party);
      router.replace(pathname, { scroll: false });
    }
  }, [params, canWrite, openEdit, router, pathname]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.nombre.trim()) errs.nombre = 'El nombre es obligatorio';
    const doc = form.documento.replace(/[\s-]/g, '');
    if (doc && !/^\d{9}$|^\d{11}$/.test(doc)) errs.documento = 'RNC de 9 dígitos o cédula de 11';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Email inválido';
    if (form.telefono.trim() && form.telefono.replace(/\D/g, '').length < 10) errs.telefono = 'Teléfono de al menos 10 dígitos';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setAlert(null);
    const body = {
      nombre: form.nombre.trim(),
      documento: doc || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      ...(config.kind === 'proveedor' ? { estado: form.estado } : {}),
    };
    try {
      if (editing) await api(`/v1/${config.path}/${editing.id}`, { method: 'PATCH', body });
      else await api(`/v1/${config.path}`, { method: 'POST', body });
      toast.success(editing ? `${config.title.slice(0, -1)} actualizado` : `${config.title.slice(0, -1)} creado`, body.nombre);
      setOpen(false);
      list.reload();
    } catch (err) {
      setErrors(fieldErrorMap(err));
      setAlert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = config.kind === 'cliente' ? Users : Truck;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{config.title}</h1>
          <p>{config.subtitle}</p>
        </div>
        {canWrite && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={() => openEdit(null)}>
              <Plus size={18} /> Nuevo {config.singular}
            </button>
          </div>
        )}
      </div>
      <section className="card">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <div className="search">
            <Search size={18} aria-hidden />
            <label htmlFor="party-q" className="sr-only">
              Buscar
            </label>
            <input id="party-q" type="search" className="input" placeholder="Buscar por nombre, teléfono o email" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
          </div>
        </div>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Skeleton h={220} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Icon size={26} />}
            title={dq ? 'Sin resultados' : `Aún no tienes ${config.title.toLowerCase()}`}
            action={
              canWrite && !dq ? (
                <button type="button" className="btn btn-primary" onClick={() => openEdit(null)}>
                  <Plus size={18} /> Nuevo {config.singular}
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>{config.docLabel}</th>
                    <th>Teléfono</th>
                    <th>Email</th>
                    <th>Estado</th>
                    <th>Desde</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.id}>
                      <td className="td-main" data-label="Nombre">
                        <strong>{p.nombre}</strong>
                      </td>
                      <td data-label={config.docLabel} className="mono">
                        {p.documento ?? '—'}
                      </td>
                      <td data-label="Teléfono">{p.telefono ?? '—'}</td>
                      <td data-label="Email" style={{ overflowWrap: 'anywhere' }}>
                        {p.email ?? '—'}
                      </td>
                      <td data-label="Estado">
                        <Badge tone={p.estado === 'activo' ? 'green' : 'gray'}>{p.estado === 'activo' ? 'Activo' : 'Inactivo'}</Badge>
                      </td>
                      <td data-label="Desde">{dateShort(p.createdAt)}</td>
                      <td className="td-actions">
                        {canWrite && (
                          <button type="button" className="icon-btn" aria-label={`Editar ${p.nombre}`} onClick={() => openEdit(p)}>
                            <Pencil size={18} />
                          </button>
                        )}
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Editar ${config.singular}` : `Nuevo ${config.singular}`}
        subtitle={config.kind === 'cliente' ? 'El documento se guarda cifrado.' : 'El RNC se guarda cifrado.'}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="party-form" className="btn btn-primary" disabled={busy}>
              {busy && <Spinner size={16} />} Guardar
            </button>
          </>
        }
      >
        <form id="party-form" className="stack" onSubmit={submit} noValidate>
          {alert && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{alert}</span>
            </div>
          )}
          <div className="form-grid">
            <TextInput label="Nombre" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={200} error={errors.nombre} className="span-2" />
            <TextInput label={config.docLabel} inputMode="numeric" value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value.replace(/[^\d-\s]/g, '') })} maxLength={13} error={errors.documento} />
            <TextInput label="Teléfono" type="tel" inputMode="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} maxLength={20} error={errors.telefono} placeholder="809-555-1234" />
            <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={320} error={errors.email} className={config.kind === 'cliente' ? 'span-2' : undefined} />
            {config.kind === 'proveedor' && (
              <SelectInput label="Estado" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </SelectInput>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}
