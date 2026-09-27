'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react';
import { errorMessage, publicPost } from '@/lib/api';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordInput, StrengthMeter } from '@/components/auth/password-input';
import { Spinner } from '@/components/ui/primitives';

export default function ResetPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);
    // Keep the single-use token out of browser history and referrers.
    if (t) window.history.replaceState(null, '', '/restablecer');
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('La contraseña necesita mínimo 10 caracteres, con letras y números.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await publicPost('/v1/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2>Nueva contraseña</h2>
      <p className="lead">Elige una contraseña segura que no uses en otros sitios.</p>
      {done ? (
        <div className="stack">
          <div className="form-alert success" role="status">
            <CircleCheck size={18} /> <span>Tu contraseña fue actualizada. Por seguridad cerramos tus otras sesiones.</span>
          </div>
          <Link href="/login" className="btn btn-primary btn-block">
            Iniciar sesión <ArrowRight size={18} />
          </Link>
        </div>
      ) : token === undefined ? (
        <Spinner />
      ) : token === null ? (
        <div className="form-alert warn" role="alert">
          <TriangleAlert size={18} />
          <span>
            El enlace no es válido o ya fue usado. <Link href="/recuperar">Solicita uno nuevo</Link>.
          </span>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          {error && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <PasswordInput label="Contraseña nueva" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
            <StrengthMeter value={password} />
          </div>
          <PasswordInput label="Confirmar contraseña" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy && <Spinner size={18} />} Guardar contraseña
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
