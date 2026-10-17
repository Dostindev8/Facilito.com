import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main className="boot">
      <div style={{ textAlign: 'center', padding: 24, display: 'grid', gap: 12, justifyItems: 'center' }}>
        <LogoMark size={64} />
        <h1 style={{ fontSize: '1.6rem' }}>Esta página no está</h1>
        <p className="muted">La dirección no existe o se movió. Puedes entrar a tu cuenta o ir al sitio web.</p>
        <div className="row">
          <Link href="/login" className="btn btn-primary">
            Iniciar sesión
          </Link>
          <Link href="/suscribirme" className="btn btn-ghost">
            Suscribirme
          </Link>
        </div>
      </div>
    </main>
  );
}
