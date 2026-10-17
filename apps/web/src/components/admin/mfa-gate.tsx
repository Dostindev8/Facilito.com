'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { KeyRound, LogIn, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/hooks';
import { ErrorState, Skeleton, Spinner, TextInput } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

/** Platform routes reject sessions without a verified second factor (403 mfa_required); this walks the admin through it. */
export function MfaGate() {
  const toast = useToast();
  const router = useRouter();
  const { logout } = useAuth();
  const me = useAsync(() => api<{ totpEnabled: boolean; email: string }>('/v1/me'), []);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relogin = async () => {
    await logout();
    router.replace('/login?next=/admin');
  };

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
    if (!/^\d{6}$/.test(code)) return setError('Escribe el código de 6 dígitos.');
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/totp/verify', { method: 'POST', body: { code } });
      toast.success('Verificación en dos pasos activada', 'Entra de nuevo con tu contraseña y el código.');
      await relogin();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section className="card stack mfa-gate" aria-labelledby="mfa-title">
      <span className="kpi-icon tone-purple" style={{ width: 52, height: 52 }} aria-hidden>
        <ShieldCheck size={26} />
      </span>
      <h1 id="mfa-title" style={{ fontSize: '1.4rem' }}>
        Verificación en dos pasos obligatoria
      </h1>
      {me.error ? (
        <ErrorState error={me.error} onRetry={me.reload} />
      ) : !me.data ? (
        <Skeleton h={120} />
      ) : me.data.totpEnabled ? (
        <>
          <p className="muted">Tu cuenta ya tiene 2FA, pero esta sesión se abrió sin el código. Entra de nuevo con tu contraseña y el código de tu app.</p>
          <button type="button" className="btn btn-primary" onClick={relogin}>
            <LogIn size={18} aria-hidden /> Iniciar sesión con código
          </button>
        </>
      ) : setup ? (
        <form className="stack" onSubmit={verify} noValidate>
          <ol className="mfa-steps">
            <li>Abre Google Authenticator, Microsoft Authenticator, 1Password o similar.</li>
            <li>
              Agrega una cuenta con esta clave:{' '}
              <code className="secret-code">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
              <a className="link-btn" href={setup.otpauth} style={{ display: 'inline-block', marginTop: 6 }}>
                <KeyRound size={14} aria-hidden /> Abrir en la app (desde el celular)
              </a>
            </li>
            <li>Escribe el código de 6 dígitos que muestra la app.</li>
          </ol>
          {error && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <TextInput label="Código" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={16} />} Activar y volver a entrar
          </button>
        </form>
      ) : (
        <>
          <p className="muted">
            El panel de administración maneja pagos y cuentas de todos los clientes. Para entrar, {me.data.email} necesita un código de una app de autenticación además de la contraseña.
          </p>
          {error && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? <Spinner size={16} /> : <ShieldCheck size={18} aria-hidden />} Configurar 2FA
          </button>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Guarda la clave en un lugar seguro: si pierdes el celular, la necesitarás para recuperar el acceso.
          </p>
        </>
      )}
    </section>
  );
}
