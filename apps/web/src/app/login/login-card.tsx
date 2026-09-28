'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Building2, KeyRound, Mail, ShieldCheck, TriangleAlert, User } from 'lucide-react';
import { businessTypeError, parseInstagram } from '@facilito/domain/business-profile';
import { ApiError, errorMessage, publicGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/components/auth/auth-layout';
import { PasswordInput, StrengthMeter } from '@/components/auth/password-input';
import { BusinessTypeField, InstagramField } from '@/components/ui/business-fields';
import { Field, Spinner, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

type Tab = 'login' | 'registro';

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['login', 'Iniciar sesión'],
  ['registro', 'Registrarse'],
];

function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function IconInput({
  label,
  icon,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; icon: React.ReactNode; error?: string }) {
  return (
    <Field label={label} error={error}>
      {(id, desc) => (
        <div className="input-icon">
          {icon}
          <input id={id} className="input" aria-invalid={!!error} aria-describedby={desc} {...rest} />
        </div>
      )}
    </Field>
  );
}

export function LoginCard() {
  const params = useSearchParams();
  const router = useRouter();
  const { status, login, register } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'registro' ? 'registro' : 'login');
  const next = safeNext(params.get('next'));

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, next, router]);

  const switchTab = (t: Tab) => {
    setTab(t);
    const sp = new URLSearchParams(params.toString());
    if (t === 'registro') sp.set('tab', 'registro');
    else sp.delete('tab');
    router.replace(`/login${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };

  const google = async () => {
    try {
      await publicGet('/v1/auth/google');
    } catch (e) {
      toast.info('Google aún no está disponible', errorMessage(e));
    }
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const target: Tab = e.key === 'Home' ? 'login' : e.key === 'End' ? 'registro' : tab === 'login' ? 'registro' : 'login';
    switchTab(target);
    document.getElementById(`auth-tab-${target}`)?.focus();
  };

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="Acceso" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            id={`auth-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="auth-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => switchTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${tab}`}>
        {tab === 'login' ? (
          <LoginForm onDone={() => router.replace(next)} login={login} onGoogle={google} onRegister={() => switchTab('registro')} />
        ) : (
          <RegisterForm onDone={() => router.replace('/inicio')} register={register} onLogin={() => switchTab('login')} />
        )}
      </div>
    </>
  );
}

