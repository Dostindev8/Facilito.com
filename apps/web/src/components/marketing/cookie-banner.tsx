'use client';

import { useEffect, useId, useState } from 'react';

const KEY = 'facilito-consent';
type Choice = 'accepted' | 'rejected';

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const titleId = useId();

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const save = (choice: Choice) => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* private mode: hide for this view only */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="mkt-cookie" role="dialog" aria-labelledby={titleId} aria-live="polite">
      <p id={titleId}>
        <strong>Cookies.</strong> Este sitio de presentación no carga analítica de terceros. La cookie de sesión solo aparece después de entrar al panel.
      </p>
      {configuring && (
        <p>
          Medición de uso: desactivada. No hay una herramienta de analítica instalada, así que no hay nada que encender.
        </p>
      )}
      <div className="mkt-cookie-actions">
        <button type="button" className="btn btn-primary" onClick={() => save('accepted')}>
          Aceptar
        </button>
        <button type="button" className="btn btn-outline" onClick={() => save('rejected')}>
          Rechazar
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setConfiguring((value) => !value)}>
          Configurar
        </button>
      </div>
    </div>
  );
}
