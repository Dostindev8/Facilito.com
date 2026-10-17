import { LegalLayout, LEGAL_UPDATED } from '@/components/marketing/legal-layout';
import { pageMeta } from '@/lib/seo';

export const metadata = pageMeta({
  title: 'Cookies',
  description: 'Qué cookies usa Facilito y cuáles no están instaladas.',
  path: '/legal/cookies',
});

export default function CookiesPage() {
  return (
    <LegalLayout title="Política de cookies" updated={LEGAL_UPDATED}>
      <p>Esta página dice qué se guarda en tu navegador. Es un borrador para revisión legal.</p>
      <h2>Esenciales</h2>
      <p>
        Después de iniciar sesión, el panel usa una cookie httpOnly de refresco (fc_rt), con SameSite estricto, para mantener la sesión. No se lee desde JavaScript. Sin ella no puedes permanecer dentro del panel. El sitio público de presentación no la necesita para verse.
      </p>
      <h2>Preferencia</h2>
      <p>Si aceptas o rechazas el aviso, guardamos esa elección en el almacenamiento local del navegador (no es una cookie de terceros) para no volver a preguntarte en el mismo dispositivo.</p>
      <h2>Analítica y publicidad</h2>
      <p>No hay Google Analytics, píxeles publicitarios ni analítica de Vercel instalados en esta versión. Nada de eso carga antes ni después del aviso, porque no está conectado.</p>
      <h2>Cómo decidir</h2>
      <p>Puedes aceptar, rechazar o abrir «Configurar» en el aviso. Rechazar no apaga la cookie de sesión del panel: sin ella el acceso no funciona. Puedes borrar las cookies desde tu navegador.</p>
    </LegalLayout>
  );
}