function LoginForm({
  login,
  onDone,
  onGoogle,
  onRegister,
}: {
  login: ReturnType<typeof useAuth>['login'];
  onDone: () => void;
  onGoogle: () => void;
  onRegister: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recordarme, setRecordarme] = useState(false);
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!email.trim() || !password) {
      setFields({ ...(email.trim() ? {} : { email: 'Ingresa tu email' }), ...(password ? {} : { password: 'Ingresa tu contraseña' }) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      await login({ email: email.trim(), password, recordarme, ...(needTotp ? { totp } : {}) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        setNeedTotp(true);
        setError(null);
      } else {
        setFields(fieldErrorMap(err));
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>¡Bienvenido de nuevo!</h2>
      <p className="lead">Ingresa a tu cuenta y sigue haciendo crecer tu negocio.</p>
      <form ref={formRef} method="post" className="auth-form" onSubmit={submit} noValidate>
        {error && (
          <div className="form-alert" role="alert">
            <TriangleAlert size={18} /> <span>{error}</span>
          </div>
        )}
        <IconInput
          label="Correo electrónico"
          icon={<Mail size={18} aria-hidden />}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          placeholder="tucorreo@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={320}
          error={fields.email}
          required
        />
        <PasswordInput
          label="Contraseña"
          name="password"
          autoComplete="current-password"
          placeholder="Tu contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={128}
          error={fields.password}
          required
        />
        {needTotp && (
          <IconInput
            label="Código de verificación (2FA)"
            icon={<ShieldCheck size={18} aria-hidden />}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            error={fields.totp}
            autoFocus
          />
        )}
        <div className="auth-row">
          <label className="check">
            <input type="checkbox" checked={recordarme} onChange={(e) => setRecordarme(e.target.checked)} /> Recordarme
          </label>
          <Link href="/recuperar">¿Olvidaste tu contraseña?</Link>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={18} /> : null} Iniciar sesión {!busy && <ArrowRight size={18} aria-hidden />}
        </button>
        <div className="divider">o continúa con</div>
        <button type="button" className="btn btn-outline btn-block" onClick={onGoogle}>
          <GoogleIcon /> Continuar con Google
        </button>
        <p className="auth-switch">
          ¿No tienes una cuenta?{' '}
          <button type="button" className="link-btn" onClick={onRegister}>
            Regístrate aquí
          </button>
        </p>
      </form>
    </>
  );
}

function RegisterForm({
  register,
  onDone,
  onLogin,
}: {
  register: ReturnType<typeof useAuth>['register'];
  onDone: () => void;
  onLogin: () => void;
}) {
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    razonSocial: '',
    rnc: '',
    tipoNegocio: 'Colmado',
    instagram: '',
    password: '',
    confirm: '',
    recordarme: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const setFieldError = (k: string, msg: string | undefined) =>
    setFields((f) => {
      const next = { ...f };
      if (msg) next[k] = msg;
      else delete next[k];
      return next;
    });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (form.nombre.trim().length < 2) e.nombre = 'Escribe tu nombre';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Email inválido';
    if (form.razonSocial.trim().length < 2) e.razonSocial = 'Escribe el nombre de tu negocio';
    const rnc = form.rnc.replace(/[\s-]/g, '');
    if (!/^\d{9}$|^\d{11}$/.test(rnc)) e.rnc = 'RNC de 9 dígitos o cédula de 11';
    const tipoError = businessTypeError(form.tipoNegocio);
    if (tipoError) e.tipoNegocio = tipoError;
    const ig = parseInstagram(form.instagram);
    if (!ig.ok) e.instagram = ig.error;
    if (form.password.length < 10) e.password = 'Mínimo 10 caracteres';
    else if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(form.password) || !/\d/.test(form.password)) e.password = 'Usa letras y números';
    if (form.confirm !== form.password) e.confirm = 'Las contraseñas no coinciden';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const e = validate();
    setFields(e);
    if (Object.keys(e).length) {
      focusFirstInvalid(formRef.current);
      return;
    }
    const ig = parseInstagram(form.instagram);
    setBusy(true);
    try {
      await register({
        nombre: form.nombre.trim(),
        email: form.email.trim(),
        password: form.password,
        razonSocial: form.razonSocial.trim(),
        rnc: form.rnc,
        tipoNegocio: form.tipoNegocio,
        ...(ig.ok && ig.handle ? { instagram: ig.handle } : {}),
        recordarme: form.recordarme,
      });
      onDone();
    } catch (err) {
      setFields(fieldErrorMap(err));
      setError(errorMessage(err));
      focusFirstInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Crea tu cuenta</h2>
      <p className="lead">Empieza gratis y organiza tu negocio en minutos.</p>
      <form ref={formRef} method="post" className="auth-form" onSubmit={submit} noValidate>
        {error && (
          <div className="form-alert" role="alert">
            <TriangleAlert size={18} /> <span>{error}</span>
          </div>
        )}
        <IconInput
          label="Tu nombre"
          icon={<User size={18} aria-hidden />}
          autoComplete="name"
          value={form.nombre}
          onChange={(e) => set('nombre', e.target.value)}
          maxLength={120}
          error={fields.nombre}
          placeholder="María Pérez"
        />
        <IconInput
          label="Correo electrónico"
          icon={<Mail size={18} aria-hidden />}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          maxLength={320}
          error={fields.email}
          placeholder="tucorreo@ejemplo.com"
        />
        <IconInput
          label="Nombre del negocio"
          icon={<Building2 size={18} aria-hidden />}
          autoComplete="organization"
          value={form.razonSocial}
          onChange={(e) => set('razonSocial', e.target.value)}
          maxLength={200}
          error={fields.razonSocial}
          placeholder="Colmado La Esquina"
        />
        <div className="form-grid">
          <IconInput
            label="RNC o cédula"
            icon={<KeyRound size={18} aria-hidden />}
            inputMode="numeric"
            value={form.rnc}
            onChange={(e) => set('rnc', e.target.value.replace(/[^\d-\s]/g, ''))}
            maxLength={13}
            error={fields.rnc}
            placeholder="1-01-00000-1"
          />
          <BusinessTypeField value={form.tipoNegocio} onChange={(v) => set('tipoNegocio', v)} error={fields.tipoNegocio} hint="" />
        </div>
        <InstagramField
          value={form.instagram}
          onChange={(v) => set('instagram', v)}
          onError={(m) => setFieldError('instagram', m)}
          error={fields.instagram}
        />
        <div className="stack" style={{ gap: 8 }}>
          <PasswordInput
            label="Contraseña"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            maxLength={128}
            error={fields.password}
            hint="Mínimo 10 caracteres, con letras y números"
          />
          <StrengthMeter value={form.password} />
        </div>
        <PasswordInput
          label="Confirmar contraseña"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => set('confirm', e.target.value)}
          maxLength={128}
          error={fields.confirm}
        />
        <label className="check">
          <input type="checkbox" checked={form.recordarme} onChange={(e) => set('recordarme', e.target.checked)} /> Mantener sesión iniciada
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={18} /> : null} Crear cuenta {!busy && <ArrowRight size={18} aria-hidden />}
        </button>
        <p className="auth-switch">
          ¿Ya tienes una cuenta?{' '}
          <button type="button" className="link-btn" onClick={onLogin}>
            Inicia sesión
          </button>
        </p>
      </form>
    </>
  );
}
