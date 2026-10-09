import { LegalLayout, LEGAL_UPDATED } from '@/components/marketing/legal-layout';
import { pageMeta } from '@/lib/seo';
import { site } from '@/lib/site';

export const metadata = pageMeta({
  title: 'Privacidad',
  description: 'Política de privacidad de Facilito, alineada con la Ley 172-13 de la República Dominicana.',
  path: '/legal/privacidad',
});

export default function PrivacyPage() {
  return (
    <LegalLayout title="Política de privacidad" updated={LEGAL_UPDATED}>
      <p>
        Esta política describe cómo {site.legalName} («Facilito», «nosotros») trata datos personales en el sitio público y en el panel. El responsable es {site.maker}, en {site.city}, {site.country}. Debe revisarla un asesor antes del lanzamiento.
      </p>
      <h2>Qué datos tratamos</h2>
      <ul>
        <li>Cuenta: nombre, correo, contraseña (almacenada como secreto, no en texto plano) y, si lo activas, un segundo factor.</li>
        <li>Negocio: razón social, RNC o cédula, tipo de negocio. El RNC y la cédula se cifran en reposo.</li>
        <li>Operación: productos, inventario, clientes, proveedores, facturas y reportes que tú cargas.</li>
        <li>Contacto público: nombre, celular, correo, tipo de negocio y mensaje del formulario.</li>
        <li>Técnicos: dirección IP usada para limitar abusos del formulario, y la cookie de sesión después de entrar.</li>
      </ul>
      <h2>Para qué</h2>
      <p>Crear y proteger tu cuenta, operar ventas, inventario y facturación, responder un contacto y evitar abuso del formulario. No vendemos bases de datos ni armamos perfiles publicitarios en este sitio: no hay analítica de terceros instalada.</p>
      <h2>Base</h2>
      <p>
        La cuenta y la operación del negocio se tratan para ejecutar el servicio que pides. El formulario de contacto se trata para responderte. La seguridad (cifrado, límite de intentos, cookie httpOnly) se trata para proteger la cuenta. Cuando una norma fiscal exija conservar comprobantes, esa conservación sigue esa norma.
      </p>
      <h2>Cuánto tiempo</h2>
      <p>Los datos de la cuenta viven mientras la cuenta exista. Las facturas y comprobantes se conservan el tiempo que exija la normativa fiscal dominicana vigente. Los mensajes de contacto se conservan el tiempo necesario para responder y dar seguimiento, y luego se borran o anonimizan.</p>
      <h2>Con quién se comparten</h2>
      <p>Con quien opera el alojamiento y el correo que {site.maker} contrate para prestar el servicio, y con una autoridad cuando una ley dominicana lo exija. No hay cesión comercial a anunciantes.</p>
      <h2>Tus derechos</h2>
      <p>
        La Ley 172-13 reconoce al titular derechos de acceso, rectificación, cancelación y oposición, entre los que la ley enumera. Puedes ejercerlos desde el formulario de contacto o el correo público, indicando tu nombre y el derecho que pides. Responderemos en el plazo que la ley fije y, si no fija uno, en un plazo razonable. También puedes acudir a la vía que esa ley y las normas vigentes reconozcan.
      </p>
      <h2>Seguridad</h2>
      <p>Sesión en cookie httpOnly, cifrado de RNC, cédula y secreto de segundo factor, y cabeceras de seguridad en el sitio. Ninguna medida es absoluta.</p>
      <h2>Cambios</h2>
      <p>Si esta política cambia de forma relevante, actualizamos la fecha de esta página.</p>
    </LegalLayout>
  );
}
