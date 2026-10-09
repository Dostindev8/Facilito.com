'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
const HERO_POSTER = '/media/facilito-hero-poster.webp';

type Conn = { saveData?: boolean; effectiveType?: string };

const FADE_MS = 900;

export function HeroVideo({ videoReady }: { videoReady: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!videoReady) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const connection = (navigator as Navigator & { connection?: Conn }).connection;
    const slow = connection?.saveData === true || /(^|-)2g$/.test(connection?.effectiveType ?? '');
    if (!reduce && !slow) setEnabled(true);
  }, [videoReady]);

  useEffect(() => {
    const video = ref.current;
    if (!enabled || !video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) video.play().catch(() => setPlaying(false));
        else video.pause();
      },
      { threshold: 0.1 },
    );
    observer.observe(video);
    const onVisibility = () => {
      if (document.hidden) video.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return (
    <div className="mkt-hero-fill" aria-hidden="true">
      <Image src={HERO_POSTER} alt="" fill priority unoptimized sizes="100vw" className="mkt-hero-poster" />
      {enabled && (
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="metadata"
          onPlaying={() => setPlaying(true)}
          onError={() => setPlaying(false)}
          className="mkt-hero-video"
          style={{ opacity: playing ? 1 : 0, transition: `opacity ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` }}
        >
          <source src="/media/facilito-hero-1080-loop.webm" type="video/webm" />
          <source src="/media/facilito-hero-1080-loop.mp4" type="video/mp4" media="(min-width: 1024px)" />
          <source src="/media/facilito-hero-720-loop.mp4" type="video/mp4" />
        </video>
      )}
      <div className="mkt-hero-scrim" />
    </div>
  );
}
