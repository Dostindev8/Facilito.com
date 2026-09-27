'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <div className="empty error-state" role="alert">
        <div className="empty-icon">
          <TriangleAlert size={26} />
        </div>
        <strong>Algo salió mal</strong>
        <p>Ocurrió un error inesperado en esta sección. Tus datos están a salvo.</p>
        <button type="button" className="btn btn-outline" onClick={reset}>
          <RefreshCw size={16} /> Reintentar
        </button>
      </div>
    </div>
  );
}
