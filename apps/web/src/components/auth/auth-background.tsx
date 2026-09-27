import { preload } from 'react-dom';
import { LOGIN_BG } from './login-bg.meta';

const WEBP = '/brand/login-bg.webp';
const WEBP_SM = '/brand/login-bg-sm.webp';
const JPG = '/brand/login-bg.jpg';
const PHONE = '(max-width: 767px)';
const WIDE = '(min-width: 768px)';

/**
 * Decorative hills photo behind the auth screens; the slow Ken Burns motion lives in CSS (`.auth-bg-image`).
 * Full-viewport images are never Chrome's LCP element, so phones get a lighter file at normal priority to
 * keep bandwidth for the text LCP; wider screens preload the full file at high priority.
 */
export function AuthBackground() {
  preload(WEBP, { as: 'image', type: 'image/webp', fetchPriority: 'high', media: WIDE });
  preload(WEBP_SM, { as: 'image', type: 'image/webp', media: PHONE });
  return (
    <div className="auth-bg" aria-hidden>
      <picture>
        <source srcSet={WEBP_SM} media={PHONE} type="image/webp" />
        <source srcSet={WEBP} type="image/webp" />
        <img className="auth-bg-image" src={JPG} alt="" width={LOGIN_BG.width} height={LOGIN_BG.height} decoding="async" draggable={false} />
      </picture>
    </div>
  );
}
