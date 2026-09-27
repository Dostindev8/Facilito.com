import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { newUuidsV7, type RoleCode } from '@facilito/domain';
import { buildApp } from '../app.js';
import { ensureSchema } from '../db/schema.js';
import { resetDriverForTests, withAuthBootstrap } from '../db/client.js';
import { __resetMemoryCacheForTests } from '../utils/cache.js';
import { hashPassword } from '../auth/tokens.js';

export const PASSWORD = 'Segura12345';

let rncSeq = 100_000_000;
let emailSeq = 0;

export async function bootApp(): Promise<FastifyInstance> {
  await resetDriverForTests();
  __resetMemoryCacheForTests();
  await ensureSchema();
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function shutdown(app: FastifyInstance): Promise<void> {
  await app.close();
  await resetDriverForTests();
}

export interface Session {
  token: string;
  cookie: string;
  tenantId: string;
  personaId: string;
  email: string;
}

export function refreshCookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const c = list.find((x) => x.startsWith('fc_rt='));
  return c ? c.split(';')[0]! : '';
}

export async function register(app: FastifyInstance, overrides: Record<string, unknown> = {}): Promise<Session> {
  emailSeq++;
  const email = `dueno${emailSeq}.${Date.now()}@facilito.test`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      nombre: 'Dostin Santana',
      email,
      password: PASSWORD,
      razonSocial: `Colmado ${emailSeq}`,
      rnc: String(rncSeq++),
      vertical: 'colmado',
      ...overrides,
    },
  });
  if (res.statusCode !== 201) throw new Error(`register failed ${res.statusCode}: ${res.body}`);
  const body = res.json() as { accessToken: string; user: { tenantId: string; personaId: string } };
  return { token: body.accessToken, cookie: refreshCookieFrom(res), tenantId: body.user.tenantId, personaId: body.user.personaId, email };
}

/** Adds a staff member with the given role to an existing business and logs them in. */
export async function addStaff(app: FastifyInstance, tenantId: string, rol: RoleCode): Promise<Session> {
  const personaId = newUuidsV7();
  const email = `staff.${rol}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@facilito.test`;
  const hash = await hashPassword(PASSWORD);
  await withAuthBootstrap(async (q) => {
    await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await q.query(`INSERT INTO identity.persona (id, email, password_hash, nombre) VALUES ($1,$2,$3,$4)`, [personaId, email, hash, `Staff ${rol}`]);
    await q.query(`INSERT INTO app.acceso (id, tenant_id, persona_id, rol, estado, display_name) VALUES ($1,$2,$3,$4,'active',$5)`, [
      newUuidsV7(),
      tenantId,
      personaId,
      rol,
      `Staff ${rol}`,
    ]);
  });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`staff login failed ${res.body}`);
  return { token: res.json().accessToken, cookie: refreshCookieFrom(res), tenantId, personaId, email };
}

export function api(app: FastifyInstance, s: Pick<Session, 'token'>) {
  const headers = { authorization: `Bearer ${s.token}` };
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers }),
    post: (url: string, payload?: unknown, extra: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url, headers: { ...headers, ...extra }, ...(payload === undefined ? {} : { payload: payload as object }) }),
    patch: (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, headers, payload: payload as object }),
    put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers, payload: payload as object }),
  };
}

export function multipartBody(field: string, filename: string, contentType: string, data: Buffer): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----facilito${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function createProduct(app: FastifyInstance, s: Session, overrides: Record<string, unknown> = {}) {
  const res = await api(app, s).post('/v1/products', {
    nombre: 'Arroz Selecto 1 lb',
    categoria: 'Granos',
    unidad: 'lb',
    costo: '32.00',
    precioVenta: '45.00',
    stockInicial: '10',
    stockMin: '3',
    ...overrides,
  });
  if (res.statusCode !== 201) throw new Error(`product failed ${res.statusCode}: ${res.body}`);
  return res.json() as { id: string; sku: string; stockActual: string };
}
