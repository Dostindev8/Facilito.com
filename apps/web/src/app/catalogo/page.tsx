import type { Metadata } from 'next';
import { Logo } from '@/components/brand/logo';

type Props = { searchParams: Promise<{ tenant?: string }> };

export const metadata: Metadata = { title: 'Catálogo', robots: { index: true, follow: true } };

const API = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CatalogItem {
  id: string;
  tipo: string;
  payload: { titulo?: unknown; descripcion?: unknown; precio?: unknown } | null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.slice(0, 500) : null;
}

export default async function PublicCatalogPage({ searchParams }: Props) {
  const { tenant } = await searchParams;
  let items: CatalogItem[] = [];
  let failed = false;
  if (tenant && UUID.test(tenant)) {
    try {
      const res = await fetch(`${API}/v1/public/catalog/${tenant}`, { next: { revalidate: 60 } });
      if (res.ok) items = (await res.json()) as CatalogItem[];
      else failed = true;
    } catch {
      failed = true;
    }
  }

  return (
    <main className="content" style={{ maxWidth: 960 }}>
      <Logo size={48} />
      <div className="page-head">
        <div>
          <h1>Catálogo</h1>
          <p>Contenido publicado por el negocio.</p>
        </div>
      </div>
      {!tenant || !UUID.test(tenant) ? (
        <div className="card empty">
          <strong>Catálogo no encontrado</strong>
          <p>El enlace del catálogo no es válido.</p>
        </div>
      ) : failed ? (
        <div className="card empty">
          <strong>No disponible</strong>
          <p>No pudimos cargar el catálogo en este momento.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <strong>Sin publicaciones</strong>
          <p>Este negocio aún no ha publicado contenido.</p>
        </div>
      ) : (
        <div className="stat-row">
          {items.map((i) => (
            <article key={i.id} className="card">
              <span className="badge badge-green">{i.tipo}</span>
              <h2 style={{ fontSize: '1.05rem', marginTop: 10 }}>{text(i.payload?.titulo) ?? 'Publicación'}</h2>
              {text(i.payload?.descripcion) && <p className="muted">{text(i.payload?.descripcion)}</p>}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
