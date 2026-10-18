'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { ArrowLeft, ArrowRight, CircleCheck, Clock, Copy, MailCheck, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { businessTypeError } from '@facilito/domain/business-profile';
import { OTHER_BUSINESS_TYPE_SLUG } from '@facilito/domain/business-types';
import { validateRdPhone, validateRncOrCedula } from '@facilito/domain/rnc';
import { ApiError, errorMessage, publicGet, publicPost, publicUpload, type SubscriptionState } from '@/lib/api';
import { BankCard, dop, ReceiptPicker, StateBadge, type BankInstructions } from '@/components/billing/billing-ui';
import { PlanBenefits, PlanComparison, PlanSummaryBar, PlanTrust } from '@/components/billing/plan-extras';
import { BusinessTypePicker, tipoNegocioFromPicker, type BusinessTypeValue } from '@/components/ui/business-type-picker';
import { Skeleton, Spinner, TextInput, fieldErrorMap } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { catalogAsApiItems, enrichPlan, getPlan } from '@/lib/plans';
import { site } from '@/lib/site';

type ApplicantForm = {
  nombre: string;
  email: string;
  telefono: string;
  razonSocial: string;
  rnc: string;
  businessType: BusinessTypeValue;
  terminos: boolean;
};

const emptyApplicant = (): ApplicantForm => ({
  nombre: '',
  email: '',
  telefono: '',
  razonSocial: '',
  rnc: '',
  businessType: { businessTypeSlug: '', businessTypeCustom: '' },
  terminos: false,
});

interface PlanOption {
  id: string;
  nombre: string;
  descripcion: string;
  precioMensualCentavos: number;
  moneda: string;
  maxUsuarios: number;
  maxProductos: number | null;
  copilot: boolean;
}

interface Checkout {
  id: string;
  token: string;
  montoCentavos: number;
  moneda: string;
  referenciaSugerida: string;
  instrucciones: BankInstructions | null;
  plan: { id: string; nombre: string };
}

interface RequestStatus {
  estado: SubscriptionState;
  plan: string;
  montoCentavos: number;
  moneda: string;
  motivo: string | null;
  comprobantes: number;
  creada: string;
  instrucciones: BankInstructions | null;
}

interface Saved {
  id: string;
  token: string;
}

const STORAGE_KEY = 'facilito:solicitud';
const PLANS_CACHE_KEY = 'facilito:plans-cache';
const tokenHeader = (s: Saved) => ({ 'x-solicitud-token': s.token });

type PlansPayload = { items: PlanOption[]; metodos: { transferencia: boolean; tarjeta: boolean } };

