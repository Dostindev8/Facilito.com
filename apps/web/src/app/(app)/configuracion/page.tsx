'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, Info, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/hooks';
import { ErrorState, SelectInput, Skeleton, Spinner, Tabs, TextInput, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { BusinessSettings, NcfConfig } from '@/components/invoices/types';

type Tab = 'negocio' | 'facturacion' | 'comprobantes' | 'seguridad';

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} disabled={disabled} />
      <span aria-hidden />
    </span>
  );
}

function BusinessTab({ s, onSaved, readOnly }: { s: BusinessSettings; onSaved: (s: BusinessSettings) => void; readOnly: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({ nombreComercial: s.nombreComercial, direccion: s.direccion ?? '', ubicacion: s.ubicacion, telefono: s.telefono ?? '', email: s.email ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await api<BusinessSettings>('/v1/settings', {
        method: 'PATCH',
        body: {
          nombreComercial: form.nombreComercial.trim(),
          direccion: form.direccion.trim() || null,
          ubicacion: form.ubicacion.trim(),
          telefono: form.telefono.trim() || null,
          email: form.email.trim() || null,
        },
      });
      onSaved(r);
      toast.success('Datos del negocio guardados');
    } catch (err) {
      setErrors(fieldErrorMap(err));
      toast.error('No se pudo guardar', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <TextInput label="Razón social" value={s.razonSocial} disabled hint="Registrada al crear la cuenta" />
        <TextInput label="RNC" value={s.rnc ?? '—'} disabled hint="Se guarda cifrado" />
        <TextInput label="Nombre comercial" value={form.nombreComercial} onChange={(e) => setForm({ ...form, nombreComercial: e.target.value })} maxLength={200} error={errors.nombreComercial} disabled={readOnly} />
        <TextInput label="Ubicación" value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} maxLength={120} error={errors.ubicacion} disabled={readOnly} />
        <TextInput label="Dirección" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} maxLength={300} error={errors.direccion} className="span-2" disabled={readOnly} />
        <TextInput label="Teléfono" type="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} maxLength={20} error={errors.telefono} disabled={readOnly} />
        <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={320} error={errors.email} disabled={readOnly} />
      </div>
      {!readOnly && (
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner size={16} /> : <Save size={18} />} Guardar
          </button>
        </div>
      )}
    </form>
  );
}

