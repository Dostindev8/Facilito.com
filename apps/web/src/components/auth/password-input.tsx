'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; error?: string; hint?: string };

export function PasswordInput({ label, error, hint, ...rest }: Props) {
  const [show, setShow] = useState(false);
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="input-icon">
        <Lock size={18} aria-hidden />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="input has-trailing"
          aria-invalid={!!error}
          aria-describedby={descId}
          {...rest}
        />
        <button
          type="button"
          className="icon-btn trailing"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={show}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error ? (
        <span id={descId} className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={descId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function passwordStrength(p: string): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  let score = 0;
  if (p.length >= 10) score++;
  if (/[a-záéíóúñ]/.test(p) && /[A-ZÁÉÍÓÚÑ]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñ]/.test(p) || p.length >= 14) score++;
  return Math.max(1, score) as 1 | 2 | 3 | 4;
}

export function StrengthMeter({ value }: { value: string }) {
  const level = passwordStrength(value);
  const labels = ['', 'Débil', 'Regular', 'Buena', 'Fuerte'];
  if (!value) return null;
  return (
    <div>
      <div className="strength" data-level={level} aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="field-hint">Seguridad: {labels[level]}</span>
    </div>
  );
}