function readPlansCache(): PlansPayload | null {
  try {
    const raw = sessionStorage.getItem(PLANS_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlansPayload;
    return Array.isArray(v?.items) ? v : null;
  } catch {
    return null;
  }
}

function writePlansCache(data: PlansPayload) {
  try {
    sessionStorage.setItem(PLANS_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* private mode */
  }
}

function plansErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (error.code === 'network' || error.isNetwork) {
    return 'No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.';
  }
  if (error.code === 'timeout') {
    return 'El servidor tardó demasiado. Revisa tu conexión e intenta de nuevo.';
  }
  if (error.status === 404) {
    return 'No encontramos el catálogo de planes. Actualiza la página o escríbenos desde el sitio web.';
  }
  if (error.status === 503 || error.code === 'plans_unavailable' || error.code === 'unavailable') {
    return 'El catálogo de planes no está disponible ahora. Intenta en unos minutos.';
  }
  if (error.status >= 500) {
    return 'El servicio de planes falló. Intenta de nuevo en unos segundos.';
  }
  return error.detail || 'No pudimos cargar los planes.';
}

async function fetchPlansWithBackoff(): Promise<PlansPayload> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await publicGet<PlansPayload>('/v1/billing/plans');
    } catch (e) {
      last = e;
      const retryable =
        e instanceof ApiError && (e.isNetwork || e.code === 'timeout' || e.status >= 500 || e.code === 'plans_unavailable');
      if (!retryable || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw last;
}

function readSaved(): Saved | null {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get('s');
  if (hash) {
    const [id, token] = hash.split('.');
    if (id && token) return { id, token };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    return v?.id && v.token ? { id: v.id, token: v.token } : null;
  } catch {
    return null;
  }
}

function save(s: Saved | null) {
  try {
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: the shareable link still works */
  }
}

const statusLink = (s: Saved) => `${window.location.origin}/suscribirme?ver=estado#s=${s.id}.${s.token}`;

const STEPS = ['Plan', 'Tus datos', 'Pago', 'Aprobación'] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="checkout-steps" aria-label="Pasos de la suscripción">
      {STEPS.map((label, i) => (
        <li key={label} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
          <span aria-hidden>{i < current ? <CircleCheck size={16} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function SubscribeFlow() {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [step, setStep] = useState<'plan' | 'datos'>('plan');
  const [missing, setMissing] = useState(false);
  const [applicant, setApplicant] = useState<ApplicantForm>(emptyApplicant);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = readSaved();
    if (s) save(s);
    setSaved(s);
    setMissing(!s && params.get('ver') === 'estado');
    const p = params.get('plan');
    if (p) {
      setPlan(p);
      setStep('datos');
    }
  }, []);

  const startOver = () => {
    save(null);
    setSaved(null);
    setCheckout(null);
    setStep('plan');
    window.history.replaceState(null, '', '/suscribirme');
  };

  if (saved === undefined) {
    return (
      <>
        <Stepper current={0} />
        <PlansSkeleton />
      </>
    );
  }

  if (checkout) {
    return <PaymentStep checkout={checkout} onUploaded={() => setCheckout(null)} />;
  }
  if (saved) return <StatusView saved={saved} onStartOver={startOver} />;

  const catalogPlan = plan ? getPlan(plan) : undefined;

  return (
    <>
      <Stepper current={step === 'plan' ? 0 : 1} />
      {catalogPlan && step === 'datos' && <PlanSummaryBar plan={catalogPlan} />}
      {step === 'plan' ? (
        <PlanStep
          selected={plan}
          showMissingBanner={missing}
          onSelect={(id) => {
            setPlan(id);
            setStep('datos');
            setMissing(false);
            requestAnimationFrame(() => document.getElementById('checkout-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}
        />
      ) : (
        <DetailsStep
          planId={plan}
          form={applicant}
          setForm={setApplicant}
          onBack={() => setStep('plan')}
          onCreated={(c) => {
            const s = { id: c.id, token: c.token };
            save(s);
            setSaved(s);
            setCheckout(c);
            window.history.replaceState(null, '', '/suscribirme?ver=estado');
          }}
        />
      )}
    </>
  );
}

function usePlans() {
  const [data, setData] = useState<PlansPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setError(null);
    setLoading(true);
    const cached = readPlansCache();
    if (cached?.items.length) {
      setData(cached);
      setStale(true);
    }
    fetchPlansWithBackoff()
      .then((fresh) => {
        writePlansCache(fresh);
        setData(fresh);
        setStale(false);
        setError(null);
      })
      .catch((e) => {
        // Catalog fallback keeps checkout usable when Neon billing schema is not migrated yet.
        const fallback = { items: catalogAsApiItems(), metodos: { transferencia: true, tarjeta: false } };
        if (cached?.items.length) {
          setData(cached);
          setStale(true);
          setError(null);
        } else {
          setData(fallback);
          setStale(true);
          setError(null);
        }
        void e;
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  return { data, error, stale, loading, reload: load };
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="form-alert warn" role="alert">
      <TriangleAlert size={18} />
      <span>
        {plansErrorMessage(error)}{' '}
        <button type="button" className="link-btn" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden /> Reintentar
        </button>
      </span>
    </div>
  );
}

function MissingRequestBanner() {
  return (
    <div className="form-alert info" role="status" style={{ marginTop: 20 }}>
      <Clock size={18} aria-hidden />
      <span>
        Este dispositivo no tiene una solicitud guardada. Abre el enlace privado que copiaste al suscribirte, o escríbenos desde el{' '}
        <a href={site.marketingUrl} rel="noopener noreferrer">
          sitio web
        </a>
        .
      </span>
    </div>
  );
}

/** Sized like a rendered plan card so the footer does not jump when plans arrive (CLS). */
function PlansSkeleton() {
  return (
    <div className="mkt-prices checkout-plans" aria-busy="true">
      <Skeleton h={350} r={20} />
      <Skeleton h={350} r={20} />
      <Skeleton h={350} r={20} />
    </div>
  );
}

function PlanStep({
  selected,
  onSelect,
  showMissingBanner,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  showMissingBanner: boolean;
}) {
  const plans = usePlans();
  // One banner at a time: plan load errors beat the "missing request" info banner.
  if (plans.error) return <LoadError error={plans.error} onRetry={plans.reload} />;
  if (!plans.data || (plans.loading && !plans.data.items.length)) return <PlansSkeleton />;
  if (plans.data.items.length === 0) {
    return (
      <div className="form-alert warn" role="status">
        <TriangleAlert size={18} />
        <span>
          No hay planes publicados ahora.{' '}
          <button type="button" className="link-btn" onClick={plans.reload}>
            <RefreshCw size={14} aria-hidden /> Reintentar
          </button>
          {' · '}
          <a href={site.marketingUrl} rel="noopener noreferrer">
            Contactar
          </a>
        </span>
      </div>
    );
  }
  return (
    <>
      {showMissingBanner ? (
        <MissingRequestBanner />
      ) : plans.stale ? (
        <div className="form-alert info" role="status" style={{ marginTop: 20 }}>
          <Clock size={18} aria-hidden />
          <span>Mostrando la última lista guardada; puede estar desactualizada.</span>
        </div>
      ) : null}
      <div className="mkt-prices checkout-plans">
        {plans.data.items.map((p) => {
          const enriched = enrichPlan(p);
          const featured = 'destacado' in enriched ? enriched.destacado : p.id === 'profesional' || selected === p.id;
          return (
            <article key={p.id} className={`mkt-price${featured || selected === p.id ? ' featured' : ''}`}>
              <h2>{p.nombre}</h2>
              <strong>
                {dop(p.precioMensualCentavos, p.moneda)}
                <span style={{ fontSize: '1rem', fontWeight: 600 }}> / mes</span>
              </strong>
              <p>{p.descripcion}</p>
              <ul>
                <li>Hasta {p.maxUsuarios} usuarios</li>
                <li>{p.maxProductos ? `Hasta ${p.maxProductos.toLocaleString('es-DO')} productos` : 'Productos ilimitados'}</li>
                {p.copilot && <li>Asistente Copilot</li>}
                {'soportePrioritario' in enriched && enriched.soportePrioritario && <li>Prioridad en soporte</li>}
              </ul>
              <button type="button" className="btn btn-primary btn-block" onClick={() => onSelect(p.id)}>
                Elegir {p.nombre}
              </button>
            </article>
          );
        })}
      </div>
      <PlanBenefits />
      <PlanComparison />
      <PlanTrust />
    </>
  );
}

function DetailsStep({
  planId,
  form,
  setForm,
  onBack,
  onCreated,
}: {
  planId: string | null;
  form: ApplicantForm;
  setForm: Dispatch<SetStateAction<ApplicantForm>>;
  onBack: () => void;
  onCreated: (c: Checkout) => void;
}) {
  const plans = usePlans();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof ApplicantForm>(k: K, v: ApplicantForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const plan = plans.data?.items.find((p) => p.id === planId) ?? (planId ? catalogAsApiItems().find((p) => p.id === planId) : null) ?? null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.nombre.trim().length < 2) e.nombre = 'Escribe tu nombre';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Email inválido';
    const phoneErr = validateRdPhone(form.telefono);
    if (phoneErr) e.telefono = phoneErr;
    if (form.razonSocial.trim().length < 2) e.razonSocial = 'Escribe el nombre de tu negocio';
    const rnc = validateRncOrCedula(form.rnc);
    if (!rnc.ok) e.rnc = rnc.error;
    if (form.businessType.businessTypeSlug === OTHER_BUSINESS_TYPE_SLUG) {
      const te = businessTypeError(form.businessType.businessTypeCustom);
      if (te) e.tipoNegocio = te;
    }
    if (!form.terminos) e.aceptaTerminos = 'Debes aceptar los términos y la política de privacidad';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (!planId) return onBack();
    setBusy(true);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const tipoNegocio = tipoNegocioFromPicker(form.businessType);
      const c = await publicPost<Checkout>(
        '/v1/billing/checkout',
        {
          planId,
          nombre: form.nombre.trim(),
          email: form.email.trim(),
          ...(form.telefono.trim() ? { telefono: form.telefono.trim() } : {}),
          razonSocial: form.razonSocial.trim(),
          rnc: form.rnc,
          ...(tipoNegocio ? { tipoNegocio } : {}),
          aceptaTerminos: true,
        },
        { 'idempotency-key': idempotencyKey },
      );
      onCreated(c);
    } catch (err) {
      setErrors(fieldErrorMap(err));
      setError({ message: errorMessage(err), code: err instanceof ApiError ? err.code : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="checkout-form" ref={formRef} method="post" className="checkout-card stack" onSubmit={submit} noValidate>
      <div className="checkout-plan-line">
        <span>
          Plan elegido: <strong>{plan ? plan.nombre : planId ?? '—'}</strong>
          {plan && <> · {dop(plan.precioMensualCentavos, plan.moneda)} al mes</>}
        </span>
        <button type="button" className="link-btn" onClick={onBack}>
          Cambiar plan
        </button>
      </div>
      {plans.data && planId && !plan && (
        <div className="form-alert warn" role="alert">
          <TriangleAlert size={18} /> <span>Ese plan no está disponible. Elige otro.</span>
        </div>
      )}
      {error && (
        <div className="form-alert" role="alert">
          <TriangleAlert size={18} />
          <span>
            {error.message}{' '}
            {error.code === 'email_taken' && <Link href="/login">Iniciar sesión</Link>}
            {error.code === 'request_open' && <Link href="/suscribirme?ver=estado">Ver mi solicitud</Link>}
          </span>
        </div>
      )}
      <h2 className="checkout-h">Tus datos</h2>
      <div className="form-grid">
        <TextInput label="Tu nombre" required autoComplete="name" maxLength={120} value={form.nombre} onChange={(e) => set('nombre', e.target.value)} error={errors.nombre} />
        <TextInput
          label="Correo electrónico"
          required
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={320}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          hint="Aquí te enviamos el enlace para activar tu cuenta"
        />
      </div>
      <TextInput
        label="WhatsApp o teléfono"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={25}
        value={form.telefono}
        onChange={(e) => set('telefono', e.target.value)}
        error={errors.telefono}
        hint="Opcional. Para avisarte cuando aprobemos el pago."
        placeholder="809-555-0000"
      />
      <h2 className="checkout-h">Tu negocio</h2>
      <TextInput label="Nombre del negocio" required autoComplete="organization" maxLength={200} value={form.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} error={errors.razonSocial} />
      <TextInput
        label="RNC o cédula"
        required
        inputMode="numeric"
        maxLength={13}
        value={form.rnc}
        onChange={(e) => set('rnc', e.target.value.replace(/[^\d-\s]/g, ''))}
        error={errors.rnc}
        placeholder="1-01-00000-1"
      />
      <BusinessTypePicker value={form.businessType} onChange={(v) => set('businessType', v)} error={errors.tipoNegocio} />
      <label className={`check ${errors.aceptaTerminos ? 'has-error' : ''}`}>
        <input type="checkbox" checked={form.terminos} onChange={(e) => set('terminos', e.target.checked)} aria-invalid={!!errors.aceptaTerminos} />
        <span>
          Acepto los{' '}
          <Link href="/legal/terminos" target="_blank">
            términos de uso
          </Link>{' '}
          y la{' '}
          <Link href="/legal/privacidad" target="_blank">
            política de privacidad
          </Link>
          .
        </span>
      </label>
      {errors.aceptaTerminos && (
        <span className="field-error" role="alert">
          {errors.aceptaTerminos}
        </span>
      )}
      <div className="checkout-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft size={18} aria-hidden /> Planes
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || (!!plans.data && !plan)}>
          {busy ? <Spinner size={18} /> : null} Continuar al pago {!busy && <ArrowRight size={18} aria-hidden />}
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Todavía no se crea tu cuenta: primero verificamos el pago. No te pedimos tarjeta.
      </p>
    </form>
  );
}

function UploadReceipt({ saved, onUploaded, cta = 'Enviar comprobante' }: { saved: Saved; onUploaded: () => void; cta?: string }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!file) {
      setError('Elige la foto o el PDF del comprobante.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      await publicUpload(`/v1/billing/checkout/${saved.id}/comprobante`, fd, tokenHeader(saved));
      toast.success('Comprobante recibido', 'Te avisaremos cuando lo verifiquemos.');
      setFile(null);
      onUploaded();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <ReceiptPicker
        file={file}
        disabled={busy}
        error={error}
        onChange={(f, err) => {
          setFile(f);
          setError(err);
        }}
      />
      <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !file}>
        {busy ? <Spinner size={18} /> : <Send size={18} aria-hidden />} {cta}
      </button>
    </div>
  );
}

function ShareLink({ saved }: { saved: Saved }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(statusLink(saved));
      toast.success('Enlace copiado', 'Guárdalo para ver el estado desde otro dispositivo.');
    } catch {
      toast.info('Copia este enlace', statusLink(saved));
    }
  };
  return (
    <p className="muted checkout-share">
      Este dispositivo recuerda tu solicitud. Para verla desde otro,{' '}
      <button type="button" className="link-btn" onClick={copy}>
        <Copy size={14} aria-hidden /> copia el enlace privado
      </button>
      .
    </p>
  );
}

function PaymentStep({ checkout, onUploaded }: { checkout: Checkout; onUploaded: () => void }) {
  const saved = { id: checkout.id, token: checkout.token };
  const monto = dop(checkout.montoCentavos, checkout.moneda);
  return (
    <>
      <Stepper current={2} />
      <div className="checkout-card stack">
        <h2 className="checkout-h">Paga {monto} por transferencia</h2>
        <p className="muted">
          Plan {checkout.plan.nombre}. Usa <strong>{checkout.referenciaSugerida}</strong> como concepto para que encontremos tu pago rápido.
        </p>
        {checkout.instrucciones ? (
          <BankCard banco={checkout.instrucciones} monto={monto} referencia={checkout.referenciaSugerida} />
        ) : (
          <div className="form-alert warn" role="alert">
            <TriangleAlert size={18} /> <span>Los datos bancarios no están disponibles en este momento. Escríbenos por el formulario de contacto.</span>
          </div>
        )}
        <h2 className="checkout-h">Sube el comprobante</h2>
        <UploadReceipt saved={saved} onUploaded={onUploaded} />
        <ShareLink saved={saved} />
      </div>
    </>
  );
}

const STATE_STEP: Partial<Record<SubscriptionState, number>> = { PENDIENTE_PAGO: 2, PENDIENTE_AUTORIZACION: 3 };

function StatusView({ saved, onStartOver }: { saved: Saved; onStartOver: () => void }) {
  const [data, setData] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    publicGet<RequestStatus>(`/v1/billing/checkout/${saved.id}`, tokenHeader(saved)).then(setData, setError);
  }, [saved]);
  useEffect(load, [load]);

  if (error) {
    const gone = error instanceof ApiError && (error.status === 404 || error.status === 400);
    return gone ? (
      <div className="checkout-card stack">
        <div className="form-alert warn" role="alert">
          <TriangleAlert size={18} /> <span>No encontramos esa solicitud. El enlace puede estar incompleto.</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={onStartOver}>
          Empezar una solicitud nueva
        </button>
      </div>
    ) : (
      <LoadError error={error} onRetry={load} />
    );
  }
  if (!data) return <Skeleton h={320} />;

  const step = STATE_STEP[data.estado] ?? 4;
  const monto = dop(data.montoCentavos, data.moneda);
  return (
    <>
      <Stepper current={step} />
      <div className="checkout-card stack" aria-live="polite">
        <div className="checkout-plan-line">
          <span>
            Plan <strong>{data.plan}</strong> · {monto} al mes
          </span>
          <StateBadge estado={data.estado} />
        </div>

        {data.estado === 'PENDIENTE_PAGO' && (
          <>
            <h2 className="checkout-h">Falta tu comprobante</h2>
            <p className="muted">Transfiere {monto} y sube la foto o el PDF del comprobante.</p>
            {data.instrucciones && <BankCard banco={data.instrucciones} monto={monto} />}
            <UploadReceipt saved={saved} onUploaded={load} />
          </>
        )}

        {data.estado === 'PENDIENTE_AUTORIZACION' && (
          <>
            <div className="status-hero">
              <Clock size={32} aria-hidden />
              <h2>Estamos verificando tu pago</h2>
              <p>
                Recibimos {data.comprobantes === 1 ? 'tu comprobante' : `${data.comprobantes} comprobantes`}. Cuando confirmemos la transferencia te enviaremos un enlace para crear tu contraseña.
              </p>
            </div>
            <details className="checkout-more">
              <summary>¿Te equivocaste de archivo? Envía otro</summary>
              <UploadReceipt saved={saved} onUploaded={load} cta="Enviar otro comprobante" />
            </details>
            <button type="button" className="btn btn-outline" onClick={load}>
              <RefreshCw size={16} aria-hidden /> Actualizar estado
            </button>
          </>
        )}

        {(data.estado === 'ACTIVA' || data.estado === 'EN_GRACIA') && (
          <div className="status-hero ok">
            <MailCheck size={32} aria-hidden />
            <h2>¡Tu pago fue aprobado!</h2>
            <p>Te enviamos un enlace para crear tu contraseña. Revisa tu correo (y la carpeta de spam) o tu WhatsApp.</p>
            <Link href="/login" className="btn btn-primary">
              Ya tengo contraseña: iniciar sesión
            </Link>
          </div>
        )}

        {data.estado === 'RECHAZADA' && (
          <div className="status-hero bad">
            <TriangleAlert size={32} aria-hidden />
            <h2>No pudimos aprobar la solicitud</h2>
            {data.motivo && <p>Motivo: {data.motivo}</p>}
            <p>Si transferiste, te devolvemos el dinero. Escríbenos para resolverlo.</p>
            <div className="checkout-actions">
              <a href={site.marketingUrl} className="btn btn-outline" rel="noopener noreferrer">
                Contactar
              </a>
              <button type="button" className="btn btn-primary" onClick={onStartOver}>
                Nueva solicitud
              </button>
            </div>
          </div>
        )}

        {(data.estado === 'SUSPENDIDA' || data.estado === 'CANCELADA') && (
          <div className="status-hero">
            <h2>Esta suscripción ya no está activa</h2>
            <p>
              Si ya tienes cuenta, <Link href="/login">inicia sesión</Link> para ver tu suscripción.
            </p>
          </div>
        )}

        <ShareLink saved={saved} />
      </div>
    </>
  );
}
