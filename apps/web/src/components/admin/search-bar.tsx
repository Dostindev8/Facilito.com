'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

export function SearchBar({ id, value, onChange, placeholder, children }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className="toolbar" style={{ marginBottom: 16, gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="search" style={{ flex: '1 1 260px' }}>
        <Search size={18} aria-hidden />
        <label htmlFor={id} className="sr-only">
          Buscar
        </label>
        <input id={id} type="search" className="input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} maxLength={100} />
      </div>
      {children}
    </div>
  );
}
