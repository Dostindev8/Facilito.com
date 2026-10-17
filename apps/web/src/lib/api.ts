'use client';

export type Role = 'owner' | 'manager' | 'cashier' | 'warehouse' | 'accountant' | 'viewer';

export interface SessionUser {
  personaId: string;
  nombre: string;
  email: string;
  tenantId: string;
  accesoId: string;
  rol: Role;
  negocio: string;
  businesses: Array<{ tenantId: string; rol: Role; razonSocial: string }>;
  platformAdmin?: boolean;
  /** True only when this session was opened with a TOTP code. Platform routes require it. */
  mfa?: boolean;
  suscripcion?: SubscriptionSummary | null;
}

export type SubscriptionState =
  | 'PENDIENTE_PAGO'
  | 'PENDIENTE_AUTORIZACION'
  | 'ACTIVA'
  | 'EN_GRACIA'
  | 'SUSPENDIDA'
  | 'CANCELADA'
  | 'RECHAZADA';

export interface SubscriptionSummary {
  estado: SubscriptionState;
  plan: string;
  periodoFin: string | null;
  cancelarAlFinal: boolean;
  soloLectura: boolean;
}

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail: string,
    public readonly code?: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(detail);
  }

  get fieldErrors(): FieldError[] {
    const errs = this.body?.errors;
    return Array.isArray(errs) ? (errs as FieldError[]) : [];
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const CSRF_HEADER = { 'x-facilito-csrf': '1' } as const;

let accessToken: string | null = null;
let refreshInFlight: Promise<SessionUser | null> | null = null;
type SessionListener = (user: SessionUser | null) => void;
const listeners = new Set<SessionListener>();

export function onSessionChange(fn: SessionListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(user: SessionUser | null) {
  for (const fn of listeners) fn(user);
}

export function setSession(token: string | null, user: SessionUser | null) {
  accessToken = token;
  emit(user);
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = undefined;
  }
  if (typeof body?.detail !== 'string' && res.status >= 500) {
    return new ApiError(res.status, 'Servicio no disponible', 'El servicio no respondió. Intenta de nuevo en unos segundos.', 'unavailable', body);
  }
  return new ApiError(
    res.status,
    typeof body?.title === 'string' ? body.title : 'Error',
    typeof body?.detail === 'string' ? body.detail : 'Ocurrió un error. Intenta de nuevo.',
    typeof body?.code === 'string' ? body.code : undefined,
    body,
  );
}

const NETWORK_ERROR = () =>
  new ApiError(0, 'Sin conexión', 'No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.', 'network');

const TIMEOUT_ERROR = () =>
  new ApiError(0, 'El servidor tardó demasiado', 'La solicitud tardó más de lo normal. Revisa tu conexión e intenta de nuevo.', 'timeout');

/** Without a deadline a hung request leaves screens on "Cargando…" forever. Uploads get more time. */
const REQUEST_TIMEOUT_MS = 25_000;
const UPLOAD_TIMEOUT_MS = 90_000;

async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  // Manual controller: AbortSignal.any/timeout are missing on iOS Safari < 17.4.
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const outer = init.signal;
  const forward = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', forward, { once: true });
  }
  try {
    return await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) throw TIMEOUT_ERROR();
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw NETWORK_ERROR();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

function hasSessionHint(): boolean {
  return typeof document !== 'undefined' && document.cookie.split('; ').includes('fc_s=1');
}

async function doRefresh(): Promise<SessionUser | null> {
  const run = async () => {
    if (!hasSessionHint()) {
      setSession(null, null);
      return null;
    }
    const res = await rawFetch('/api/v1/auth/refresh', { method: 'POST', headers: { ...CSRF_HEADER } });
    if (!res.ok) {
      if (res.status >= 500) throw await toApiError(res);
      setSession(null, null);
      return null;
    }
    const data = (await res.json()) as { accessToken: string; user: SessionUser };
    setSession(data.accessToken, data.user);
    return data.user;
  };
  // Serialize refreshes across tabs: the refresh token rotates, and a concurrent reuse revokes the whole family.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('facilito-refresh', run) : run();
}

/** Single-flight refresh: concurrent callers share one rotation. */
export function refreshSession(): Promise<SessionUser | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  raw?: boolean;
}

function buildUrl(path: string, query?: ApiOptions['query']): string {
  const url = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  if (!query) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${url}?${qs}` : url;
}

async function send(path: string, opts: ApiOptions): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  const { query: _q, raw: _r, body: _b, ...rest } = opts;
  return rawFetch(buildUrl(path, opts.query), { ...rest, headers, body });
}

/** Authenticated request. Retries once after a silent refresh when the access token expired. */
export async function apiResponse(path: string, opts: ApiOptions = {}): Promise<Response> {
  if (!accessToken && !(await refreshSession())) {
    throw new ApiError(401, 'Sesión expirada', 'Inicia sesión de nuevo.', 'unauthorized');
  }
  let res = await send(path, opts);
  if (res.status === 401) {
    const user = await refreshSession();
    if (!user) throw await toApiError(res);
    res = await send(path, opts);
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (err.code === 'account_blocked') setSession(null, null);
    throw err;
  }
  return res;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await apiResponse(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Public auth endpoints (login, invitation acceptance) that set the refresh cookie. */
export async function authRequest(path: string, body: unknown): Promise<SessionUser> {
  const res = await rawFetch(`/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...CSRF_HEADER },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  const data = (await res.json()) as { accessToken: string; user: SessionUser };
  setSession(data.accessToken, data.user);
  return data.user;
}

export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await rawFetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function publicGet<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await rawFetch(`/api${path}`, { method: 'GET', headers });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

/** Unauthenticated multipart upload (checkout receipt proves possession with a request token header). */
export async function publicUpload<T>(path: string, form: FormData, headers?: Record<string, string>): Promise<T> {
  const res = await rawFetch(`/api${path}`, { method: 'POST', headers, body: form });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function logoutRequest(): Promise<void> {
  try {
    await rawFetch('/api/v1/auth/logout', { method: 'POST', headers: { ...CSRF_HEADER } });
  } finally {
    setSession(null, null);
  }
}

export async function switchTenantRequest(tenantId: string): Promise<SessionUser> {
  const res = await apiResponse('/v1/auth/switch-tenant', {
    method: 'POST',
    headers: { ...CSRF_HEADER },
    body: { tenantId },
  });
  const data = (await res.json()) as { accessToken: string; user: SessionUser };
  setSession(data.accessToken, data.user);
  return data.user;
}

/** Fetches an authenticated binary (PDF/CSV/image) as a Blob. */
export async function apiBlob(path: string, opts: ApiOptions = {}): Promise<Blob> {
  const res = await apiResponse(path, opts);
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens an authenticated PDF in a new tab. The tab is opened synchronously to avoid popup blockers. */
export async function openBlobInTab(path: string, opts: ApiOptions = {}) {
  const win = window.open('about:blank', '_blank');
  try {
    const blob = await apiBlob(path, opts);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}

export function newClientUuid(): string {
  return crypto.randomUUID();
}
