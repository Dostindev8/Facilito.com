'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Mail, ShieldCheck, TriangleAlert } from 'lucide-react';
import { ApiError, errorMessage, type SessionUser } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { site } from '@/lib/site';
import { safeNext } from '@/components/auth/auth-layout';
import { PasswordInput } from '@/components/auth/password-input';
import { Field, Spinner, fieldErrorMap } from '@/components/ui/primitives';

function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
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
  const { status, user, login } = useAuth();
  const explicitNext = params.get('next');
  const destination = (u: Pick<SessionUser, 'platformAdmin'>) => (explicitNext ? safeNext(explicitNext) : homeFor(u));

  useEffect(() => {
    // Old "create account" links point here; sign-up now starts with a plan.
    if (params.get('tab') === 'registro') router.replace(site.subscribePath);
  }, [params, router]);

  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(destination(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user]);

  return <LoginForm login={login} onDone={(u) => router.replace(destination(u))} />;
}

function LoginForm({ login, onDone }: { login: ReturnType<typeof useAuth>['login']; onDone: (user: SessionUser) => void }) {
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
    if (needTotp && !/^\d{6}$/.test(totp)) {
      setFields({ totp: 'Escribe el código de 6 dígitos' });
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      onDone(await login({ email: email.trim(), password, recordarme, ...(needTotp ? { totp } : {}) }));
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
        <p className="auth-switch">
          ¿Aún no tienes cuenta? <Link href={site.subscribePath}>Elige un plan y suscríbete</Link>
        </p>
        <p className="auth-note">
          ¿Ya pagaste? Cuando aprobemos tu pago te enviaremos un enlace para crear tu contraseña. Puedes ver el estado en{' '}
          <Link href={`${site.subscribePath}?ver=estado`}>tu solicitud</Link>.
        </p>
      </form>
    </>
  );
}
