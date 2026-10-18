'use client';

import Image from 'next/image';
import { animate } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LogoMark } from '@/components/brand/logo';

const STORAGE_KEY = 'facilito:intro-seen';
/** Full cinematic timeline target (logo → copy → exit → login). */
const INTRO_MS = 5200;
const REDUCED_MS = 600;
const SAFETY_MS = 5600;
const SKIP_VISIBLE_MS = 1200;
/** Progress bar lives only inside the logo phase (0.40s–3.60s). */
const BAR_MOUNT_MS = 400;
const BAR_FILL_MS = 2400;
const BAR_UNMOUNT_MS = 3600;
const COPY_MS = 2800;
const EXIT_MS = 3600;
const LOGIN_HANDOFF_MS = 4400;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

type AnimHandle = { stop: () => void };

/**
 * FacilitoSplash / LoginIntro v2 — cinematic brand intro (once per session).
 * No white pill. Progress track mounts only after the logo phase starts and
 * is removed from the DOM before the login handoff. Motion drives transform/opacity.
 */
export function LoginIntro({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'boot' | 'splash' | 'done'>('boot');
  const [progress, setProgress] = useState(0);
  const [showBar, setShowBar] = useState(false);
  const [showGlow, setShowGlow] = useState(false);
  const [showLogo, setShowLogo] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [skipVisible, setSkipVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const animsRef = useRef<AnimHandle[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    for (const a of animsRef.current) a.stop();
    animsRef.current = [];
  }, []);

  const track = useCallback((handle: AnimHandle) => {
    animsRef.current.push(handle);
    return handle;
  }, []);

  const finishOnce = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimers();
    markSeen();
    setShowBar(false);
    setPhase('done');
    requestAnimationFrame(() => {
      const focusable = loginRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), button:not([disabled]), a, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });
  }, [clearTimers]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('login-intro-active', phase === 'boot' || phase === 'splash');
    return () => {
      document.documentElement.classList.remove('login-intro-active');
    };
  }, [phase]);

  // Logo assemble via Motion imperative API (reliable vs declarative + Next Image).
  useEffect(() => {
    if (!showLogo || !logoRef.current || reducedMotion) return;
    const el = logoRef.current;
    el.style.willChange = 'transform, opacity';
    const handle = animate(
      el,
      { opacity: [0, 1], scale: [0.62, 1], rotate: [-8, 0] },
      { type: 'spring', stiffness: 280, damping: 18, mass: 0.85 },
    );
    track(handle);
    void handle.then(() => {
      el.style.willChange = 'auto';
    });
    return () => handle.stop();
  }, [showLogo, reducedMotion, track]);

  useEffect(() => {
    if (!showCopy || !copyRef.current || reducedMotion) return;
    const el = copyRef.current;
    el.style.willChange = 'transform, opacity';
    const handle = animate(el, { opacity: [0, 1], y: [12, 0] }, { duration: 0.45, ease: [0.22, 1, 0.36, 1] });
    track(handle);
    void handle.then(() => {
      el.style.willChange = 'auto';
    });
    return () => handle.stop();
  }, [showCopy, reducedMotion, track]);

  useEffect(() => {
    if (!leaving || reducedMotion) return;
    const exits: AnimHandle[] = [];
    if (logoRef.current) {
      exits.push(animate(logoRef.current, { opacity: 0, scale: 0.92, y: -18 }, { duration: 0.7, ease: [0.22, 1, 0.36, 1] }));
    }
    if (copyRef.current) {
      exits.push(animate(copyRef.current, { opacity: 0, y: -12, scale: 0.96 }, { duration: 0.55, ease: [0.22, 1, 0.36, 1] }));
    }
    for (const e of exits) track(e);
    return () => {
      for (const e of exits) e.stop();
    };
  }, [leaving, reducedMotion, track]);

  useEffect(() => {
    finishedRef.current = false;
    const reduced = prefersReducedMotion();
    setReducedMotion(reduced);

    if (alreadySeen()) {
      setPhase('done');
      return;
    }

    setPhase('splash');

    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      timersRef.current.push(id);
      return id;
    };

    schedule(() => finishOnce(), SAFETY_MS);
    schedule(() => setSkipVisible(true), SKIP_VISIBLE_MS);

    if (reduced) {
      setShowGlow(true);
      setShowLogo(true);
      setShowCopy(true);
      schedule(() => finishOnce(), REDUCED_MS);
      return () => clearTimers();
    }

    // 0.00–0.40s — landscape + subtle glow only (no bar / no pill).
    setShowGlow(true);

    // Logo first; bar mounts ~120ms later so the track never appears alone.
    schedule(() => setShowLogo(true), BAR_MOUNT_MS);
    schedule(() => {
      setShowBar(true);
      track(
        animate(0, 100, {
          duration: BAR_FILL_MS / 1000,
          ease: [0.22, 1, 0.36, 1],
          onUpdate: (v) => setProgress(v),
          onComplete: () => setProgress(100),
        }),
      );
    }, BAR_MOUNT_MS + 120);

    schedule(() => setShowCopy(true), COPY_MS);

    schedule(() => {
      setShowBar(false);
      setProgress(0);
      setLeaving(true);
    }, BAR_UNMOUNT_MS);

    // Exit window 3.60–4.40; login panel mounts at 4.40 (CSS spring to 5.20).
    schedule(() => finishOnce(), LOGIN_HANDOFF_MS);

    return () => clearTimers();
  }, [finishOnce, clearTimers, track]);

  if (phase === 'boot') {
    return <div className="login-intro-boot" aria-hidden />;
  }

  if (phase === 'done') {
    return (
      <div ref={loginRef} className="login-panel-enter">
        {children}
      </div>
    );
  }

  return (
    <div
      className={`login-intro${leaving ? ' leaving' : ''}${reducedMotion ? ' reduced' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Cargando Facilito"
    >
      <div className="login-intro-bg" aria-hidden>
        <Image src="/brand/login-bg.webp" alt="" fill priority sizes="100vw" className="login-intro-bg-img" />
        <div className="login-intro-veil" />
        {showGlow && <div className="login-intro-glow" />}
      </div>

      <div className="login-intro-center">
        {showLogo && (
          <div
            ref={logoRef}
            className="login-intro-logo"
            style={reducedMotion ? { opacity: 1 } : { opacity: 0, transform: 'scale(0.62) rotate(-8deg)' }}
          >
            <LogoMark size={220} priority />
          </div>
        )}

        {showBar && (
          <div
            className={`login-intro-bar${progress >= 99.5 ? ' is-complete' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="Cargando Facilito"
          >
            <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress / 100))})` }} />
          </div>
        )}

        {showCopy && (
          <div
            ref={copyRef}
            className="login-intro-copy on"
            style={reducedMotion ? { opacity: 1 } : { opacity: 0, transform: 'translateY(12px)' }}
          >
            <p className="login-intro-title">Bienvenido a Facilito</p>
            <p className="login-intro-tag">Tu negocio, más fácil cada día</p>
          </div>
        )}
      </div>

      {skipVisible && (
        <button type="button" className="login-intro-skip" onClick={finishOnce}>
          Saltar
        </button>
      )}

      <span className="sr-only" data-intro-ms={INTRO_MS} data-exit-ms={EXIT_MS}>
        Cargando Facilito
      </span>
    </div>
  );
}
