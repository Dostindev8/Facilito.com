'use client';

import { useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { filterBusinessTypes, instagramUrl, parseInstagram } from '@facilito/domain/business-profile';
import { Combobox } from './combobox';
import { Field } from './primitives';

export function BusinessTypeField({
  value,
  onChange,
  error,
  disabled,
  className,
  hint = 'Elige una sugerencia o escribe el tuyo',
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
  hint?: string;
}) {
  const suggest = useCallback((q: string) => filterBusinessTypes(q).map((s) => s.label), []);
  return (
    <Combobox
      label="Tipo de negocio"
      value={value}
      onChange={onChange}
      suggest={suggest}
      error={error}
      hint={error ? undefined : hint}
      placeholder="Ej.: Colmado, Barbería…"
      maxLength={60}
      disabled={disabled}
      className={className}
    />
  );
}

/** Optional Instagram profile: accepts @user, user or a full instagram.com URL and shows the canonical handle. */
export function InstagramField({
  value,
  onChange,
  onError,
  error,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onError: (message: string | undefined) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}) {
  const parsed = parseInstagram(value);
  const normalize = () => {
    if (!parsed.ok) return onError(parsed.error);
    onError(undefined);
    if (parsed.handle && parsed.handle !== value) onChange(parsed.handle);
  };
  return (
    <Field label="Perfil de Instagram del negocio (opcional)" error={error} hint={error ? undefined : 'Tu @usuario o el enlace de tu perfil'} className={className}>
      {(id, desc) => (
        <div className="input-prefix">
          <span className="input-prefix-text" aria-hidden>
            instagram.com/
          </span>
          <input
            id={id}
            className="input"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="tunegocio"
            maxLength={200}
            value={value}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={desc}
            onChange={(e) => {
              onChange(e.target.value);
              if (error) onError(undefined);
            }}
            onBlur={normalize}
          />
          {parsed.ok && parsed.handle && !error && (
            <a className="input-prefix-link" href={instagramUrl(parsed.handle)} target="_blank" rel="noopener noreferrer" aria-label="Abrir perfil de Instagram">
              <ExternalLink size={16} aria-hidden />
            </a>
          )}
        </div>
      )}
    </Field>
  );
}
