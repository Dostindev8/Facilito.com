'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Field } from './primitives';

interface ComboboxProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Returns the suggestions for the current text; free text is always a valid value. */
  suggest: (query: string) => string[];
  error?: string;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  onBlur?: () => void;
}

/** Editable combobox (WAI-ARIA 1.2): suggestions help, but whatever the user types is kept. */
export function Combobox({ label, value, onChange, suggest, error, hint, placeholder, maxLength, disabled, className, onBlur }: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => suggest(query ?? ''), [suggest, query]);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const show = (q: string | null) => {
    setQuery(q);
    setActive(-1);
    setOpen(true);
  };

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery(null);
    setActive(-1);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show(null);
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]!);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const expanded = open && options.length > 0;

  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, desc) => (
        <div className="combobox">
          <input
            ref={inputRef}
            id={id}
            className="input has-trailing"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            aria-invalid={!!error}
            aria-describedby={desc}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value);
              show(e.target.value);
            }}
            onFocus={() => show(null)}
            onClick={() => !open && show(null)}
            onKeyDown={onKey}
            onBlur={() => {
              setOpen(false);
              onBlur?.();
            }}
          />
          <button
            type="button"
            className="combobox-toggle"
            tabIndex={-1}
            aria-label={expanded ? 'Ocultar sugerencias' : 'Ver sugerencias'}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? setOpen(false) : (inputRef.current?.focus(), show(null)))}
          >
            <ChevronDown size={18} aria-hidden />
          </button>
          <ul id={listId} role="listbox" aria-label={label} className="combobox-list" hidden={!expanded}>
            {options.map((o, i) => (
              <li
                key={o}
                id={optionId(i)}
                role="option"
                aria-selected={o === value}
                className={`combobox-option ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <span>{o}</span>
                {o === value && <Check size={16} aria-hidden />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Field>
  );
}
