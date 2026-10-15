'use client';

import Link from 'next/link';
import { useEffect, useRef, type RefObject } from 'react';
import { HeroVideo } from './hero-video';
import { copy } from '@/content/copy.es';
import { HERO_PARALLAX, WORD_STAGGER_MS } from '@/lib/motion-tokens';
import { site } from '@/lib/site';

const PARALLAX_RATIO = Number.parseFloat(HERO_PARALLAX) / 100;

/** Native scroll parallax: an animation library here ended up in the login and checkout bundles through next/link. */
function useHeroParallax(sectionRef: RefObject<HTMLElement | null>, mediaRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const section = sectionRef.current;
    const media = mediaRef.current;
    if (!section || !media) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (reduce.matches) {
        media.style.transform = '';
        return;
      }
      const rect = section.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(rect.height, 1)));
      media.style.transform = `translate3d(0, ${(progress * PARALLAX_RATIO * 100).toFixed(2)}%, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reduce.addEventListener('change', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reduce.removeEventListener('change', schedule);
    };
  }, [sectionRef, mediaRef]);
}

export function Hero({ videoReady }: { videoReady: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const words = copy.hero.title.split(' ');
  useHeroParallax(sectionRef, mediaRef);

  return (
    <section className="mkt-hero" ref={sectionRef} aria-labelledby="hero-title">
      <div className="mkt-hero-media" ref={mediaRef}>
        <HeroVideo videoReady={videoReady} />
      </div>
      <div className="mkt-hero-copy">
        <p className="mkt-kicker">Facilito · {site.maker}</p>
        <h1 id="hero-title">
          {words.map((word, index) => (
            <span key={`${word}-${index}`} className="mkt-word" style={{ animationDelay: `${index * WORD_STAGGER_MS}ms` }}>
              {index > 0 ? ' ' : ''}
              {word}
            </span>
          ))}
        </h1>
        <p className="mkt-hero-lead">{copy.hero.subtitle}</p>
        <div className="mkt-actions">
          <Link className="btn btn-primary" href={site.subscribePath} prefetch={false}>
            {copy.hero.primary}
          </Link>
          <Link className="btn mkt-btn-light" href="/contacto?motivo=demo">
            {copy.hero.secondary}
          </Link>
        </div>
        <p className="mkt-note">{copy.hero.note}</p>
      </div>
    </section>
  );
}
