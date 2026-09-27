import Image from 'next/image';

export function LogoMark({ size = 40, priority = false }: { size?: number; priority?: boolean }) {
  return <Image src="/brand/facilito-mark.png" alt="" width={size} height={size} priority={priority} className="logo-mark" />;
}

export function Logo({ size = 40, tagline = false, priority = false }: { size?: number; tagline?: boolean; priority?: boolean }) {
  return (
    <span className="logo" role="img" aria-label="Facilito">
      <LogoMark size={size} priority={priority} />
      <span className="logo-text">
        <span className="logo-word" aria-hidden>
          Facilito
        </span>
        {tagline && <span className="logo-tagline">Tu negocio, más fácil</span>}
      </span>
    </span>
  );
}
