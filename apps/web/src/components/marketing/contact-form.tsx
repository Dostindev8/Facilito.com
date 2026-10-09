'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { submitContact } from '@/app/(marketing)/contacto/actions';
import { BUSINESS_TYPE_OPTIONS, CONTACT_MOTIVES, contactIdle } from '@/lib/validations/contact-fields';

const MOTIVE_LABEL = { demo: 'Pedir demo', ventas: 'Ventas', soporte: 'Soporte' } as const;

export function ContactForm({ initialMotivo }: { initialMotivo: (typeof CONTACT_MOTIVES)[number] }) {
  const [state, action, pending] = useActionState(submitContact, contactIdle);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [tipoNegocio, setTipoNegocio] = useState('colmado');
  const [motivo, setMotivo] = useState<(typeof CONTACT_MOTIVES)[number]>(initialMotivo);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    if (state.status === 'error') alertRef.current?.focus();
  }, [state]);

  return (
    <form className="mkt-form" action={action} noValidate>
      <div className="mkt-hp" aria-hidden="true">
        <label>
          Sitio web
          <input name="company_website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <label>
        Nombre
        <input name="nombre" required maxLength={80} autoComplete="name" value={nombre} onChange={(event) => setNombre(event.target.value)} aria-invalid={Boolean(state.fieldErrors.nombre)} />
      </label>
      {state.fieldErrors.nombre && <p className="mkt-error">{state.fieldErrors.nombre}</p>}
      <label>
        WhatsApp o celular
        <input
          name="telefono"
          required
          inputMode="tel"
          autoComplete="tel"
          placeholder="809 000 0000"
          value={telefono}
          onChange={(event) => setTelefono(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors.telefono)}
        />
      </label>
      {state.fieldErrors.telefono && <p className="mkt-error">{state.fieldErrors.telefono}</p>}
      <label>
        Correo
        <input name="email" type="email" required autoComplete="email" maxLength={120} value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(state.fieldErrors.email)} />
      </label>
      {state.fieldErrors.email && <p className="mkt-error">{state.fieldErrors.email}</p>}
      <label>
        Tipo de negocio
        <select name="tipoNegocio" value={tipoNegocio} onChange={(event) => setTipoNegocio(event.target.value)}>
          {BUSINESS_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Motivo
        <select name="motivo" value={motivo} onChange={(event) => setMotivo(event.target.value as (typeof CONTACT_MOTIVES)[number])}>
          {CONTACT_MOTIVES.map((item) => (
            <option key={item} value={item}>
              {MOTIVE_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mensaje
        <textarea name="mensaje" required minLength={10} maxLength={1000} value={mensaje} onChange={(event) => setMensaje(event.target.value)} aria-invalid={Boolean(state.fieldErrors.mensaje)} />
      </label>
      {state.fieldErrors.mensaje && <p className="mkt-error">{state.fieldErrors.mensaje}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar mensaje'}
      </button>
      <p ref={alertRef} tabIndex={-1} role="status" aria-live="polite" className={state.status === 'success' ? 'mkt-success' : 'mkt-error'}>
        {state.message}
      </p>
    </form>
  );
}
