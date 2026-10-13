'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, Info, KeyRound, Mail, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { businessTypeError, parseInstagram } from '@facilito/domain/business-profile';
import { ApiError, api, errorMessage, refreshSession } from '@/lib/api';
import { ROLES, useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/hooks';
import { relativeTime } from '@/lib/format';
import { PasswordInput, StrengthMeter } from '@/components/auth/password-input';
import { BusinessTypeField, InstagramField } from '@/components/ui/business-fields';
import { ConfirmDialog, ErrorState, SelectInput, Skeleton, Spinner, Tabs, TextInput, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { BusinessSettings, NcfConfig } from '@/components/invoices/types';

type Tab = 'negocio' | 'cuenta' | 'facturacion' | 'comprobantes' | 'seguridad';
const TABS: Tab[] = ['negocio', 'cuenta', 'facturacion', 'comprobantes', 'seguridad'];

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} disabled={disabled} />
      <span aria-hidden />
    </span>
  );
}

const rncDigits = (v: string) => v.replace(/[\s-]/g, '');

function BusinessTab({ s, onSaved, readOnly, owner }: { s: BusinessSettings; onSaved: (s: BusinessSettings) => void; readOnly: boolean; owner: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({
    razonSocial: s.razonSocial,
    rnc: s.rnc ?? '',
    tipoNegocio: s.tipoNegocio,
    instagram: s.instagram?.handle ?? '',
    nombreComercial: s.nombreComercial,
    direccion: s.direccion ?? '',
    ubicacion: s.ubicacion,
    telefono: s.telefono ?? '',
    email: s.email ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmRnc, setConfirmRnc] = useState<string | null>(null);
  const setFieldError = (field: string, message: string | undefined) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });

  const validate = () => {
    const errs: Record<string, string> = {};
    if (form.razonSocial.trim().length < 2) errs.razonSocial = 'Escribe la razón social';
    const tipoErr = businessTypeError(form.tipoNegocio);
    if (tipoErr) errs.tipoNegocio = tipoErr;
    const ig = parseInstagram(form.instagram);
    if (!ig.ok) errs.instagram = ig.error;
    const rnc = rncDigits(form.rnc);
    if (owner && rnc !== rncDigits(s.rnc ?? '') && !/^(\d{9}|\d{11})$/.test(rnc)) errs.rnc = 'El RNC debe tener 9 dígitos (o 11 si es cédula)';
    return errs;
  };

  const save = async (confirmRncChange = false) => {
    setBusy(true);
    try {
      const ig = parseInstagram(form.instagram);
      const body: Record<string, unknown> = {
        razonSocial: form.razonSocial.trim(),
        tipoNegocio: form.tipoNegocio,
        nombreComercial: form.nombreComercial.trim(),
        direccion: form.direccion.trim() || null,
        ubicacion: form.ubicacion.trim(),
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
      };
      if (ig.ok && ig.handle !== (s.instagram?.handle ?? null)) body.instagram = ig.handle;
      const rnc = rncDigits(form.rnc);
      if (owner && rnc !== rncDigits(s.rnc ?? '')) {
        body.rnc = rnc;
        if (confirmRncChange) body.confirmRncChange = true;
      }
      const r = await api<BusinessSettings>('/v1/settings', { method: 'PATCH', body });
      setConfirmRnc(null);
      onSaved(r);
      setForm((f) => ({ ...f, rnc: r.rnc ?? '', instagram: r.instagram?.handle ?? '', tipoNegocio: r.tipoNegocio }));
      toast.success('Datos del negocio guardados');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rnc_confirm_required') {
        setConfirmRnc(err.detail);
        return;
      }
      setConfirmRnc(null);
      setErrors(fieldErrorMap(err));
      toast.error('No se pudo guardar', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void save();
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <TextInput label="Razón social" value={form.razonSocial} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} maxLength={200} error={errors.razonSocial} disabled={readOnly} />
        <TextInput
          label="RNC"
          inputMode="numeric"
          value={form.rnc}
          onChange={(e) => setForm({ ...form, rnc: e.target.value.replace(/[^\d-\s]/g, '') })}
          maxLength={13}
          error={errors.rnc}
          hint="Se guarda cifrado. Solo el dueño puede cambiarlo."
          disabled={readOnly || !owner}
        />
        <BusinessTypeField value={form.tipoNegocio} onChange={(v) => setForm({ ...form, tipoNegocio: v })} error={errors.tipoNegocio} disabled={readOnly} />
        <InstagramField
          value={form.instagram}
          onChange={(v) => setForm({ ...form, instagram: v })}
          onError={(m) => setFieldError('instagram', m)}
          error={errors.instagram}
          disabled={readOnly}
        />
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
      <ConfirmDialog
        open={confirmRnc !== null}
        title="¿Cambiar el RNC del negocio?"
        message={
          <>
            <p>{confirmRnc}</p>
            <p className="muted">Las facturas ya emitidas conservan el RNC con el que salieron. Las nuevas usarán el RNC nuevo. Confirma con tu contador antes de continuar.</p>
          </>
        }
        confirmLabel="Sí, cambiar RNC"
        tone="danger"
        busy={busy}
        onConfirm={() => void save(true)}
        onClose={() => setConfirmRnc(null)}
      />
    </form>
  );
}

