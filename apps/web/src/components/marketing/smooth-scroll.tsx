'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { HEADER_OFFSET_PX } from '@/lib/motion-tokens';

export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({
      autoRaf: true,
      anchors: { offset: -HEADER_OFFSET_PX },
      lerp: 0.12,
      stopInertiaOnNavigate: true,
    });
    return () => lenis.destroy();
  }, []);
  return null;
}