function InvoicingTab({ s, ncf, onSaved, readOnly }: { s: BusinessSettings; ncf: NcfConfig; onSaved: (s: BusinessSettings) => void; readOnly: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const patch = async (body: Partial<BusinessSettings>) => {
    setBusy(true);
    try {
      onSaved(await api<BusinessSettings>('/v1/settings', { method: 'PATCH', body }));
      toast.success('Configuración actualizada');
    } catch (e) {
      toast.error('No se pudo guardar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="toggle-row">
        <div>
          <strong>Cálculo del ITBIS</strong>
          <p>Por línea (cada producto con su tasa) o global (una tasa sobre la base gravada).</p>
        </div>
        <select className="input" style={{ width: 'auto' }} value={s.itbisModo} disabled={readOnly || busy} onChange={(e) => patch({ itbisModo: e.target.value as 'linea' | 'global' })} aria-label="Modo de ITBIS">
          <option value="linea">Por línea</option>
          <option value="global">Global</option>
        </select>
      </div>
      <div className="toggle-row">
        <div>
          <strong>Tasa global de ITBIS</strong>
          <p>Se usa en modo global. Pendiente verificar tasas vigentes con la DGII.</p>
        </div>
        <select className="input" style={{ width: 'auto' }} value={s.itbisTasa} disabled={readOnly || busy} onChange={(e) => patch({ itbisTasa: e.target.value })} aria-label="Tasa global">
          <option value="0.18">18%</option>
          <option value="0.16">16%</option>
          <option value="0">Exento</option>
        </select>
      </div>
      <div className="toggle-row">
        <div>
          <strong>Emitir con comprobante fiscal por defecto</strong>
          <p>Si está activo, las facturas usan el tipo de NCF elegido abajo.</p>
        </div>
        <Switch checked={s.sujetoDgii} onChange={(v) => patch({ sujetoDgii: v })} label="Emitir con NCF por defecto" disabled={readOnly || busy} />
      </div>
      <div className="toggle-row">
        <div>
          <strong>Tipo de NCF por defecto</strong>
          <p>Consumidor final (B02) es lo usual en ventas al detalle.</p>
        </div>
        <select
          className="input"
          style={{ width: 'auto' }}
          value={s.ncfTipoDefault ?? ''}
          disabled={readOnly || busy}
          onChange={(e) => patch({ ncfTipoDefault: e.target.value || null })}
          aria-label="Tipo de NCF por defecto"
        >
          <option value="">Ninguno</option>
          {Object.entries(ncf.tipos).map(([k, v]) => (
            <option key={k} value={k}>
              {k} · {v}
            </option>
          ))}
        </select>
      </div>
      <div className="toggle-row">
        <div>
          <strong>Permitir vender sin stock</strong>
          <p>Si está desactivado, no se podrá facturar más de lo que hay en inventario.</p>
        </div>
        <Switch checked={s.permiteStockNegativo} onChange={(v) => patch({ permiteStockNegativo: v })} label="Permitir stock negativo" disabled={readOnly || busy} />
      </div>
    </div>
  );
}

function NcfTab({ ncf, onSaved, readOnly }: { ncf: NcfConfig; onSaved: () => void; readOnly: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({ tipo: 'B02', desde: '1', hasta: '', vence: '', activo: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickTipo = (tipo: string) => {
    const cur = ncf.secuencias.find((x) => x.tipo === tipo);
    setForm({
      tipo,
      desde: cur ? String(cur.siguiente) : '1',
      hasta: cur ? String(cur.hasta) : '',
      vence: cur?.vence ?? '',
      activo: cur?.activo ?? true,
    });
    setErrors({});
    setAlert(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\d{1,8}$/.test(form.desde) || Number(form.desde) < 1) errs.desde = 'Número válido';
    if (!/^\d{1,8}$/.test(form.hasta)) errs.hasta = 'Número válido';
    else if (Number(form.hasta) < Number(form.desde)) errs.hasta = 'Debe ser mayor o igual a “desde”';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setAlert(null);
    try {
      await api('/v1/settings/ncf', {
        method: 'PUT',
        body: { tipo: form.tipo, desde: Number(form.desde), hasta: Number(form.hasta), vence: form.vence || null, activo: form.activo },
      });
      toast.success('Secuencia guardada', `${form.tipo}: ${form.desde} – ${form.hasta}`);
      onSaved();
    } catch (err) {
      setErrors(fieldErrorMap(err));
      setAlert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-grid">
      <section className="card">
        <div className="card-header">
          <h2>Secuencias autorizadas</h2>
        </div>
        {ncf.secuencias.length === 0 ? (
          <p className="muted">Aún no has registrado secuencias de NCF.</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="th-num">Siguiente</th>
                  <th className="th-num">Hasta</th>
                  <th className="th-num">Disponibles</th>
                  <th>Vence</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {ncf.secuencias.map((x) => (
                  <tr key={x.tipo} className={readOnly ? undefined : 'clickable'} onClick={readOnly ? undefined : () => pickTipo(x.tipo)}>
                    <td className="td-main" data-label="Tipo">
                      <div>
                        <strong>{x.tipo}</strong>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>{x.descripcion}</div>
                      </div>
                    </td>
                    <td data-label="Siguiente" className="num mono">
                      {x.siguiente}
                    </td>
                    <td data-label="Hasta" className="num mono">
                      {x.hasta}
                    </td>
                    <td data-label="Disponibles" className={`num ${x.disponibles <= 50 ? 'text-orange' : ''}`}>
                      <strong>{x.disponibles}</strong>
                    </td>
                    <td data-label="Vence">{x.vence ?? '—'}</td>
                    <td data-label="Estado">
                      <span className={`badge ${x.activo ? 'badge-green' : 'badge-gray'}`}>{x.activo ? 'Activa' : 'Inactiva'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {!readOnly && (
        <form className="card stack" onSubmit={submit} noValidate>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h2>Registrar o ampliar secuencia</h2>
          </div>
          {alert && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{alert}</span>
            </div>
          )}
          <div className="form-alert info">
            <Info size={18} />
            <span>Usa exactamente el rango autorizado por la DGII. Los números ya emitidos nunca se reutilizan. (Tipos y reglas: pendiente verificar en vivo.)</span>
          </div>
          <div className="form-grid">
            <SelectInput label="Tipo de comprobante" value={form.tipo} onChange={(e) => pickTipo(e.target.value)} className="span-2">
              {Object.entries(ncf.tipos).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} · {v}
                </option>
              ))}
            </SelectInput>
            <TextInput label="Desde (número)" inputMode="numeric" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value.replace(/\D/g, '') })} error={errors.desde} />
            <TextInput label="Hasta (número)" inputMode="numeric" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value.replace(/\D/g, '') })} error={errors.hasta} />
            <TextInput label="Fecha de vencimiento" type="date" value={form.vence} onChange={(e) => setForm({ ...form, vence: e.target.value })} error={errors.vence} />
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="check" style={{ minHeight: 46 }}>
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Secuencia activa
              </label>
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <Spinner size={16} /> : <Save size={18} />} Guardar secuencia
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SecurityTab() {
  const toast = useToast();
  const me = useAsync(() => api<{ totpEnabled: boolean; email: string }>('/v1/me'), []);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api<{ secret: string; otpauth: string }>('/v1/auth/totp/setup', { method: 'POST', body: {} }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Escribe el código de 6 dígitos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/totp/verify', { method: 'POST', body: { code } });
      toast.success('Verificación en dos pasos activada');
      setSetup(null);
      setCode('');
      me.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (me.error) return <div className="card"><ErrorState error={me.error} onRetry={me.reload} /></div>;
  if (!me.data) return <Skeleton h={160} />;

  return (
    <section className="card stack" style={{ maxWidth: 640 }}>
      <div className="row">
        <span className="kpi-icon tone-green" style={{ width: 44, height: 44 }}>
          <ShieldCheck size={22} aria-hidden />
        </span>
        <div>
          <strong>Verificación en dos pasos (2FA)</strong>
          <p className="muted" style={{ fontSize: '0.88rem' }}>Protege tu cuenta con un código de tu app de autenticación además de tu contraseña.</p>
        </div>
      </div>
      {me.data.totpEnabled ? (
        <div className="form-alert success" role="status">
          <CircleCheck size={18} /> <span>La verificación en dos pasos está activa para {me.data.email}.</span>
        </div>
      ) : setup ? (
        <form className="stack" onSubmit={verify} noValidate>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            <li>Abre Google Authenticator, Microsoft Authenticator o similar.</li>
            <li>
              Agrega una cuenta con esta clave:{' '}
              <code style={{ background: 'var(--line-2)', padding: '4px 8px', borderRadius: 8, wordBreak: 'break-all', userSelect: 'all' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </li>
            <li>Escribe el código de 6 dígitos que muestra la app.</li>
          </ol>
          {error && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <TextInput label="Código" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <Spinner size={16} />} Activar
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div>
          {error && (
            <div className="form-alert" role="alert" style={{ marginBottom: 12 }}>
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? <Spinner size={16} /> : <ShieldCheck size={18} />} Activar 2FA
          </button>
        </div>
      )}
    </section>
  );
}

function SettingsView() {
  const { can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initial = (['negocio', 'facturacion', 'comprobantes', 'seguridad'].includes(params.get('tab') ?? '') ? params.get('tab') : 'negocio') as Tab;
  const [tab, setTab] = useState<Tab>(initial);
  const admin = can(ROLES.admin);
  const data = useAsync(() => Promise.all([api<BusinessSettings>('/v1/settings'), api<NcfConfig>('/v1/settings/ncf')]), []);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    if (data.data) setSettings(data.data[0]);
  }, [data.data]);

  const changeTab = (t: Tab) => {
    setTab(t);
    router.replace(`${pathname}?tab=${t}`, { scroll: false });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configuración</h1>
          <p>Datos del negocio, facturación, comprobantes fiscales y seguridad.</p>
        </div>
      </div>
      <Tabs<Tab>
        label="Secciones de configuración"
        value={tab}
        onChange={changeTab}
        items={[
          { value: 'negocio', label: 'Negocio' },
          { value: 'facturacion', label: 'Facturación' },
          { value: 'comprobantes', label: 'Comprobantes (NCF)' },
          { value: 'seguridad', label: 'Seguridad' },
        ]}
      />
      {!admin && tab !== 'seguridad' && (
        <div className="form-alert info">
          <Info size={18} /> <span>Solo el dueño o el gerente pueden cambiar esta configuración.</span>
        </div>
      )}
      {tab === 'seguridad' ? (
        <SecurityTab />
      ) : data.error ? (
        <div className="card">
          <ErrorState error={data.error} onRetry={data.reload} />
        </div>
      ) : !settings || !data.data ? (
        <Skeleton h={300} r={16} />
      ) : tab === 'negocio' ? (
        <BusinessTab s={settings} onSaved={setSettings} readOnly={!admin} />
      ) : tab === 'facturacion' ? (
        <InvoicingTab s={settings} ncf={data.data[1]} onSaved={setSettings} readOnly={!admin} />
      ) : (
        <NcfTab ncf={data.data[1]} onSaved={data.reload} readOnly={!admin} />
      )}
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton h={300} />}>
      <SettingsView />
    </Suspense>
  );
}
