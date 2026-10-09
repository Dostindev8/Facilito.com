'use client';

export default function MarketingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="boot">
      <div className="empty error-state" role="alert">
        <strong>No pudimos abrir esta página</strong>
        <p>Ocurrió un error inesperado. Tus datos del negocio no se tocaron.</p>
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
  );
}
