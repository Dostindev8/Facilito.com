import { LegalLayout, LEGAL_UPDATED } from '@/components/marketing/legal-layout';
import { pageMeta } from '@/lib/seo';
import { site } from '@/lib/site';

export const metadata = pageMeta({
  title: 'Términos',
  description: 'Términos de uso de Facilito by Logic Code Spot.',
  path: '/legal/terminos',
});

export default function TermsPage() {
  return (
    <LegalLayout title="Términos de uso" updated={LEGAL_UPDATED}>
      <p>
        Al crear una cuenta o usar el sitio de {site.name} aceptas estos términos con {site.maker}. Si no estás de acuerdo, no uses el servicio. Este texto es un borrador y debe revisarlo un asesor antes del lanzamiento.
      </p>
      <h2>El servicio</h2>
      <p>
        Facilito es un panel para ventas, inventario, facturación, clientes, proveedores y reportes. La facturación electrónica ante la DGII (e-CF) no forma parte de lo que el producto entrega hoy. Lo que diga «próximamente» en el sitio no es una obligación de fecha.
      </p>
      <h2>Tu cuenta</h2>
      <p>Eres responsable de la veracidad de los datos del negocio, de guardar tu contraseña y de lo que hagan las personas a las que des acceso. El registro actual no pide tarjeta. Si más adelante hay un plan de pago, se te dirá antes de cobrar.</p>
      <h2>Uso aceptable</h2>
      <p>No uses Facilito para vulnerar sistemas, enviar spam desde el formulario, cargar datos que no te pertenecen o evadir obligaciones fiscales. Podemos suspender una cuenta que abuse del servicio o ponga en riesgo a otros clientes.</p>
      <h2>Tus datos de negocio</h2>
      <p>Los productos, facturas y clientes que cargas son tuyos. Nos das permiso de alojarlos solo para prestarte el servicio. No reclamamos propiedad sobre tu catálogo ni sobre tus ventas.</p>
      <h2>Disponibilidad</h2>
      <p>Buscamos que el panel esté disponible, pero no prometemos un porcentaje de tiempo ni que nunca haya una interrupción. El mantenimiento y los fallos de terceros de alojamiento pueden parar el servicio un rato.</p>
      <h2>Precios</h2>
      <p>Las cifras de la página de precios son referencia y no son una oferta hasta que {site.maker} las confirme por escrito.</p>
      <h2>Responsabilidad</h2>
      <p>
        Facilito es una herramienta. Las declaraciones fiscales, los comprobantes y el cumplimiento ante la DGII siguen siendo responsabilidad de tu negocio. En la medida que la ley dominicana lo permita, no respondemos por lucro cesante ni por decisiones tomadas solo con un reporte.
      </p>
      <h2>Ley aplicable</h2>
      <p>Estos términos se leen bajo las leyes de la República Dominicana. Los tribunales de {site.city} son el fuero, salvo norma imperativa distinta.</p>
    </LegalLayout>
  );
}
