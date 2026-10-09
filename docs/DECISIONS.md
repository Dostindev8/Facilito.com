# Decisiones — sitio público Facilito

1. El código vive en el monorepo `Projects2/Facilito` (`apps/web`), no en el workspace vacío `Facilito-web`.
2. Next se queda en 15.5.27. La subida a 16.4.0 (última en npm el 7 oct 2026) queda aparte, antes del 21 oct 2026.
3. Sin Tailwind: el marketing usa `marketing.css` bajo `.mkt` y los tokens ya existentes (`--green`, `--ink`, `--orange`).
4. Tipografía del sitio: Poppins, ya self-hosted en el layout raíz. No se suman Plus Jakarta ni Inter para no cargar una tercera y cuarta familia en cada página.
5. `/` deja de redirigir a `/inicio`. El panel sigue en `/inicio`. `/register` redirige a `/login?tab=registro` (el registro real). `/modulos` redirige 308 a `/features`.
6. Las páginas de marketing no leen la cookie de sesión en el servidor. Siguen dinámicas porque el layout raíz llama `headers()` para el nonce de CSP. No se quitó: rompería la CSP del panel.
7. El header usa `useAuth()` solo después de montar, para no desalinear el HTML del servidor.
8. CSP sigue en enforce, la que ya define `middleware.ts`. No se duplicó una CSP Report-Only encima. `media/` queda fuera del matcher para no pasar el video por el middleware.
9. Sin analítica. El aviso de cookies no enciende ningún script. La única cookie de producto es `fc_rt` tras el login.
10. Formulario de contacto: zod en el servidor, honeypot, límite en memoria (5 cada 10 min por IP, no compartido entre instancias). SMTP con nodemailer si hay `SMTP_*`; si no, falla cerrado. `CONTACT_DELIVERY=sink` solo para pruebas.
11. La IP del límite sale de `x-forwarded-for`. Con `TRUST_PROXY=0` un cliente puede falsearla. No es el control principal.
12. Precios de referencia (0 / 16 / 39 USD) visibles como no vigentes. No hay oferta anual.
13. e-CF se dice «próximamente». Google se dice no disponible.
14. Stagger del titular en CSS (solo `transform`) para no esconder el texto ni romper la hidratación. Parallax con `motion` después del mount. Lenis solo en el layout de marketing y no se crea si `prefers-reduced-motion`.
15. El video no se sirve: no está el mp4 fuente ni ffmpeg. `HeroVideo` queda listo y solo monta `<video>` si existen los loops en `public/media`.
16. Contraste del hero: velo navy al 0,72–0,84 sobre el cielo más claro muestreado (rgb 244,250,255) deja el blanco por encima de 4,5:1. El botón naranja del marketing usa texto navy porque el blanco sobre `#f5871f` medía 2,5:1.
17. Enlaces a `/register` y `/login` con `prefetch={false}`: en `next start` local la CSP de producción (`upgrade-insecure-requests`) convierte el prefetch en `https://127.0.0.1` y ensucia la consola.
18. zod no llega al navegador. Constantes y tipos que usa el formulario viven en `lib/validations/contact-fields.ts` (sin zod). zod 4 prueba `new Function` al cargar y eso dispara una violación de `script-src` en la CSP estricta.
19. Metadatos en streaming (comportamiento por defecto de Next 15). Con `htmlLimitedBots: /.*/` Lighthouse SEO subía de 92 a 100, pero el LCP simulado empeoraba ~1,2 s en todas las rutas (home de 91 a 84). Se revirtió. Los bots sociales (`facebookexternalhit`, etc.) reciben `<meta name="description">` en el `<head>`; Googlebot ejecuta JS y lee los metadatos transmitidos.
