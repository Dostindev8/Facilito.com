'use client';

import { useEffect } from 'react';
import './globals.css';

/** Last-resort boundary: replaces the root layout when it crashes, so it must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[facilito] unhandled UI error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="es-DO">
      <body>
        <main className="boot">
          <div className="empty error-state" role="alert">
            <strong>Algo salió mal</strong>
            <p>Ocurrió un error inesperado. Tus datos están a salvo.</p>
            {error.digest && <p className="muted mono">Código: {error.digest}</p>}
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={reset}>
                Reintentar
              </button>
              <a href="/" className="btn btn-ghost">
                Ir al inicio
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
