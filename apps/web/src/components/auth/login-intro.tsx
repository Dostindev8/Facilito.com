'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LogoMark } from '@/components/brand/logo';

const STORAGE_KEY = 'facilito:intro-seen';
const INTRO_MS = 4000;
const REDUCED_MS = 1200;
const SKIP_VISIBLE_MS = 1000;

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode */
  }
}

/**
 * 4.0 s cinematic brand intro on the login entry (once per session).
 * Animates only opacity/transform; respects prefers-reduced-motion.
 */
export function LoginIntro({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'check' | 'intro' | 'done'>('check');
  const [progress, setProgress] = useState(0);
  const [skipVisible, setSkipVisible] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    if (alreadySeen()) {
      setPhase('done');
      return;
    }
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setPhase('intro');
  }, []);

  useEffect(() => {
    if (phase !== 'intro') return;
    const total = reducedRef.current ? REDUCED_MS : INTRO_MS;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / total);
      if (reducedRef.current) {
        setProgress(t * 100);
        setShowWelcome(t > 0.3);
      } else {
        // Bar advances 1.0s–3.2s of the 4.0s timeline → map to 0–100%.
        const bar = Math.min(1, Math.max(0, (now - started - 1000) / 2200));
        setProgress(bar * 100);
        setShowWelcome(now - started >= 2200);
        if (now - started >= 3400) setLeaving(true);
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    const skipTimer = window.setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_MS);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(skipTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finish = () => {
    markSeen();
    setPhase('done');
    requestAnimationFrame(() => {
      const focusable = loginRef.current?.querySelector<HTMLElement>('input, button, a, [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    });
  };

  if (phase === 'check') return null;

  if (phase === 'done') {
    return (
      <div ref={loginRef} className="login-panel-enter">
        {children}
      </div>
    );
  }

  return (
    <div className={`login-intro${leaving ? ' leaving' : ''}${reducedRef.current ? ' reduced' : ''}`} role="dialog" aria-label="Bienvenida a Facilito">
      <div className="login-intro-bg" aria-hidden>
        <Image src="/brand/login-bg.webp" alt="" fill priority sizes="100vw" className="login-intro-bg-img" />
        <div className="login-intro-veil" />
      </div>
      <div className="login-intro-center">
        <div className="login-intro-logo">
          <LogoMark size={220} priority />
        </div>
        <div className="login-intro-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Cargando Facilito">
          <span style={{ transform: `scaleX(${Math.max(0.02, progress / 100)})` }} />
        </div>
        <div className={`login-intro-copy${showWelcome ? ' on' : ''}`} aria-live="polite">
          <p className="login-intro-title">Bienvenido a Facilito</p>
          <p className="login-intro-tag">Tu negocio, más fácil cada día</p>
        </div>
      </div>
      {skipVisible && (
        <button type="button" className="login-intro-skip" onClick={finish}>
          Saltar
        </button>
      )}
    </div>
  );
}
