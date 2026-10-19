'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { SOON_MODULES } from '@/lib/nav';
import { dateLong } from '@/lib/format';

export default function ModuloProximamentePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const mod = SOON_MODULES[slug];

  if (!mod) {
    return (
      <div className="card soon-card">
        <h1>Módulo no encontrado</h1>
        <p className="muted">Esta ruta no forma parte del plan ERP+ publicado.</p>
        <Link href="/inicio" className="btn btn-primary">
          <ArrowLeft size={16} /> Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="soon-wrap">
      <div className="page-head">
        <div>
          <h1>{mod.title}</h1>
          <p>Próximamente en Facilito — sin botones rotos ni falsas promesas.</p>
        </div>
      </div>
      <section className="card soon-card">
        <span className="soon-badge">
          <CalendarClock size={16} aria-hidden /> Disponible estimado: {dateLong(mod.date)}
        </span>
        <p>{mod.detail}</p>
        <p className="muted">
          Extendemos Facilito sin romper lo que ya usas. Cuando este módulo esté listo, este enlace abrirá la pantalla real
          con el mismo diseño claro y verde de marca.
        </p>
        <div className="soon-actions">
          <Link href="/inicio" className="btn btn-secondary">
            <ArrowLeft size={16} /> Inicio
          </Link>
          {mod.relatedHref && (
            <Link href={mod.relatedHref} className="btn btn-primary">
              {mod.relatedLabel ?? 'Continuar'}
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
