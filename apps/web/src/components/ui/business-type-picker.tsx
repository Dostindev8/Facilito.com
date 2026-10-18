'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  BUSINESS_TYPE_CATEGORIES,
  OTHER_BUSINESS_TYPE_SLUG,
  filterBusinessTypeCategories,
  findBusinessTypeByLabel,
  findBusinessTypeBySlug,
} from '@/lib/business-types';
import { businessTypeError, normalizeBusinessType } from '@facilito/domain/business-profile';
import { Field } from './primitives';

export interface BusinessTypeValue {
  businessTypeSlug: string;
  businessTypeCustom: string;
}

/** Maps picker state to the API `tipoNegocio` string. */
export function tipoNegocioFromPicker(v: BusinessTypeValue): string | undefined {
  if (!v.businessTypeSlug) return undefined;
  if (v.businessTypeSlug === OTHER_BUSINESS_TYPE_SLUG) {
    const custom = normalizeBusinessType(v.businessTypeCustom);
    return custom || undefined;
  }
  return findBusinessTypeBySlug(v.businessTypeSlug)?.label;
}

export function pickerFromTipoNegocio(tipo: string): BusinessTypeValue {
  const hit = findBusinessTypeByLabel(tipo);
  if (hit) return { businessTypeSlug: hit.slug, businessTypeCustom: '' };
  if (tipo.trim()) return { businessTypeSlug: OTHER_BUSINESS_TYPE_SLUG, businessTypeCustom: tipo };
  return { businessTypeSlug: '', businessTypeCustom: '' };
}

/**
 * Accessible categorized combobox with search and “Otro (escribir el mío)”.
 * Optional field — empty is valid.
 */
export function BusinessTypePicker({
  value,
  onChange,
  error,
  disabled,
  className,
}: {
  value: BusinessTypeValue;
  onChange: (v: BusinessTypeValue) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOther = value.businessTypeSlug === OTHER_BUSINESS_TYPE_SLUG;
  const selectedLabel = isOther ? '' : (findBusinessTypeBySlug(value.businessTypeSlug)?.label ?? '');
  const display = open ? query : selectedLabel || (isOther ? 'Otro (escribir el mío)' : '');

  const categories = useMemo(() => filterBusinessTypeCategories(query), [query]);
  const flat = useMemo(() => categories.flatMap((c) => c.options.map((o) => ({ ...o, category: c.label }))), [categories]);

  const pick = (slug: string) => {
    onChange({ businessTypeSlug: slug, businessTypeCustom: slug === OTHER_BUSINESS_TYPE_SLUG ? value.businessTypeCustom : '' });
    setOpen(false);
    setQuery('');
    setActive(-1);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + flat.length) % flat.length);
    } else if (e.key === 'Enter' && open && active >= 0 && flat[active]) {
      e.preventDefault();
      pick(flat[active]!.slug);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const customError = isOther && value.businessTypeCustom ? businessTypeError(value.businessTypeCustom) ?? undefined : undefined;
  const showError = error || customError;

  return (
    <div className={className}>
      <Field
        label="Tipo de negocio"
        error={showError}
        hint={showError ? undefined : 'Opcional. Busca por categoría o escribe “Otro”.'}
      >
        {(id, desc) => (
          <div className="combobox business-type-picker">
            <input
              ref={inputRef}
              id={id}
              className="input has-trailing"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
              aria-invalid={!!showError}
              aria-describedby={desc}
              autoComplete="off"
              placeholder="Ej.: Colmado, Barbería…"
              disabled={disabled}
              value={display}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActive(-1);
                if (!e.target.value) onChange({ businessTypeSlug: '', businessTypeCustom: '' });
              }}
              onFocus={() => {
                setQuery(selectedLabel);
                setOpen(true);
              }}
              onKeyDown={onKey}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            />
            <button
              type="button"
              className="combobox-toggle"
              tabIndex={-1}
              aria-label="Mostrar tipos de negocio"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen((o) => !o)}
            >
              <ChevronDown size={18} aria-hidden />
            </button>
            {open && (
              <ul id={listId} role="listbox" className="combobox-list business-type-list">
                {categories.map((cat) => (
                  <li key={cat.id} className="business-type-group" role="presentation">
                    <div className="business-type-group-label" role="presentation">
                      {cat.label}
                    </div>
                    <ul role="group" aria-label={cat.label}>
                      {cat.options.map((o) => {
                        const idx = flat.findIndex((f) => f.slug === o.slug);
                        const selected = value.businessTypeSlug === o.slug;
                        return (
                          <li
                            key={o.slug}
                            id={`${listId}-opt-${idx}`}
                            role="option"
                            aria-selected={selected || active === idx}
                            className={active === idx || selected ? 'active' : ''}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(o.slug)}
                          >
                            {selected && <Check size={14} aria-hidden />}
                            {o.label}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
                {!flat.length && <li className="combobox-empty">Sin coincidencias</li>}
              </ul>
            )}
          </div>
        )}
      </Field>
      {isOther && (
        <TextLike
          label="Describe tu tipo de negocio"
          value={value.businessTypeCustom}
          onChange={(custom) => onChange({ ...value, businessTypeCustom: custom })}
          error={customError}
          disabled={disabled}
          maxLength={60}
        />
      )}
    </div>
  );
}

function TextLike({
  label,
  value,
  onChange,
  error,
  disabled,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  maxLength: number;
}) {
  return (
    <Field label={label} error={error} hint={error ? undefined : 'Entre 2 y 60 caracteres'}>
      {(id, desc) => (
        <input
          id={id}
          className="input"
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={desc}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