interface MeInfo {
  nombre: string;
  email: string;
  pendingEmail: string | null;
  totpEnabled: boolean;
}

function AccountTab() {
  const toast = useToast();
  const me = useAsync(() => api<MeInfo>('/v1/me'), []);
  const [nombre, setNombre] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [savingName, setSavingName] = useState(false);
  const [email, setEmail] = useState({ newEmail: '', password: '' });
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
  const [savingEmail, setSavingEmail] = useState(false);

  if (me.error) return <div className="card"><ErrorState error={me.error} onRetry={me.reload} /></div>;
  if (!me.data) return <Skeleton h={260} r={16} />;
  const current = nombre ?? me.data.nombre;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (current.trim().length < 2) {
      setNameError('Escribe tu nombre');
      return;
    }
    setNameError(undefined);
    setSavingName(true);
    try {
      await api('/v1/me', { method: 'PATCH', body: { nombre: current.trim() } });
      await refreshSession();
      me.reload();
      setNombre(null);
      toast.success('Nombre actualizado');
    } catch (err) {
      setNameError(fieldErrorMap(err).nombre);
      toast.error('No se pudo guardar', errorMessage(err));
    } finally {
      setSavingName(false);
    }
  };

  const requestEmail = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.newEmail.trim())) errs.newEmail = 'Escribe un correo válido';
    if (!email.password) errs.password = 'Escribe tu contraseña actual';
    setEmailErrors(errs);
    if (Object.keys(errs).length) return;
    setSavingEmail(true);
    try {
      await api('/v1/auth/email-change', { method: 'POST', body: { newEmail: email.newEmail.trim(), password: email.password } });
      setEmail({ newEmail: '', password: '' });
      me.reload();
      toast.success('Revisa tu correo nuevo', 'Te enviamos un enlace para confirmar el cambio.');
    } catch (err) {
      setEmailErrors(fieldErrorMap(err));
      toast.error('No se pudo solicitar el cambio', errorMessage(err));
    } finally {
      setSavingEmail(false);
    }
  };

  const cancelEmail = async () => {
    setSavingEmail(true);
    try {
      await api('/v1/auth/email-change', { method: 'DELETE' });
      me.reload();
      toast.success('Cambio de correo cancelado');
    } catch (err) {
      toast.error('No se pudo cancelar', errorMessage(err));
    } finally {
      setSavingEmail(false);
    }
  };

  return (
    <div className="settings-grid">
      <form className="card stack" onSubmit={saveName} noValidate>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2>Tus datos</h2>
        </div>
        <TextInput label="Nombre completo" autoComplete="name" value={current} onChange={(e) => setNombre(e.target.value)} maxLength={120} error={nameError} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={savingName || current.trim() === me.data.nombre}>
            {savingName ? <Spinner size={16} /> : <Save size={18} />} Guardar
          </button>
        </div>
      </form>
      <form method="post" className="card stack" onSubmit={requestEmail} noValidate>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2>Correo de acceso</h2>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Correo actual: <strong>{me.data.email}</strong>
        </p>
        {me.data.pendingEmail && (
          <div className="form-alert info" role="status">
            <Mail size={18} />
            <span>
              Esperando confirmación de <strong>{me.data.pendingEmail}</strong>. Hasta que la confirmes, sigues entrando con tu correo actual.{' '}
              <button type="button" className="link-btn" onClick={cancelEmail} disabled={savingEmail}>
                Cancelar cambio
              </button>
            </span>
          </div>
        )}
        <TextInput label="Correo nuevo" type="email" autoComplete="email" value={email.newEmail} onChange={(e) => setEmail({ ...email, newEmail: e.target.value })} maxLength={320} error={emailErrors.newEmail} />
        <PasswordInput label="Contraseña actual" autoComplete="current-password" value={email.password} onChange={(e) => setEmail({ ...email, password: e.target.value })} maxLength={128} error={emailErrors.password} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={savingEmail}>
            {savingEmail ? <Spinner size={16} /> : <Mail size={18} />} Enviar enlace de confirmación
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.currentPassword) errs.currentPassword = 'Escribe tu contraseña actual';
    if (form.newPassword.length < 10 || !/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) errs.newPassword = 'Mínimo 10 caracteres, con letras y números';
    else if (form.newPassword === form.currentPassword) errs.newPassword = 'La contraseña nueva debe ser distinta a la actual';
    if (form.confirm !== form.newPassword) errs.confirm = 'Las contraseñas no coinciden';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api('/v1/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Contraseña actualizada', 'Cerramos tus sesiones en otros dispositivos.');
    } catch (err) {
      setErrors(fieldErrorMap(err));
      toast.error('No se pudo cambiar la contraseña', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form method="post" className="card stack" style={{ maxWidth: 640 }} onSubmit={submit} noValidate>
      <div className="row">
        <span className="kpi-icon tone-green" style={{ width: 44, height: 44 }}>
          <KeyRound size={22} aria-hidden />
        </span>
        <div>
          <strong>Cambiar contraseña</strong>
          <p className="muted" style={{ fontSize: '0.88rem' }}>Al cambiarla cerramos tus sesiones en otros dispositivos; esta sigue abierta.</p>
        </div>
      </div>
      <PasswordInput label="Contraseña actual" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} maxLength={128} error={errors.currentPassword} />
      <div className="stack" style={{ gap: 8 }}>
        <PasswordInput label="Contraseña nueva" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} maxLength={128} error={errors.newPassword} />
        <StrengthMeter value={form.newPassword} />
      </div>
      <PasswordInput label="Confirmar contraseña nueva" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} maxLength={128} error={errors.confirm} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <Spinner size={16} /> : <KeyRound size={18} />} Cambiar contraseña
        </button>
      </div>
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
  const { logout } = useAuth();
  const router = useRouter();
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
      // The API closes every session so the next login proves the second factor.
      toast.success('Verificación en dos pasos activada', 'Inicia sesión de nuevo con tu código.');
      await logout();
      router.replace('/login');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (me.error) return <div className="card"><ErrorState error={me.error} onRetry={me.reload} /></div>;
  if (!me.data) return <Skeleton h={160} />;

  return (
    <>
    <PasswordCard />
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
        <form method="post" className="stack" onSubmit={verify} noValidate>
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
    <SessionsCard />
    </>
  );
}

