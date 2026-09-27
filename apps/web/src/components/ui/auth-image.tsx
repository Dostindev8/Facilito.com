'use client';

import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { apiBlob } from '@/lib/api';

/** Product images require the bearer token, so they are fetched as blobs instead of plain <img src>. */
export function AuthImage({ src, alt, size = 44 }: { src: string | null; alt: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setUrl(null);
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    apiBlob(src)
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return (
    <span className="thumb" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} width={size} height={size} />
      ) : (
        <ImageIcon size={Math.round(size / 2.4)} aria-hidden />
      )}
    </span>
  );
}
