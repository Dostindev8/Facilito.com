import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main className="boot">
      <div style={{ textAlign: 'center', padding: 24, display: 'grid', gap: 12, justifyItems: 'center' }}>
        <LogoMark size={64} />
        <h1 style={{ fontSize: '1.6rem' }}>Esta página no está</h1>
        <p className="muted">La dirección no existe o se movió. Puedes volver al inicio o entrar a tu cuenta.</p>
        <div className="row">
          <Link href="/" className="btn btn-primary">
            Ir al inicio
          </Link>
          <Link href="/login" className="btn btn-ghost">
            Iniciar sesión
          </Link>
        </div>
      </div>
    </main>
  );
}