interface ActiveSession {
  id: string;
  inicio: string;
  ultimaActividad: string;
  vence: string;
  dispositivo: string | null;
  ip: string | null;
  actual: boolean;
}

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Dispositivo desconocido';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${browser} en ${os}`;
}

function SessionsCard() {
  const toast = useToast();
  const list = useAsync(() => api<{ items: ActiveSession[] }>('/v1/auth/sessions'), []);
  const [closing, setClosing] = useState<ActiveSession | 'others' | null>(null);
  const [busy, setBusy] = useState(false);
  const others = list.data?.items.filter((s) => !s.actual).length ?? 0;

  const confirm = async () => {
    if (!closing) return;
    setBusy(true);
    try {
      if (closing === 'others') {
        const r = await api<{ cerradas: number }>('/v1/auth/sessions/revoke-others', { method: 'POST', headers: { 'x-facilito-csrf': '1' } });
        toast.success('Sesiones cerradas', r.cerradas ? `Cerramos ${r.cerradas} ${r.cerradas === 1 ? 'sesión' : 'sesiones'}.` : 'No había otras sesiones abiertas.');
      } else {
        await api(`/v1/auth/sessions/${closing.id}/revoke`, { method: 'POST', headers: { 'x-facilito-csrf': '1' } });
        toast.success('Sesión cerrada', deviceLabel(closing.dispositivo));
      }
      setClosing(null);
      list.reload();
    } catch (e) {
      toast.error('No se pudo cerrar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" style={{ maxWidth: 640 }} aria-labelledby="sessions-title">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong id="sessions-title">Sesiones abiertas</strong>
          <p className="muted" style={{ fontSize: '0.88rem' }}>Dispositivos donde tu cuenta está iniciada. Cierra los que no reconozcas.</p>
        </div>
        {others > 0 && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setClosing('others')}>
            Cerrar las demás
          </button>
        )}
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton h={96} />
      ) : (
        <ul className="session-list">
          {list.data.items.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{deviceLabel(s.dispositivo)}</strong>
                {s.actual && <span className="badge badge-green">Este dispositivo</span>}
                <span className="muted">
                  Activa {relativeTime(s.ultimaActividad)}
                  {s.ip ? ` · IP ${s.ip}` : ''}
                </span>
              </div>
              {!s.actual && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosing(s)} aria-label={`Cerrar sesión en ${deviceLabel(s.dispositivo)}`}>
                  Cerrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!closing}
        title={closing === 'others' ? 'Cerrar las demás sesiones' : 'Cerrar sesión'}
        message={
          closing === 'others'
            ? 'Todos los demás dispositivos tendrán que iniciar sesión otra vez. Este sigue abierto.'
            : closing
              ? `${deviceLabel(closing.dispositivo)} tendrá que iniciar sesión otra vez.`
              : ''
        }
        confirmLabel="Cerrar sesión"
        tone="danger"
        busy={busy}
        onConfirm={confirm}
        onClose={() => setClosing(null)}
      />
    </section>
  );
}

