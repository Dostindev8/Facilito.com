import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main className="boot">
      <div style={{ textAlign: 'center', padding: 24 }}>
        <LogoMark size={64} />
        <h1 style={{ fontSize: '1.6rem' }}>Página no encontrada</h1>
        <p className="muted">La dirección no existe o fue movida.</p>
        <Link href="/inicio" className="btn btn-primary">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
