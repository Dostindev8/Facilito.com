import Image from 'next/image';

/**
 * Single loading indicator for the app: splash (`screen`) and in-shell route transitions.
 * It fades in after 150 ms so fast loads never flash, and disappears as soon as content is ready.
 */
export function AppLoadingLogo({ screen = false, label = 'Cargando Facilito…' }: { screen?: boolean; label?: string }) {
  return (
    <div className={`app-loading${screen ? ' screen' : ''}`} role="status" aria-live="polite">
      <span className="app-loading-mark">
        <Image src="/brand/facilito-mark.png" alt="" width={64} height={64} priority />
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
