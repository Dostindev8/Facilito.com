'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Building2, CircleCheck, TriangleAlert } from 'lucide-react';
import { errorMessage, publicPost } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordInput, StrengthMeter } from '@/components/auth/password-input';
import { Skeleton, Spinner } from '@/components/ui/primitives';

interface Invitation {
  email: string;
  nombre: string | null;
  negocio: string;
  plan: string;
  vence: string;
}

type View = { kind: 'loading' } | { kind: 'invalid'; message: string } | { kind: 'ready'; token: string; inv: Invitation };

export default function ActivatePage() {
  const router = useRouter();
  const { acceptInvitation } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recordarme, setRecordarme] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<{ password?: string; confirm?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    // Keep the single-use token out of browser history and referrers.
    if (token) window.history.replaceState(null, '', '/activar');
    if (!token) {
      setView({ kind: 'invalid', message: 'Abre el enlace completo que te enviamos por correo o WhatsApp.' });
      return;
    }
    publicPost<Invitation>('/v1/auth/invitations/inspect', { token })
      .then((inv) => setView({ kind: 'ready', token, inv }))
      .catch((e: unknown) => setView({ kind: 'invalid', message: errorMessage(e) }));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== 'ready') return;
    setError(null);
    const errs: typeof fields = {};
    if (password.length < 10) errs.password = 'Mínimo 10 caracteres';
    else if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) errs.password = 'Usa letras y números';
    if (confirm !== password) errs.confirm = 'Las contraseñas no coinciden';
    setFields(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      const user = await acceptInvitation({ token: view.token, password, recordarme });
      router.replace(homeFor(user));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2>Activa tu cuenta</h2>
      <p className="lead">Tu pago fue aprobado. Crea tu contraseña para entrar a Facilito.</p>
      {view.kind === 'loading' ? (
        <div className="stack" aria-busy="true">
          <Skeleton h={64} />
          <Skeleton h={48} />
          <Skeleton h={48} />
        </div>
      ) : view.kind === 'invalid' ? (
        <div className="stack">
          <div className="form-alert warn" role="alert">
            <TriangleAlert size={18} /> <span>{view.message}</span>
          </div>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Si ya creaste tu contraseña, <Link href="/login">inicia sesión</Link>. Si la olvidaste, usa <Link href="/recuperar">recuperar contraseña</Link>.
          </p>
        </div>
      ) : (
        <form ref={formRef} method="post" className="auth-form" onSubmit={submit} noValidate>
          <div className="activation-summary">
            <span className="kpi-icon tone-green" aria-hidden>
              <Building2 size={20} />
            </span>
            <div>
              <strong>{view.inv.negocio}</strong>
              <span>
                Plan {view.inv.plan} · {view.inv.email}
              </span>
            </div>
          </div>
          {error && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <input type="email" name="username" autoComplete="username" value={view.inv.email} readOnly hidden />
          <div className="stack" style={{ gap: 8 }}>
            <PasswordInput
              label="Contraseña"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
              error={fields.password}
              hint="Mínimo 10 caracteres, con letras y números"
            />
            <StrengthMeter value={password} />
          </div>
          <PasswordInput
            label="Confirmar contraseña"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            maxLength={128}
            error={fields.confirm}
          />
          <label className="check">
            <input type="checkbox" checked={recordarme} onChange={(e) => setRecordarme(e.target.checked)} /> Mantener sesión iniciada
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner size={18} /> : <CircleCheck size={18} aria-hidden />} Crear contraseña y entrar {!busy && <ArrowRight size={18} aria-hidden />}
          </button>
          <p className="auth-note">El enlace es de un solo uso y vence el {dateTime(view.inv.vence)}.</p>
        </form>
      )}
    </AuthLayout>
  );
}
