# Instagram del negocio

## Qué funciona hoy (v1, sin terceros)

- Registro y **Configuración → Negocio** aceptan el perfil de Instagram (opcional): `@usuario`, `usuario`,
  `instagram.com/usuario` o la URL completa. Se normaliza y guarda solo el handle en minúsculas
  (`app.negocio.instagram_handle`); la URL `https://www.instagram.com/{handle}/` se deriva al leer.
- El dueño completa a mano los datos básicos del negocio (nombre, tipo, dirección, teléfono, email).
- `instagram_connected` queda en `false` e `instagram_last_synced_at` en `null` hasta que exista una conexión OAuth real.
  Cambiar el handle vuelve a poner ambos en su estado inicial.

## Por qué no se "lee" el perfil a partir de la URL

Meta prohíbe el scraping de perfiles en sus Términos y no hay una API pública que devuelva la biografía,
foto o nombre de cualquier cuenta con solo la URL. oEmbed solo describe **una publicación** concreta y también
requiere token de app. El único camino legítimo para datos de perfil es la **Instagram Graph API** con el
consentimiento del propio negocio.

## Qué hace falta para activarlo (🔒 bloqueado por terceros)

1. App registrada en Meta for Developers, con revisión aprobada de los permisos de perfil.
   **TODO: VERIFICAR EN VIVO** el nombre vigente de los scopes y la versión de la Graph API — Meta los cambia a menudo.
2. Cuenta de Instagram **Business o Creator** del negocio y flujo OAuth (Facebook Login / Instagram Login)
   donde el dueño autoriza la conexión.
3. Guardar el token de acceso del negocio **cifrado** (mismo patrón que el RNC: `encryptField`), con renovación
   antes de su vencimiento, y nunca en el bundle del frontend.
4. Variables (`.env`, nunca en git): `FEATURE_INSTAGRAM_OAUTH_ENABLED=true`, `META_APP_ID`, `META_APP_SECRET`,
   `META_GRAPH_API_VERSION`.
5. Implementar `getInstagramBusinessProfile(accessToken)` en `apps/api/src/services/instagram.service.ts`
   (hoy devuelve `null`), marcar `instagram_connected = true` y registrar `instagram_last_synced_at`.

Mientras falte cualquiera de estos puntos, el flujo manual sigue funcionando y el registro nunca se bloquea.
