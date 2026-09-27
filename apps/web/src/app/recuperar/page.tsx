'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, CircleCheck, Mail, TriangleAlert } from 'lucide-react';
import { errorMessage, publicPost } from '@/lib/api';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Field, Spinner } from '@/components/ui/primitives';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Escribe un email válido.');
      return;
    }
    setBusy(true);
    try {
      const r = await publicPost<{ message: string }>('/v1/auth/forgot-password', { email: email.trim() });
      setSent(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2>Recupera tu acceso</h2>
      <p className="lead">Te enviaremos un enlace para crear una contraseña nueva.</p>
      {sent ? (
        <div className="stack">
          <div className="form-alert success" role="status">
            <CircleCheck size={18} /> <span>{sent}</span>
          </div>
          <Link href="/login" className="btn btn-outline btn-block">
            <ArrowLeft size={18} /> Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          {error && (
            <div className="form-alert" role="alert">
              <TriangleAlert size={18} /> <span>{error}</span>
            </div>
          )}
          <Field label="Correo electrónico">
            {(id) => (
              <div className="input-icon">
                <Mail size={18} aria-hidden />
                <input
                  id={id}
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={320}
                  placeholder="tucorreo@ejemplo.com"
                />
              </div>
            )}
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy && <Spinner size={18} />} Enviar enlace
          </button>
          <Link href="/login" className="btn btn-ghost btn-block">
            <ArrowLeft size={18} /> Volver
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
