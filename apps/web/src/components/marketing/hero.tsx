'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { HeroVideo } from './hero-video';
import { copy } from '@/content/copy.es';
import { HERO_PARALLAX, WORD_STAGGER_MS } from '@/lib/motion-tokens';
import { site } from '@/lib/site';

export function Hero({ videoReady }: { videoReady: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [parallax, setParallax] = useState(false);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['0%', HERO_PARALLAX]);
  const words = copy.hero.title.split(' ');

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setParallax(!media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  return (
    <section className="mkt-hero" ref={sectionRef} aria-labelledby="hero-title">
      <motion.div className="mkt-hero-media" style={parallax ? { y } : undefined}>
        <HeroVideo videoReady={videoReady} />
      </motion.div>
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
          <Link className="btn btn-primary" href={site.registerPath} prefetch={false}>
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