function SettingsView() {
  const { can, user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initial = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'negocio') as Tab;
  const [tab, setTab] = useState<Tab>(initial);
  const admin = can(ROLES.admin);
  const personal = tab === 'seguridad' || tab === 'cuenta';
  const tabParam = params.get('tab');

  useEffect(() => {
    if (TABS.includes(tabParam as Tab)) setTab(tabParam as Tab);
  }, [tabParam]);
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
          <p>Datos del negocio, tu cuenta, facturación, comprobantes fiscales y seguridad.</p>
        </div>
      </div>
      <Tabs<Tab>
        label="Secciones de configuración"
        value={tab}
        onChange={changeTab}
        items={[
          { value: 'negocio', label: 'Negocio' },
          { value: 'cuenta', label: 'Mi cuenta' },
          { value: 'facturacion', label: 'Facturación' },
          { value: 'comprobantes', label: 'Comprobantes (NCF)' },
          { value: 'seguridad', label: 'Seguridad' },
        ]}
      />
      {!admin && !personal && (
        <div className="form-alert info">
          <Info size={18} /> <span>Solo el dueño o el gerente pueden cambiar esta configuración.</span>
        </div>
      )}
      {tab === 'seguridad' ? (
        <SecurityTab />
      ) : tab === 'cuenta' ? (
        <AccountTab />
      ) : data.error ? (
        <div className="card">
          <ErrorState error={data.error} onRetry={data.reload} />
        </div>
      ) : !settings || !data.data ? (
        <Skeleton h={300} r={16} />
      ) : tab === 'negocio' ? (
        <BusinessTab s={settings} onSaved={setSettings} readOnly={!admin} owner={user?.rol === 'owner'} />
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
