'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react';
import { errorMessage, publicPost, setSession } from '@/lib/api';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Spinner } from '@/components/ui/primitives';

type State = { kind: 'loading' } | { kind: 'done'; email: string } | { kind: 'error'; message: string };

export default function ConfirmEmailPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token');
    // Keep the single-use token out of browser history and referrers.
    if (token) window.history.replaceState(null, '', '/confirmar-correo');
    if (!token) {
      setState({ kind: 'error', message: 'El enlace no es válido o ya fue usado.' });
      return;
    }
    publicPost<{ email: string }>('/v1/auth/email-change/confirm', { token })
      .then((r) => {
        // The API revokes every session after the change; drop the in-memory one too.
        setSession(null, null);
        setState({ kind: 'done', email: r.email });
      })
      .catch((e) => setState({ kind: 'error', message: errorMessage(e) }));
  }, []);

  return (
    <AuthLayout>
      <h2>Confirmar correo</h2>
      {state.kind === 'loading' ? (
        <div role="status" aria-live="polite" className="row">
          <Spinner size={18} /> <span>Confirmando tu correo nuevo…</span>
        </div>
      ) : state.kind === 'done' ? (
        <div className="stack">
          <div className="form-alert success" role="status">
            <CircleCheck size={18} />
            <span>
              Listo. Desde ahora entras con <strong>{state.email}</strong>. Por seguridad cerramos tus sesiones abiertas.
            </span>
          </div>
          <Link href="/login" className="btn btn-primary btn-block">
            Iniciar sesión <ArrowRight size={18} />
          </Link>
        </div>
      ) : (
        <div className="stack">
          <div className="form-alert warn" role="alert">
            <TriangleAlert size={18} /> <span>{state.message}</span>
          </div>
          <Link href="/configuracion?tab=cuenta" className="btn btn-ghost btn-block">
            Volver a Mi cuenta
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
