import type { ReactNode } from 'react';

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mkt-legal">
      <h1>{title}</h1>
      <p>Última actualización: {updated}. Borrador para revisión legal; no es asesoría.</p>
      {children}
    </article>
  );
}

export const LEGAL_UPDATED = '7 de octubre de 2026';
