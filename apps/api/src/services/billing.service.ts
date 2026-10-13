import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import {
  effectiveSubscriptionState,
  newUuidsV7,
  nextPeriodEnd,
  rncPlainSchema,
  SubscriptionTransitionError,
  transition,
  type SubscriptionEvent,
  type SubscriptionState,
} from '@facilito/domain';
import { getDriver, withAuthBootstrap, withTenant, type Queryable } from '../db/client.js';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { businessTypeField, pagination, safeText, uuidParam } from '../http/validators.js';
import { hashPassword } from '../auth/tokens.js';
import { forgetSessionsOf } from '../auth/session-status.js';
import { decryptField, encryptField, hashRnc, randomToken, sha256 } from '../utils/crypto.js';
import { sanitizeReceipt } from '../studio/upload-guard.js';
import { cacheBackend } from '../utils/cache.js';
import { provisionOwnerAccount } from './owner-provisioning.js';
import { asPlatformAdmin, log, type PlatformAction } from './platform.service.js';
import { bankInstructions, gatewayProvider, providerById, transferProvider, type WebhookEvent } from './billing-providers.js';
import {
  emailProviderConfigured,
  MailDeliveryError,
  sendInvitationEmail,
  sendNewRequestNotice,
  sendPaymentReceivedEmail,
  sendRequestRejectedEmail,
  invitationUrl,
} from './mailer.js';

/* ───────────── Shared helpers ───────────── */

const iso = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).toISOString());

export function formatDop(centavos: number | string, moneda = 'DOP'): string {
  const n = Number(centavos) / 100;
  const prefix = moneda === 'USD' ? 'US$' : 'RD$';
  return `${prefix} ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const fechaLarga = (d: Date) => new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'long' }).format(d);

interface SubRow {
  id: string;
  plan_id: string;
  estado: SubscriptionState;
  metodo_pago: string;
  proveedor: string;
  nombre_contacto: string;
  email: string;
  telefono: string | null;
  razon_social: string;
  rnc_enc: string;
  tipo_negocio: string | null;
  referencia_pago: string | null;
  monto_centavos: string | number;
  moneda: string;
  motivo: string | null;
  tenant_id: string | null;
  persona_id: string | null;
  periodo_fin: Date | string | null;
  cancelar_al_final: boolean;
  created_at: Date | string;
}

const SUB_COLUMNS = `id, plan_id, estado, metodo_pago, proveedor, nombre_contacto, email, telefono, razon_social, rnc_enc,
  tipo_negocio, referencia_pago, monto_centavos, moneda, motivo, tenant_id, persona_id, periodo_fin, cancelar_al_final, created_at`;

async function lockSub(q: Queryable, id: string): Promise<SubRow> {
  const r = await q.query<SubRow & Record<string, unknown>>(`SELECT ${SUB_COLUMNS} FROM billing.suscripcion WHERE id = $1 FOR UPDATE`, [id]);
  const s = r.rows[0];
  if (!s) throw new AppError(404, 'No encontrada', 'La suscripción no existe.', 'not_found');
  return s;
}

/**
 * The only writer of `estado`. An invalid move is an error for people (409) and a logged no-op for machines
 * (webhooks, sweep) — never a silent write.
 */
async function move(
  q: Queryable,
  sub: SubRow,
  event: SubscriptionEvent,
  actorId: string | null,
  detalle: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<SubscriptionState> {
  let to: SubscriptionState;
  try {
    to = transition(sub.estado, event);
  } catch (e) {
    if (e instanceof SubscriptionTransitionError) {
      console.warn(`[billing] invalid transition sub=${sub.id} from=${e.from} event=${e.event}`);
      throw new AppError(409, 'Acción no permitida', `No se puede «${event.replace(/_/g, ' ')}» una suscripción en estado ${sub.estado}.`, 'invalid_transition');
    }
    throw e;
  }
  await q.query(`UPDATE billing.suscripcion SET estado = $2, updated_at = now() WHERE id = $1`, [sub.id, to]);
  await q.query(
    `INSERT INTO billing.evento (id, suscripcion_id, evento, de, a, actor_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [newUuidsV7(), sub.id, event, sub.estado, to, actorId, JSON.stringify(detalle), ip],
  );
  const from = sub.estado;
  sub.estado = to;
  if (sub.tenant_id && from !== to) forgetSessionsOf({ tenantId: sub.tenant_id });
  return to;
}

async function recordEvent(q: Queryable, sub: SubRow, evento: string, actorId: string | null, detalle: Record<string, unknown> = {}, ip: string | null = null) {
  await q.query(
    `INSERT INTO billing.evento (id, suscripcion_id, evento, de, a, actor_id, detalle, ip) VALUES ($1,$2,$3,$4,$4,$5,$6::jsonb,$7)`,
    [newUuidsV7(), sub.id, evento, sub.estado, actorId, JSON.stringify(detalle), ip],
  );
}

/** Switches the open transaction between the platform context (audit log) and the system context (provisioning). */
async function useContext(q: Queryable, ctx: { persona: string; tenant?: string; system?: boolean; platform?: boolean }) {
  await q.query(`SELECT set_config('app.persona_id', $1, true)`, [ctx.persona]);
  await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenant ?? '']);
  await q.query(`SELECT set_config('app.auth_bootstrap', $1, true)`, [ctx.system ? '1' : '']);
  await q.query(`SELECT set_config('app.platform', $1, true)`, [ctx.platform ? '1' : '']);
}

/* ───────────── Public: plans and checkout ───────────── */

export async function listPlans() {
  const rows = await withAuthBootstrap(async (q) =>
    (
      await q.query<{
        id: string;
        nombre: string;
        descripcion: string;
        precio_mensual_centavos: string | number;
        moneda: string;
        max_usuarios: number;
        max_productos: number | null;
        copilot: boolean;
      }>(
        `SELECT id, nombre, descripcion, precio_mensual_centavos, moneda, max_usuarios, max_productos, copilot
           FROM billing.plan WHERE activo ORDER BY orden, precio_mensual_centavos`,
      )
    ).rows,
  );
  return {
    items: rows.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precioMensualCentavos: Number(p.precio_mensual_centavos),
      moneda: p.moneda,
      maxUsuarios: p.max_usuarios,
      maxProductos: p.max_productos,
      copilot: p.copilot,
    })),
    metodos: { transferencia: transferProvider.disponible(), tarjeta: gatewayProvider.disponible() },
  };
}

const checkoutSchema = z
  .object({
    planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Plan inválido'),
    nombre: safeText(2, 120),
    email: z.string().trim().toLowerCase().email('Email inválido').max(320),
    telefono: z
      .string()
      .trim()
      .regex(/^[+\d][\d\s()-]{6,24}$/, 'Teléfono inválido')
      .optional(),
    razonSocial: safeText(2, 200),
    rnc: z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ''))
      .pipe(rncPlainSchema),
    tipoNegocio: businessTypeField.optional(),
    referenciaPago: z.string().trim().max(120).optional(),
    metodo: z.literal('transferencia').default('transferencia'),
    aceptaTerminos: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos y la política de privacidad' }) }),
  })
  .strict();

const solicitudAuth = z.object({ id: z.string().uuid('Solicitud inválida'), token: z.string().min(20).max(200) });

const SOLICITUD_NOT_FOUND = () => new AppError(404, 'Solicitud no encontrada', 'El enlace de tu solicitud no es válido.', 'not_found');

export async function startCheckout(input: unknown, ip: string) {
  const d = checkoutSchema.parse(input);
  const provider = providerById('manual')!;
  const start = await provider.startCheckout({ suscripcionId: '', montoCentavos: 0, email: d.email });
  const id = newUuidsV7();
  const token = randomToken(32);
  const rncHash = hashRnc(d.rnc);

  const plan = await withAuthBootstrap(async (q) => {
    const p = await q.query<{ id: string; nombre: string; precio_mensual_centavos: string | number; moneda: string }>(
      `SELECT id, nombre, precio_mensual_centavos, moneda FROM billing.plan WHERE id = $1 AND activo`,
      [d.planId],
    );
    const plan = p.rows[0];
    if (!plan) throw new AppError(400, 'Plan inválido', 'Elige uno de los planes disponibles.', 'validation');
    const taken = await q.query(`SELECT 1 FROM identity.persona WHERE lower(email) = $1`, [d.email]);
    if (taken.rows.length) {
      throw new AppError(409, 'Ya tienes cuenta', 'Ese email ya tiene una cuenta de Facilito. Inicia sesión o recupera tu contraseña.', 'email_taken');
    }
    const rncTaken = await q.query(`SELECT 1 FROM app.negocio WHERE rnc_hash = $1`, [rncHash]);
    if (rncTaken.rows.length) {
      throw new AppError(409, 'RNC registrado', 'Ese RNC ya tiene un negocio en Facilito. Pide acceso al dueño.', 'rnc_taken');
    }
    const open = await q.query(
      `SELECT 1 FROM billing.suscripcion WHERE estado IN ('PENDIENTE_PAGO','PENDIENTE_AUTORIZACION') AND (lower(email) = $1 OR rnc_hash = $2)`,
      [d.email, rncHash],
    );
    if (open.rows.length) {
      throw new AppError(409, 'Solicitud en curso', 'Ya hay una solicitud abierta con ese email o RNC. Usa el enlace que recibiste o escríbenos.', 'request_open');
    }
    await q.query(
      `INSERT INTO billing.suscripcion (id, plan_id, estado, metodo_pago, proveedor, nombre_contacto, email, telefono, razon_social,
                                        rnc_enc, rnc_hash, tipo_negocio, referencia_pago, monto_centavos, moneda, solicitante_ip, acceso_token_hash)
       VALUES ($1,$2,'PENDIENTE_PAGO',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        plan.id,
        d.metodo,
        provider.id,
        d.nombre,
        d.email,
        d.telefono ?? null,
        d.razonSocial,
        encryptField(d.rnc),
        rncHash,
        d.tipoNegocio ?? null,
        d.referenciaPago || null,
        plan.precio_mensual_centavos,
        plan.moneda,
        ip.slice(0, 64),
        sha256(token),
      ],
    );
    await q.query(
      `INSERT INTO billing.evento (id, suscripcion_id, evento, de, a, detalle, ip) VALUES ($1,$2,'solicitud',NULL,'PENDIENTE_PAGO',$3::jsonb,$4)`,
      [newUuidsV7(), id, JSON.stringify({ plan: plan.id }), ip.slice(0, 64)],
    );
    return plan;
  });

  return {
    id,
    token,
    estado: 'PENDIENTE_PAGO' as const,
    plan: { id: plan.id, nombre: plan.nombre },
    montoCentavos: Number(plan.precio_mensual_centavos),
    moneda: plan.moneda,
    referenciaSugerida: `FAC-${id.slice(-8).toUpperCase()}`,
    instrucciones: start.kind === 'instrucciones' ? start.banco : null,
  };
}

async function notifyAdmins(negocio: string, plan: string) {
  const env = getEnv();
  const to = (env.BILLING_NOTIFY_EMAIL || env.MAIL_REPLY_TO || env.SMTP_USER)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    await sendNewRequestNotice(to, negocio, plan);
  } catch (e) {
    if (!(e instanceof MailDeliveryError)) throw e;
  }
}

const RECEIPT_REJECTED: Record<string, string> = {
  size: 'El archivo está vacío o supera el tamaño permitido.',
  unsupported_or_spoofed_type: 'Sube una foto (JPG, PNG o WebP) o el PDF del banco.',
  pdf_active_content: 'Ese PDF trae contenido activo. Descarga el comprobante de nuevo desde tu banco o sube una captura.',
  corrupt: 'No pudimos leer la imagen. Prueba con otra foto o captura.',
  malware: 'El archivo fue rechazado por seguridad.',
};

async function cleanReceipt(buf: Buffer) {
  const clean = await sanitizeReceipt(buf, getEnv().UPLOAD_MAX_BYTES);
  if (!clean.ok) throw new AppError(400, 'Comprobante no válido', RECEIPT_REJECTED[clean.reason] ?? 'Archivo no válido.', 'upload');
  return clean;
}

/** The applicant proves possession of the request with the token returned at checkout (no account exists yet). */
export async function uploadCheckoutReceipt(params: { id: string; token: string | undefined }, buf: Buffer, ip: string) {
  const { id, token } = solicitudAuth.parse(params);
  const clean = await cleanReceipt(buf);
  const out = await withAuthBootstrap(async (q) => {
    const r = await q.query<SubRow & { acceso_token_hash: string } & Record<string, unknown>>(
      `SELECT ${SUB_COLUMNS}, acceso_token_hash FROM billing.suscripcion WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const sub = r.rows[0];
    if (!sub || sub.acceso_token_hash !== sha256(token)) throw SOLICITUD_NOT_FOUND();
    if (sub.estado !== 'PENDIENTE_PAGO' && sub.estado !== 'PENDIENTE_AUTORIZACION') {
      throw new AppError(409, 'Solicitud cerrada', 'Esta solicitud ya fue procesada.', 'request_closed');
    }
    const comprobanteId = newUuidsV7();
    await q.query(`INSERT INTO billing.comprobante (id, suscripcion_id, mime, datos, sha256) VALUES ($1,$2,$3,$4,$5)`, [
      comprobanteId,
      sub.id,
      clean.mime,
      clean.bytes,
      clean.hash,
    ]);
    const first = sub.estado === 'PENDIENTE_PAGO';
    if (first) await move(q, sub, 'pago_reportado', null, { comprobanteId }, ip.slice(0, 64));
    else await recordEvent(q, sub, 'comprobante', null, { comprobanteId }, ip.slice(0, 64));
    const plan = await q.query<{ nombre: string }>(`SELECT nombre FROM billing.plan WHERE id = $1`, [sub.plan_id]);
    return { estado: sub.estado, first, negocio: sub.razon_social, plan: plan.rows[0]?.nombre ?? sub.plan_id };
  });
  if (out.first) await notifyAdmins(out.negocio, out.plan);
  return { estado: out.estado };
}

export async function checkoutStatus(params: { id: string; token: string | undefined }) {
  const { id, token } = solicitudAuth.parse(params);
  const row = await withAuthBootstrap(async (q) => {
    const r = await q.query<{
      estado: SubscriptionState;
      acceso_token_hash: string;
      plan: string;
      monto_centavos: string | number;
      moneda: string;
      motivo: string | null;
      created_at: Date | string;
      comprobantes: number;
    }>(
      `SELECT s.estado, s.acceso_token_hash, p.nombre AS plan, s.monto_centavos, s.moneda, s.motivo, s.created_at,
              (SELECT count(*) FROM billing.comprobante c WHERE c.suscripcion_id = s.id)::int AS comprobantes
         FROM billing.suscripcion s JOIN billing.plan p ON p.id = s.plan_id WHERE s.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  });
  if (!row || row.acceso_token_hash !== sha256(token)) throw SOLICITUD_NOT_FOUND();
  return {
    estado: row.estado,
    plan: row.plan,
    montoCentavos: Number(row.monto_centavos),
    moneda: row.moneda,
    motivo: row.estado === 'RECHAZADA' ? row.motivo : null,
    comprobantes: row.comprobantes,
    creada: iso(row.created_at),
    instrucciones: row.estado === 'PENDIENTE_PAGO' ? bankInstructions() : null,
  };
}

/* ───────────── Business: its own subscription ───────────── */

async function loadTenantSub(q: Queryable, tenantId: string): Promise<SubRow | null> {
  const r = await q.query<SubRow & Record<string, unknown>>(`SELECT ${SUB_COLUMNS} FROM billing.suscripcion WHERE tenant_id = $1`, [tenantId]);
  return r.rows[0] ?? null;
}

export async function mySubscription(tenantId: string) {
  return withTenant(tenantId, async (q) => {
    const sub = await loadTenantSub(q, tenantId);
    if (!sub) return { suscripcion: null, pagos: [], comprobantes: [], instrucciones: null };
    const plan = await q.query<{ nombre: string; max_usuarios: number; max_productos: number | null; copilot: boolean }>(
      `SELECT nombre, max_usuarios, max_productos, copilot FROM billing.plan WHERE id = $1`,
      [sub.plan_id],
    );
    const pagos = await q.query<{
      id: string;
      tipo: string;
      monto_centavos: string | number;
      moneda: string;
      metodo: string;
      referencia: string | null;
      periodo_inicio: Date | string | null;
      periodo_fin: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT id, tipo, monto_centavos, moneda, metodo, referencia, periodo_inicio, periodo_fin, created_at
         FROM billing.pago WHERE suscripcion_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [sub.id],
    );
    const comps = await q.query<{ id: string; created_at: Date | string; resultado: string | null; motivo: string | null }>(
      `SELECT c.id, c.created_at, r.resultado, r.motivo
         FROM billing.comprobante c LEFT JOIN billing.comprobante_revision r ON r.comprobante_id = c.id
        WHERE c.suscripcion_id = $1 ORDER BY c.created_at DESC LIMIT 20`,
      [sub.id],
    );
    const fin = sub.periodo_fin ? new Date(sub.periodo_fin) : null;
    const estado = effectiveSubscriptionState(sub.estado, fin, sub.cancelar_al_final);
    return {
      suscripcion: {
        id: sub.id,
        estado,
        planId: sub.plan_id,
        plan: plan.rows[0]?.nombre ?? sub.plan_id,
        limites: plan.rows[0]
          ? { maxUsuarios: plan.rows[0].max_usuarios, maxProductos: plan.rows[0].max_productos, copilot: plan.rows[0].copilot }
          : null,
        montoCentavos: Number(sub.monto_centavos),
        moneda: sub.moneda,
        periodoFin: iso(fin),
        cancelarAlFinal: sub.cancelar_al_final,
        soloLectura: estado === 'SUSPENDIDA' || estado === 'CANCELADA',
      },
      pagos: pagos.rows.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        montoCentavos: Number(p.monto_centavos),
        moneda: p.moneda,
        metodo: p.metodo,
        referencia: p.referencia,
        periodoInicio: iso(p.periodo_inicio),
        periodoFin: iso(p.periodo_fin),
        fecha: iso(p.created_at),
      })),
      comprobantes: comps.rows.map((c) => ({ id: c.id, fecha: iso(c.created_at), estado: c.resultado ?? 'pendiente', motivo: c.motivo })),
      instrucciones: bankInstructions(),
    };
  });
}

export async function uploadRenewalReceipt(tenantId: string, buf: Buffer) {
  const clean = await cleanReceipt(buf);
  const out = await withTenant(tenantId, async (q) => {
    const sub = await loadTenantSub(q, tenantId);
    if (!sub) throw new AppError(409, 'Sin suscripción', 'Tu negocio no tiene una suscripción asignada. Escríbenos.', 'no_subscription');
    const pending = await q.query(
      `SELECT 1 FROM billing.comprobante c WHERE c.suscripcion_id = $1
          AND NOT EXISTS (SELECT 1 FROM billing.comprobante_revision r WHERE r.comprobante_id = c.id)`,
      [sub.id],
    );
    if (pending.rows.length >= 3) {
      throw new AppError(429, 'Comprobantes en revisión', 'Ya tienes comprobantes esperando revisión. Te avisaremos al confirmarlos.', 'too_many_pending');
    }
    const id = newUuidsV7();
    await q.query(`INSERT INTO billing.comprobante (id, suscripcion_id, mime, datos, sha256) VALUES ($1,$2,$3,$4,$5)`, [
      id,
      sub.id,
      clean.mime,
      clean.bytes,
      clean.hash,
    ]);
    return { id, negocio: sub.razon_social, plan: sub.plan_id };
  });
  await notifyAdmins(out.negocio, out.plan);
  return { id: out.id, estado: 'pendiente' };
}

export async function setCancelAtPeriodEnd(tenantId: string, personaId: string, input: unknown, ip: string) {
  const { cancelar } = z.object({ cancelar: z.boolean() }).strict().parse(input);
  const id = await withTenant(tenantId, async (q) => (await loadTenantSub(q, tenantId))?.id ?? null);
  if (!id) throw new AppError(409, 'Sin suscripción', 'Tu negocio no tiene una suscripción asignada.', 'no_subscription');
  return withAuthBootstrap(async (q) => {
    const sub = await lockSub(q, id);
    if (sub.estado !== 'ACTIVA' && sub.estado !== 'EN_GRACIA') {
      throw new AppError(409, 'Acción no permitida', 'Solo una suscripción activa se puede programar para cancelar.', 'invalid_transition');
    }
    if (sub.cancelar_al_final !== cancelar) {
      await q.query(`UPDATE billing.suscripcion SET cancelar_al_final = $2, updated_at = now() WHERE id = $1`, [id, cancelar]);
      await recordEvent(q, sub, cancelar ? 'cancelacion_programada' : 'cancelacion_revertida', personaId, {}, ip.slice(0, 64));
      forgetSessionsOf({ tenantId });
    }
    return { cancelarAlFinal: cancelar, periodoFin: iso(sub.periodo_fin) };
  });
}

/* ───────────── Receipt PDF (also downloadable by admins) ───────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.resolve(__dirname, '../../assets/facilito-mark.png');

interface ReceiptData {
  id: string;
  tipo: string;
  monto_centavos: string | number;
  moneda: string;
  metodo: string;
  referencia: string | null;
  periodo_inicio: Date | string | null;
  periodo_fin: Date | string | null;
  created_at: Date | string;
  plan: string;
  razon_social: string;
  rnc_enc: string;
  email: string;
}

const RECEIPT_SQL = `SELECT p.id, p.tipo, p.monto_centavos, p.moneda, p.metodo, p.referencia, p.periodo_inicio, p.periodo_fin, p.created_at,
       pl.nombre AS plan, s.razon_social, s.rnc_enc, s.email
  FROM billing.pago p JOIN billing.suscripcion s ON s.id = p.suscripcion_id JOIN billing.plan pl ON pl.id = p.plan_id
 WHERE p.id = $1`;

function renderReceipt(r: ReceiptData): Promise<{ bytes: Buffer; filename: string }> {
  const numero = `R-${r.id.slice(-10).toUpperCase()}`;
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Recibo ${numero}`, Author: 'Facilito', Producer: 'Facilito by Logic Code Spot' } });
  const GREEN = '#0E8A5F';
  const INK = '#1B2838';
  const MUTED = '#6B7785';
  if (existsSync(LOGO)) doc.image(LOGO, 48, 40, { fit: [48, 48] });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('Facilito', 106, 44);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Logic Code Spot · Santo Domingo, R.D.', 106, 63);
  const title = r.tipo === 'reembolso' ? 'NOTA DE REEMBOLSO' : 'RECIBO DE PAGO';
  doc.font('Helvetica-Bold').fontSize(17).fillColor(GREEN).text(title, 300, 42, { width: 247, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(`${numero}\n${fechaLarga(new Date(r.created_at))}`, 300, 64, { width: 247, align: 'right' });
  doc.moveTo(48, 112).lineTo(547, 112).lineWidth(2).strokeColor(GREEN).stroke();

  let rnc = '';
  try {
    rnc = decryptField(r.rnc_enc);
  } catch {
    rnc = '';
  }
  const rows: Array<[string, string]> = [
    ['Cliente', r.razon_social],
    ['RNC / Cédula', rnc || '—'],
    ['Email', r.email],
    ['Concepto', `Suscripción Facilito — plan ${r.plan}`],
    [
      'Periodo',
      r.periodo_inicio && r.periodo_fin ? `${fechaLarga(new Date(r.periodo_inicio))} al ${fechaLarga(new Date(r.periodo_fin))}` : '—',
    ],
    ['Método', r.metodo.charAt(0).toUpperCase() + r.metodo.slice(1)],
    ['Referencia', r.referencia ?? '—'],
  ];
  let y = 132;
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(k.toUpperCase(), 48, y, { width: 140 });
    doc.font('Helvetica').fontSize(11).fillColor(INK).text(v, 190, y - 1, { width: 357 });
    y += 26;
  }
  doc.moveTo(48, y + 6).lineTo(547, y + 6).lineWidth(1).strokeColor('#E3E8EE').stroke();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(r.tipo === 'reembolso' ? 'Total reembolsado' : 'Total pagado', 48, y + 20);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(GREEN).text(formatDop(r.monto_centavos, r.moneda), 300, y + 18, { width: 247, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      'Documento interno de pago. No es un comprobante fiscal (NCF/e-CF). La factura fiscal se emitirá cuando la facturación electrónica de Facilito esté habilitada.',
      48,
      y + 60,
      { width: 499 },
    );
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve({ bytes: Buffer.concat(chunks), filename: `${numero}.pdf` }));
    doc.on('error', reject);
    doc.end();
  });
}

export async function tenantReceiptPdf(tenantId: string, params: unknown) {
  const { id } = uuidParam.parse(params);
  // RLS limits billing.pago to the business's own subscription; the system context only decrypts the RNC column it already owns.
  const visible = await withTenant(tenantId, async (q) => (await q.query(`SELECT 1 FROM billing.pago WHERE id = $1`, [id])).rows.length > 0);
  if (!visible) throw new AppError(404, 'No encontrado', 'El recibo no existe.', 'not_found');
  const row = await withAuthBootstrap(async (q) => (await q.query<ReceiptData & Record<string, unknown>>(RECEIPT_SQL, [id])).rows[0]);
  if (!row) throw new AppError(404, 'No encontrado', 'El recibo no existe.', 'not_found');
  return renderReceipt(row);
}

export async function adminReceiptPdf(actorId: string, params: unknown) {
  const { id } = uuidParam.parse(params);
  const row = await asPlatformAdmin(actorId, async (q) => (await q.query<ReceiptData & Record<string, unknown>>(RECEIPT_SQL, [id])).rows[0]);
  if (!row) throw new AppError(404, 'No encontrado', 'El recibo no existe.', 'not_found');
  return renderReceipt(row);
}

/* ───────────── Platform admin ───────────── */

const ESTADOS = ['PENDIENTE_PAGO', 'PENDIENTE_AUTORIZACION', 'ACTIVA', 'EN_GRACIA', 'SUSPENDIDA', 'CANCELADA', 'RECHAZADA'] as const;

const subListQuery = pagination.extend({
  q: z.string().max(100).optional().default(''),
  estado: z.enum(['todos', ...ESTADOS]).default('todos'),
});

export async function listSubscriptions(actorId: string, query: unknown) {
  const { q: search, estado, page, pageSize } = subListQuery.parse(query);
  const term = search.trim().toLowerCase();
  return asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<
      SubRow & { plan: string; comprobantes: number; comprobantes_pendientes: number; total: number } & Record<string, unknown>
    >(
      `SELECT ${SUB_COLUMNS.split(',').map((c) => `s.${c.trim()}`).join(', ')}, p.nombre AS plan,
              (SELECT count(*) FROM billing.comprobante c WHERE c.suscripcion_id = s.id)::int AS comprobantes,
              (SELECT count(*) FROM billing.comprobante c WHERE c.suscripcion_id = s.id
                  AND NOT EXISTS (SELECT 1 FROM billing.comprobante_revision rv WHERE rv.comprobante_id = c.id))::int AS comprobantes_pendientes,
              count(*) OVER ()::int AS total
         FROM billing.suscripcion s JOIN billing.plan p ON p.id = s.plan_id
        WHERE ($1 = 'todos' OR s.estado = $1)
          AND ($2 = '' OR lower(s.email) LIKE $3 OR lower(s.razon_social) LIKE $3 OR lower(s.nombre_contacto) LIKE $3)
        ORDER BY (s.estado = 'PENDIENTE_AUTORIZACION') DESC, s.created_at DESC, s.id
        LIMIT $4 OFFSET $5`,
      [estado, term, `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, pageSize, (page - 1) * pageSize],
    );
    return {
      items: r.rows.map((s) => {
        const fin = s.periodo_fin ? new Date(s.periodo_fin) : null;
        return {
          id: s.id,
          estado: s.estado,
          estadoEfectivo: effectiveSubscriptionState(s.estado, fin, s.cancelar_al_final),
          plan: s.plan,
          planId: s.plan_id,
          negocio: s.razon_social,
          contacto: s.nombre_contacto,
          email: s.email,
          telefono: s.telefono,
          montoCentavos: Number(s.monto_centavos),
          moneda: s.moneda,
          referenciaPago: s.referencia_pago,
          tenantId: s.tenant_id,
          periodoFin: iso(fin),
          cancelarAlFinal: s.cancelar_al_final,
          comprobantes: s.comprobantes,
          comprobantesPendientes: s.comprobantes_pendientes,
          creada: iso(s.created_at),
        };
      }),
      total: r.rows[0]?.total ?? 0,
      page,
      pageSize,
    };
  });
}

export async function subscriptionDetail(actorId: string, params: unknown) {
  const { id } = uuidParam.parse(params);
  return asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<SubRow & Record<string, unknown>>(`SELECT ${SUB_COLUMNS} FROM billing.suscripcion WHERE id = $1`, [id]);
    const s = r.rows[0];
    if (!s) throw new AppError(404, 'No encontrada', 'La suscripción no existe.', 'not_found');
    const [eventos, pagos, comps, invs] = [
      await q.query<{ id: string; evento: string; de: string | null; a: string; detalle: unknown; actor: string | null; created_at: Date | string }>(
        `SELECT e.id, e.evento, e.de, e.a, e.detalle, p.email AS actor, e.created_at
           FROM billing.evento e LEFT JOIN identity.persona p ON p.id = e.actor_id
          WHERE e.suscripcion_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
        [id],
      ),
      await q.query<{ id: string; tipo: string; monto_centavos: string | number; metodo: string; referencia: string | null; nota: string | null; created_at: Date | string }>(
        `SELECT id, tipo, monto_centavos, metodo, referencia, nota, created_at FROM billing.pago WHERE suscripcion_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
      await q.query<{ id: string; mime: string; bytes: number; created_at: Date | string; resultado: string | null; motivo: string | null }>(
        `SELECT c.id, c.mime, octet_length(c.datos)::int AS bytes, c.created_at, r.resultado, r.motivo
           FROM billing.comprobante c LEFT JOIN billing.comprobante_revision r ON r.comprobante_id = c.id
          WHERE c.suscripcion_id = $1 ORDER BY c.created_at DESC`,
        [id],
      ),
      await q.query<{ id: string; expires_at: Date | string; used_at: Date | string | null; revoked_at: Date | string | null; created_at: Date | string }>(
        `SELECT id, expires_at, used_at, revoked_at, created_at FROM billing.invitacion WHERE suscripcion_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
    ];
    let rnc: string | null = null;
    try {
      rnc = decryptField(s.rnc_enc);
    } catch {
      rnc = null;
    }
    const fin = s.periodo_fin ? new Date(s.periodo_fin) : null;
    return {
      id: s.id,
      estado: s.estado,
      estadoEfectivo: effectiveSubscriptionState(s.estado, fin, s.cancelar_al_final),
      planId: s.plan_id,
      negocio: s.razon_social,
      rnc,
      tipoNegocio: s.tipo_negocio,
      contacto: s.nombre_contacto,
      email: s.email,
      telefono: s.telefono,
      montoCentavos: Number(s.monto_centavos),
      moneda: s.moneda,
      referenciaPago: s.referencia_pago,
      motivo: s.motivo,
      tenantId: s.tenant_id,
      periodoFin: iso(fin),
      cancelarAlFinal: s.cancelar_al_final,
      creada: iso(s.created_at),
      eventos: eventos.rows.map((e) => ({
        id: e.id,
        evento: e.evento,
        de: e.de,
        a: e.a,
        detalle: typeof e.detalle === 'string' ? JSON.parse(e.detalle) : e.detalle,
        actor: e.actor,
        fecha: iso(e.created_at),
      })),
      pagos: pagos.rows.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        montoCentavos: Number(p.monto_centavos),
        metodo: p.metodo,
        referencia: p.referencia,
        nota: p.nota,
        fecha: iso(p.created_at),
      })),
      comprobantes: comps.rows.map((c) => ({ id: c.id, mime: c.mime, bytes: c.bytes, fecha: iso(c.created_at), estado: c.resultado ?? 'pendiente', motivo: c.motivo })),
      invitaciones: invs.rows.map((i) => ({
        id: i.id,
        creada: iso(i.created_at),
        vence: iso(i.expires_at),
        estado: i.used_at ? 'usada' : i.revoked_at ? 'reemplazada' : new Date(i.expires_at) < new Date() ? 'vencida' : 'vigente',
      })),
    };
  });
}

export async function receiptFile(actorId: string, params: unknown) {
  const { id } = uuidParam.parse(params);
  const row = await asPlatformAdmin(actorId, async (q) => {
    const r = await q.query<{ mime: string; datos: Buffer | Uint8Array }>(`SELECT mime, datos FROM billing.comprobante WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  });
  if (!row) throw new AppError(404, 'No encontrado', 'El comprobante no existe.', 'not_found');
  return { mime: row.mime, bytes: Buffer.from(row.datos) };
}

const confirmSchema = z.object({ confirmar: z.literal(true, { errorMap: () => ({ message: 'Confirma la acción' }) }) });

async function issueInvitation(q: Queryable, sub: SubRow, personaId: string, actorId: string) {
  const token = randomToken(32);
  const horas = getEnv().INVITATION_TTL_HOURS;
  await q.query(`UPDATE billing.invitacion SET revoked_at = now() WHERE suscripcion_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [sub.id]);
  await q.query(
    `INSERT INTO billing.invitacion (id, suscripcion_id, persona_id, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [newUuidsV7(), sub.id, personaId, sha256(token), new Date(Date.now() + horas * 3_600_000).toISOString(), actorId],
  );
  return { token, horas };
}

async function deliverInvitation(sub: { email: string; nombre_contacto: string; razon_social: string }, token: string, horas: number) {
  let emailEnviado = false;
  try {
    emailEnviado = await sendInvitationEmail(sub.email, sub.nombre_contacto, sub.razon_social, token, horas);
  } catch (e) {
    if (!(e instanceof MailDeliveryError)) throw e;
  }
  // The admin always gets the link: email may be down, and WhatsApp is how most customers here are reached.
  return { activationUrl: invitationUrl(token), emailEnviado, venceEnHoras: horas };
}

const authorizeSchema = confirmSchema.extend({
  referencia: z.string().trim().max(120).optional(),
  nota: z.string().trim().max(500).optional(),
});

/**
 * Payment verified by a human → business, owner and an unusable password are created in the same transaction as
 * the payment ledger row and a single-use invitation. The owner chooses the password by accepting it.
 */
export async function authorize(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const d = authorizeSchema.parse(body);
  const unusable = await hashPassword(randomToken(32));
  const out = await asPlatformAdmin(actorId, async (q) => {
    const sub = await lockSub(q, id);
    if (sub.estado !== 'PENDIENTE_AUTORIZACION') {
      throw new AppError(409, 'Acción no permitida', `La solicitud está en estado ${sub.estado}.`, 'invalid_transition');
    }
    const personaId = newUuidsV7();
    const tenantId = newUuidsV7();
    const now = new Date();
    const fin = nextPeriodEnd(null, now);
    await useContext(q, { persona: personaId, tenant: tenantId, system: true });
    await provisionOwnerAccount(q, {
      personaId,
      tenantId,
      nombre: sub.nombre_contacto,
      email: sub.email,
      passwordHash: unusable,
      razonSocial: sub.razon_social,
      rnc: decryptField(sub.rnc_enc),
      tipoNegocio: sub.tipo_negocio,
    });
    await q.query(
      `UPDATE billing.suscripcion SET tenant_id = $2, persona_id = $3, periodo_fin = $4, autorizada_por = $5, autorizada_at = now(),
              referencia_pago = coalesce($6, referencia_pago), updated_at = now() WHERE id = $1`,
      [sub.id, tenantId, personaId, fin.toISOString(), actorId, d.referencia || null],
    );
    sub.tenant_id = tenantId;
    await move(q, sub, 'autorizar', actorId, {}, ip);
    await q.query(
      `INSERT INTO billing.pago (id, suscripcion_id, tipo, monto_centavos, moneda, metodo, referencia, proveedor, plan_id,
                                 periodo_inicio, periodo_fin, registrado_por, nota)
       VALUES ($1,$2,'cobro',$3,$4,'transferencia',$5,'manual',$6,$7,$8,$9,$10)`,
      [newUuidsV7(), sub.id, sub.monto_centavos, sub.moneda, d.referencia || sub.referencia_pago, sub.plan_id, now.toISOString(), fin.toISOString(), actorId, d.nota || null],
    );
    await q.query(
      `INSERT INTO billing.comprobante_revision (comprobante_id, resultado, revisado_por)
       SELECT c.id, 'aprobado', $2 FROM billing.comprobante c
        WHERE c.suscripcion_id = $1 AND NOT EXISTS (SELECT 1 FROM billing.comprobante_revision r WHERE r.comprobante_id = c.id)`,
      [sub.id, actorId],
    );
    const inv = await issueInvitation(q, sub, personaId, actorId);
    await useContext(q, { persona: actorId, platform: true });
    await log(q, actorId, 'suscripcion.autorizar', sub.id, { tenantId, plan: sub.plan_id }, ip);
    return { sub, inv, tenantId };
  });
  const entrega = await deliverInvitation(out.sub, out.inv.token, out.inv.horas);
  return { id: out.sub.id, estado: out.sub.estado, tenantId: out.tenantId, ...entrega };
}

export async function resendInvitation(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  confirmSchema.parse(body);
  const out = await asPlatformAdmin(actorId, async (q) => {
    const sub = await lockSub(q, id);
    if (!sub.persona_id) throw new AppError(409, 'Sin cuenta', 'La solicitud todavía no está autorizada.', 'invalid_transition');
    const accepted = await q.query(`SELECT 1 FROM billing.invitacion WHERE suscripcion_id = $1 AND used_at IS NOT NULL`, [sub.id]);
    if (accepted.rows.length) {
      throw new AppError(409, 'Invitación ya aceptada', 'El cliente ya creó su contraseña. Si la olvidó, puede usar «Olvidé mi contraseña».', 'invitation_used');
    }
    const inv = await issueInvitation(q, sub, sub.persona_id, actorId);
    await log(q, actorId, 'suscripcion.reenviar', sub.id, {}, ip);
    return { sub, inv };
  });
  return deliverInvitation(out.sub, out.inv.token, out.inv.horas);
}

const reasonSchema = confirmSchema.extend({ motivo: safeText(3, 500) });

export async function reject(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const { motivo } = reasonSchema.parse(body);
  const sub = await asPlatformAdmin(actorId, async (q) => {
    const s = await lockSub(q, id);
    await move(q, s, 'rechazar', actorId, { motivo }, ip);
    await q.query(`UPDATE billing.suscripcion SET motivo = $2 WHERE id = $1`, [s.id, motivo]);
    await q.query(
      `INSERT INTO billing.comprobante_revision (comprobante_id, resultado, motivo, revisado_por)
       SELECT c.id, 'rechazado', $2, $3 FROM billing.comprobante c
        WHERE c.suscripcion_id = $1 AND NOT EXISTS (SELECT 1 FROM billing.comprobante_revision r WHERE r.comprobante_id = c.id)`,
      [s.id, motivo, actorId],
    );
    await log(q, actorId, 'suscripcion.rechazar', s.id, { motivo }, ip);
    return s;
  });
  try {
    await sendRequestRejectedEmail(sub.email, sub.razon_social, motivo);
  } catch (e) {
    if (!(e instanceof MailDeliveryError)) throw e;
  }
  return { id: sub.id, estado: sub.estado };
}

const paymentSchema = confirmSchema.extend({
  montoCentavos: z.number().int().positive().max(100_000_000),
  metodo: z.enum(['transferencia', 'tarjeta', 'efectivo', 'otro']).default('transferencia'),
  referencia: z.string().trim().max(120).optional(),
  comprobanteId: z.string().uuid().optional(),
  nota: z.string().trim().max(500).optional(),
});

/** A verified renewal: extends the period from the current end (early) or from today (late) and reactivates. */
export async function registerPayment(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const d = paymentSchema.parse(body);
  const out = await asPlatformAdmin(actorId, async (q) => {
    const sub = await lockSub(q, id);
    if (!sub.tenant_id) throw new AppError(409, 'Acción no permitida', 'Autoriza la solicitud antes de registrar renovaciones.', 'invalid_transition');
    if (d.comprobanteId) {
      const c = await q.query(
        `SELECT 1 FROM billing.comprobante c WHERE c.id = $1 AND c.suscripcion_id = $2
            AND NOT EXISTS (SELECT 1 FROM billing.comprobante_revision r WHERE r.comprobante_id = c.id)`,
        [d.comprobanteId, sub.id],
      );
      if (!c.rows.length) throw new AppError(409, 'Comprobante no disponible', 'El comprobante no existe o ya fue revisado.', 'receipt_reviewed');
    }
    const now = new Date();
    const currentEnd = sub.periodo_fin ? new Date(sub.periodo_fin) : null;
    const inicio = currentEnd && currentEnd > now ? currentEnd : now;
    const fin = nextPeriodEnd(currentEnd, now);
    await q.query(`UPDATE billing.suscripcion SET periodo_fin = $2, updated_at = now() WHERE id = $1`, [sub.id, fin.toISOString()]);
    sub.periodo_fin = fin;
    await move(q, sub, 'pago_registrado', actorId, { montoCentavos: d.montoCentavos }, ip);
    const pagoId = newUuidsV7();
    await q.query(
      `INSERT INTO billing.pago (id, suscripcion_id, tipo, monto_centavos, moneda, metodo, referencia, proveedor, plan_id,
                                 periodo_inicio, periodo_fin, comprobante_id, registrado_por, nota)
       VALUES ($1,$2,'cobro',$3,$4,$5,$6,'manual',$7,$8,$9,$10,$11,$12)`,
      [pagoId, sub.id, d.montoCentavos, sub.moneda, d.metodo, d.referencia || null, sub.plan_id, inicio.toISOString(), fin.toISOString(), d.comprobanteId ?? null, actorId, d.nota || null],
    );
    if (d.comprobanteId) {
      await q.query(`INSERT INTO billing.comprobante_revision (comprobante_id, resultado, revisado_por) VALUES ($1,'aprobado',$2)`, [d.comprobanteId, actorId]);
    }
    await log(q, actorId, 'suscripcion.pago', sub.id, { pagoId, montoCentavos: d.montoCentavos }, ip);
    return { sub, pagoId, fin };
  });
  try {
    await sendPaymentReceivedEmail(out.sub.email, out.sub.razon_social, formatDop(d.montoCentavos, out.sub.moneda), fechaLarga(out.fin));
  } catch (e) {
    if (!(e instanceof MailDeliveryError)) throw e;
  }
  return { id: out.sub.id, estado: out.sub.estado, periodoFin: out.fin.toISOString(), pagoId: out.pagoId };
}

export async function rejectReceipt(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const { motivo } = reasonSchema.parse(body);
  return asPlatformAdmin(actorId, async (q) => {
    const c = await q.query<{ suscripcion_id: string }>(
      `SELECT c.suscripcion_id FROM billing.comprobante c
        WHERE c.id = $1 AND NOT EXISTS (SELECT 1 FROM billing.comprobante_revision r WHERE r.comprobante_id = c.id)`,
      [id],
    );
    if (!c.rows[0]) throw new AppError(409, 'Comprobante no disponible', 'El comprobante no existe o ya fue revisado.', 'receipt_reviewed');
    await q.query(`INSERT INTO billing.comprobante_revision (comprobante_id, resultado, motivo, revisado_por) VALUES ($1,'rechazado',$2,$3)`, [
      id,
      motivo,
      actorId,
    ]);
    await log(q, actorId, 'suscripcion.comprobante', c.rows[0].suscripcion_id, { comprobanteId: id, motivo }, ip);
    return { id, estado: 'rechazado' };
  });
}

const refundSchema = confirmSchema.extend({
  pagoId: z.string().uuid(),
  montoCentavos: z.number().int().positive().max(100_000_000),
  motivo: safeText(3, 500),
});

/** Refunds are money returned outside the system (bank transfer); this records it as a new ledger row. */
export async function refund(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const d = refundSchema.parse(body);
  return asPlatformAdmin(actorId, async (q) => {
    const sub = await lockSub(q, id);
    const p = await q.query<{ monto_centavos: string | number; metodo: string; plan_id: string; reembolsado: string | number }>(
      `SELECT p.monto_centavos, p.metodo, p.plan_id,
              coalesce((SELECT sum(r.monto_centavos) FROM billing.pago r
                         WHERE r.suscripcion_id = p.suscripcion_id AND r.tipo = 'reembolso' AND r.referencia = p.id::text), 0) AS reembolsado
         FROM billing.pago p WHERE p.id = $1 AND p.suscripcion_id = $2 AND p.tipo = 'cobro'`,
      [d.pagoId, sub.id],
    );
    const cobro = p.rows[0];
    if (!cobro) throw new AppError(404, 'No encontrado', 'El cobro no existe en esta suscripción.', 'not_found');
    const disponible = Number(cobro.monto_centavos) - Number(cobro.reembolsado);
    if (d.montoCentavos > disponible) {
      throw new AppError(409, 'Monto inválido', `Solo quedan ${formatDop(disponible, sub.moneda)} por reembolsar de ese cobro.`, 'refund_exceeds');
    }
    const reembolsoId = newUuidsV7();
    await q.query(
      `INSERT INTO billing.pago (id, suscripcion_id, tipo, monto_centavos, moneda, metodo, referencia, proveedor, plan_id, registrado_por, nota)
       VALUES ($1,$2,'reembolso',$3,$4,$5,$6,'manual',$7,$8,$9)`,
      [reembolsoId, sub.id, d.montoCentavos, sub.moneda, cobro.metodo, d.pagoId, cobro.plan_id, actorId, d.motivo],
    );
    await recordEvent(q, sub, 'reembolso', actorId, { pagoId: d.pagoId, montoCentavos: d.montoCentavos }, ip);
    await log(q, actorId, 'suscripcion.reembolso', sub.id, { pagoId: d.pagoId, montoCentavos: d.montoCentavos, motivo: d.motivo }, ip);
    return { id: reembolsoId, disponible: disponible - d.montoCentavos };
  });
}

export async function changePlan(actorId: string, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const { planId } = confirmSchema.extend({ planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/) }).parse(body);
  return asPlatformAdmin(actorId, async (q) => {
    const sub = await lockSub(q, id);
    if (sub.estado === 'RECHAZADA' || sub.estado === 'CANCELADA') {
      throw new AppError(409, 'Acción no permitida', 'No se puede cambiar el plan de una suscripción cerrada.', 'invalid_transition');
    }
    const plan = await q.query<{ precio_mensual_centavos: string | number }>(`SELECT precio_mensual_centavos FROM billing.plan WHERE id = $1 AND activo`, [planId]);
    if (!plan.rows[0]) throw new AppError(400, 'Plan inválido', 'Ese plan no existe o no está activo.', 'validation');
    if (planId === sub.plan_id) return { id: sub.id, planId };
    // The new price applies from the next renewal; the current period was already paid.
    await q.query(`UPDATE billing.suscripcion SET plan_id = $2, monto_centavos = $3, updated_at = now() WHERE id = $1`, [
      sub.id,
      planId,
      plan.rows[0].precio_mensual_centavos,
    ]);
    await recordEvent(q, sub, 'cambio_plan', actorId, { de: sub.plan_id, a: planId }, ip);
    await log(q, actorId, 'suscripcion.plan', sub.id, { de: sub.plan_id, a: planId }, ip);
    if (sub.tenant_id) forgetSessionsOf({ tenantId: sub.tenant_id });
    return { id: sub.id, planId };
  });
}

const STATE_ACTIONS: Record<'suspender' | 'reactivar' | 'cancelar', { event: SubscriptionEvent; action: PlatformAction }> = {
  suspender: { event: 'suspender', action: 'suscripcion.suspender' },
  reactivar: { event: 'reactivar', action: 'suscripcion.reactivar' },
  cancelar: { event: 'cancelar', action: 'suscripcion.cancelar' },
};

export async function changeState(actorId: string, which: keyof typeof STATE_ACTIONS, params: unknown, body: unknown, ip: string) {
  const { id } = uuidParam.parse(params);
  const { motivo } = reasonSchema.parse(body);
  const { event, action } = STATE_ACTIONS[which];
  return asPlatformAdmin(actorId, async (q) => {
    const sub = await lockSub(q, id);
    if (event === 'reactivar' && (!sub.periodo_fin || new Date(sub.periodo_fin) <= new Date())) {
      throw new AppError(409, 'Periodo vencido', 'El periodo pagado ya terminó. Registra un pago para reactivar.', 'period_expired');
    }
    await move(q, sub, event, actorId, { motivo }, ip);
    if (event === 'reactivar' && sub.cancelar_al_final) {
      await q.query(`UPDATE billing.suscripcion SET cancelar_al_final = false WHERE id = $1`, [sub.id]);
    }
    await log(q, actorId, action, sub.id, { motivo }, ip);
    return { id: sub.id, estado: sub.estado };
  });
}

const assignSchema = confirmSchema.extend({
  tenantId: z.string().uuid(),
  planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  periodoFin: z.string().datetime({ offset: true }),
  motivo: safeText(3, 500),
});

/** Businesses created before paid plans: put them on a plan with an explicit paid-through date (courtesy or migration). */
export async function assignToExisting(actorId: string, body: unknown, ip: string) {
  const d = assignSchema.parse(body);
  const fin = new Date(d.periodoFin);
  if (fin <= new Date()) throw new AppError(400, 'Fecha inválida', 'La fecha de vencimiento debe ser futura.', 'validation');
  return asPlatformAdmin(actorId, async (q) => {
    const n = await q.query<{ razon_social: string; rnc_enc: string | null; rnc_hash: string | null; es_plataforma: boolean; owner_id: string | null; email: string | null; nombre: string | null }>(
      `SELECT n.razon_social, n.rnc_enc, n.rnc_hash, n.es_plataforma, o.id AS owner_id, o.email, o.nombre
         FROM app.negocio n
         LEFT JOIN LATERAL (SELECT p.id, p.email, p.nombre FROM app.acceso a JOIN identity.persona p ON p.id = a.persona_id
                             WHERE a.tenant_id = n.id AND a.rol = 'owner' ORDER BY a.created_at LIMIT 1) o ON true
        WHERE n.id = $1`,
      [d.tenantId],
    );
    const neg = n.rows[0];
    if (!neg) throw new AppError(404, 'No encontrado', 'El negocio no existe.', 'not_found');
    if (neg.es_plataforma) throw new AppError(409, 'Acción no permitida', 'El espacio de administración no lleva suscripción.', 'protected');
    if (!neg.owner_id || !neg.email) throw new AppError(409, 'Sin dueño', 'El negocio no tiene dueño activo.', 'no_owner');
    const exists = await q.query(`SELECT 1 FROM billing.suscripcion WHERE tenant_id = $1`, [d.tenantId]);
    if (exists.rows.length) throw new AppError(409, 'Ya tiene suscripción', 'Ese negocio ya tiene una suscripción. Gestiónala desde su ficha.', 'has_subscription');
    const plan = await q.query<{ precio_mensual_centavos: string | number; moneda: string }>(`SELECT precio_mensual_centavos, moneda FROM billing.plan WHERE id = $1 AND activo`, [d.planId]);
    if (!plan.rows[0]) throw new AppError(400, 'Plan inválido', 'Ese plan no existe o no está activo.', 'validation');
    const id = newUuidsV7();
    await q.query(
      `INSERT INTO billing.suscripcion (id, plan_id, estado, metodo_pago, proveedor, nombre_contacto, email, razon_social, rnc_enc, rnc_hash,
                                        monto_centavos, moneda, tenant_id, persona_id, periodo_fin, autorizada_por, autorizada_at, motivo, acceso_token_hash)
       VALUES ($1,$2,'ACTIVA','transferencia','manual',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14,$15)`,
      [
        id,
        d.planId,
        neg.nombre ?? neg.email.split('@')[0],
        neg.email,
        neg.razon_social,
        neg.rnc_enc ?? encryptField(''),
        neg.rnc_hash ?? sha256(`sin-rnc:${d.tenantId}`),
        plan.rows[0].precio_mensual_centavos,
        plan.rows[0].moneda,
        d.tenantId,
        neg.owner_id,
        fin.toISOString(),
        actorId,
        d.motivo,
        sha256(randomToken(32)),
      ],
    );
    await q.query(
      `INSERT INTO billing.evento (id, suscripcion_id, evento, de, a, actor_id, detalle, ip) VALUES ($1,$2,'asignada',NULL,'ACTIVA',$3,$4::jsonb,$5)`,
      [newUuidsV7(), id, actorId, JSON.stringify({ motivo: d.motivo, periodoFin: fin.toISOString() }), ip],
    );
    await log(q, actorId, 'suscripcion.asignar', id, { tenantId: d.tenantId, plan: d.planId, periodoFin: fin.toISOString() }, ip);
    forgetSessionsOf({ tenantId: d.tenantId });
    return { id, estado: 'ACTIVA', periodoFin: fin.toISOString() };
  });
}

/* ───────────── Finance ───────────── */

const ledgerQuery = pagination.extend({ tipo: z.enum(['todos', 'cobro', 'reembolso']).default('todos') });

export async function finance(actorId: string, query: unknown) {
  const { tipo, page, pageSize } = ledgerQuery.parse(query);
  return asPlatformAdmin(actorId, async (q) => {
    const k = await q.query<Record<string, string | number>>(
      `SELECT
         coalesce((SELECT sum(monto_centavos) FROM billing.suscripcion WHERE estado IN ('ACTIVA','EN_GRACIA') AND NOT cancelar_al_final), 0) AS mrr,
         (SELECT count(*) FROM billing.suscripcion WHERE estado = 'ACTIVA')::int AS activas,
         (SELECT count(*) FROM billing.suscripcion WHERE estado = 'EN_GRACIA')::int AS en_gracia,
         (SELECT count(*) FROM billing.suscripcion WHERE estado = 'SUSPENDIDA')::int AS suspendidas,
         (SELECT count(*) FROM billing.suscripcion WHERE estado = 'CANCELADA')::int AS canceladas,
         (SELECT count(*) FROM billing.suscripcion WHERE estado = 'PENDIENTE_AUTORIZACION')::int AS pendientes,
         coalesce((SELECT sum(monto_centavos) FROM billing.pago WHERE tipo = 'cobro' AND created_at >= date_trunc('month', now())), 0) AS cobrado_mes,
         coalesce((SELECT sum(monto_centavos) FROM billing.pago WHERE tipo = 'reembolso' AND created_at >= date_trunc('month', now())), 0) AS reembolsado_mes`,
    );
    const serie = await q.query<{ mes: string; cobrado: string | number; reembolsado: string | number }>(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
              sum(monto_centavos) FILTER (WHERE tipo = 'cobro') AS cobrado,
              sum(monto_centavos) FILTER (WHERE tipo = 'reembolso') AS reembolsado
         FROM billing.pago WHERE created_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY 1 ORDER BY 1`,
    );
    const ledger = await q.query<{
      id: string;
      tipo: string;
      monto_centavos: string | number;
      moneda: string;
      metodo: string;
      referencia: string | null;
      negocio: string;
      suscripcion_id: string;
      registrado: string | null;
      created_at: Date | string;
      total: number;
    }>(
      `SELECT p.id, p.tipo, p.monto_centavos, p.moneda, p.metodo, p.referencia, s.razon_social AS negocio, p.suscripcion_id,
              r.email AS registrado, p.created_at, count(*) OVER ()::int AS total
         FROM billing.pago p JOIN billing.suscripcion s ON s.id = p.suscripcion_id
         LEFT JOIN identity.persona r ON r.id = p.registrado_por
        WHERE ($1 = 'todos' OR p.tipo = $1)
        ORDER BY p.created_at DESC, p.id LIMIT $2 OFFSET $3`,
      [tipo, pageSize, (page - 1) * pageSize],
    );
    const s = k.rows[0]!;
    return {
      mrrCentavos: Number(s.mrr),
      activas: Number(s.activas),
      enGracia: Number(s.en_gracia),
      suspendidas: Number(s.suspendidas),
      canceladas: Number(s.canceladas),
      pendientes: Number(s.pendientes),
      cobradoMesCentavos: Number(s.cobrado_mes),
      reembolsadoMesCentavos: Number(s.reembolsado_mes),
      serie: serie.rows.map((m) => ({ mes: m.mes, cobradoCentavos: Number(m.cobrado ?? 0), reembolsadoCentavos: Number(m.reembolsado ?? 0) })),
      ledger: {
        items: ledger.rows.map((p) => ({
          id: p.id,
          tipo: p.tipo,
          montoCentavos: Number(p.monto_centavos),
          moneda: p.moneda,
          metodo: p.metodo,
          referencia: p.referencia,
          negocio: p.negocio,
          suscripcionId: p.suscripcion_id,
          registradoPor: p.registrado,
          fecha: iso(p.created_at),
        })),
        total: ledger.rows[0]?.total ?? 0,
        page,
        pageSize,
      },
    };
  });
}

/* ───────────── System health (no secrets: only whether each piece is configured and reachable) ───────────── */

export async function health(actorId: string) {
  const env = getEnv();
  const started = Date.now();
  const db = await asPlatformAdmin(actorId, async (q) => {
    const m = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing.plan`);
    const sweep = await q.query<{ at: Date | string | null }>(`SELECT max(created_at) AS at FROM audit.platform_log WHERE action = 'suscripcion.barrido'`);
    const lastEvent = await q.query<{ at: Date | string | null }>(`SELECT max(created_at) AS at FROM billing.evento WHERE actor_id IS NULL AND evento IN ('vencimiento','fin_gracia','cancelar')`);
    return { planes: m.rows[0]?.n ?? 0, ultimoBarridoManual: iso(sweep.rows[0]?.at ?? null), ultimoCambioAutomatico: iso(lastEvent.rows[0]?.at ?? null) };
  });
  const latencyMs = Date.now() - started;
  const redis = !env.REDIS_URL ? 'no_configurado' : (await cacheBackend()) === 'redis' ? 'conectado' : 'error';
  const driver = await getDriver();
  return {
    api: { entorno: env.NODE_ENV, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    baseDeDatos: { ok: true, motor: driver.kind, latenciaMs: latencyMs, planes: db.planes },
    redis,
    correo: emailProviderConfigured() ? 'configurado' : 'no_configurado',
    pagos: { transferencia: transferProvider.disponible(), tarjeta: gatewayProvider.disponible(), webhook: Boolean(env.BILLING_WEBHOOK_SECRET) },
    cron: { configurado: Boolean(env.CRON_SECRET), ultimoBarridoManual: db.ultimoBarridoManual, ultimoCambioAutomatico: db.ultimoCambioAutomatico },
  };
}

/* ───────────── Renewal sweep (daily cron; the access check also applies the clock, so a missed run is safe) ───────────── */

export async function sweep(now = new Date()) {
  return withAuthBootstrap(async (q) => {
    const due = await q.query<SubRow & Record<string, unknown>>(
      `SELECT ${SUB_COLUMNS} FROM billing.suscripcion
        WHERE estado IN ('ACTIVA','EN_GRACIA') AND periodo_fin < $1 ORDER BY periodo_fin FOR UPDATE`,
      [now.toISOString()],
    );
    const counts = { enGracia: 0, suspendidas: 0, canceladas: 0 };
    for (const sub of due.rows) {
      const target = effectiveSubscriptionState(sub.estado, sub.periodo_fin ? new Date(sub.periodo_fin) : null, sub.cancelar_al_final, now);
      if (target === sub.estado) continue;
      if (target === 'CANCELADA') {
        await move(q, sub, 'cancelar', null, { motivo: 'fin_de_periodo' });
        counts.canceladas++;
        continue;
      }
      if (sub.estado === 'ACTIVA') {
        await move(q, sub, 'vencimiento', null);
        counts.enGracia++;
      }
      if (target === 'SUSPENDIDA') {
        await move(q, sub, 'fin_gracia', null);
        counts.suspendidas++;
      }
    }
    return counts;
  });
}

export async function sweepAsAdmin(actorId: string, ip: string) {
  await asPlatformAdmin(actorId, async () => undefined);
  const counts = await sweep();
  await asPlatformAdmin(actorId, (q) => log(q, actorId, 'suscripcion.barrido', actorId, counts, ip));
  return counts;
}

/* ───────────── Card gateway webhook: signed, idempotent, order-tolerant ───────────── */

export async function handleWebhook(providerId: string, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
  const provider = providerById(providerId);
  if (!provider?.parseWebhook) throw new AppError(404, 'No encontrado', 'La ruta solicitada no existe.', 'route_not_found');
  const ev: WebhookEvent = provider.parseWebhook(raw, headers);
  return withAuthBootstrap(async (q) => {
    const fresh = await q.query(
      `INSERT INTO billing.webhook_evento (proveedor, evento_id, tipo, payload_sha256) VALUES ($1,$2,$3,$4)
       ON CONFLICT (proveedor, evento_id) DO NOTHING RETURNING evento_id`,
      [provider.id, ev.id, ev.tipo, sha256(raw.toString('utf8'))],
    );
    if (!fresh.rows.length) return { recibido: true, duplicado: true };
    const resultado = await applyWebhook(q, provider.id, ev);
    await q.query(`UPDATE billing.webhook_evento SET procesado_at = now(), resultado = $3 WHERE proveedor = $1 AND evento_id = $2`, [
      provider.id,
      ev.id,
      resultado,
    ]);
    return { recibido: true, duplicado: false, resultado };
  });
}

async function applyWebhook(q: Queryable, proveedor: string, ev: WebhookEvent): Promise<string> {
  const r = await q.query<SubRow & Record<string, unknown>>(
    `SELECT ${SUB_COLUMNS} FROM billing.suscripcion
      WHERE ($1::uuid IS NOT NULL AND id = $1::uuid) OR ($2::text IS NOT NULL AND proveedor = $3 AND proveedor_ref = $2)
      LIMIT 1 FOR UPDATE`,
    [ev.suscripcionId, ev.proveedorRef, proveedor],
  );
  const sub = r.rows[0];
  if (!sub) return 'suscripcion_no_encontrada';

  if (ev.tipo === 'reembolso.exitoso') {
    await q.query(
      `INSERT INTO billing.pago (id, suscripcion_id, tipo, monto_centavos, moneda, metodo, referencia, proveedor, proveedor_evento_id, plan_id)
       VALUES ($1,$2,'reembolso',$3,$4,'tarjeta',$5,$6,$7,$8)`,
      [newUuidsV7(), sub.id, ev.montoCentavos, ev.moneda, ev.referencia, proveedor, ev.id, sub.plan_id],
    );
    await recordEvent(q, sub, 'reembolso', null, { evento: ev.id });
    return 'reembolso_registrado';
  }

  if (ev.tipo === 'pago.fallido') {
    // A failure older than the last successful charge is stale (events can arrive out of order).
    const last = await q.query<{ at: Date | string | null }>(`SELECT max(created_at) AS at FROM billing.pago WHERE suscripcion_id = $1 AND tipo = 'cobro'`, [sub.id]);
    const lastAt = last.rows[0]?.at ? new Date(last.rows[0].at) : null;
    if (lastAt && lastAt > ev.ocurridoAt) return 'ignorado_fuera_de_orden';
    if (sub.estado !== 'ACTIVA') return `ignorado_estado_${sub.estado.toLowerCase()}`;
    await move(q, sub, 'pago_fallido', null, { evento: ev.id });
    return 'en_gracia';
  }

  if (ev.moneda !== sub.moneda || ev.montoCentavos < Number(sub.monto_centavos)) {
    await recordEvent(q, sub, 'pago_monto_invalido', null, { evento: ev.id, montoCentavos: ev.montoCentavos });
    return 'monto_insuficiente';
  }
  const opened = sub.estado === 'PENDIENTE_PAGO';
  let inicio: Date | null = null;
  let fin: Date | null = null;
  if (sub.tenant_id && sub.estado !== 'RECHAZADA') {
    const currentEnd = sub.periodo_fin ? new Date(sub.periodo_fin) : null;
    inicio = currentEnd && currentEnd > ev.ocurridoAt ? currentEnd : ev.ocurridoAt;
    fin = nextPeriodEnd(currentEnd, ev.ocurridoAt);
  }
  await q.query(
    `INSERT INTO billing.pago (id, suscripcion_id, tipo, monto_centavos, moneda, metodo, referencia, proveedor, proveedor_evento_id, plan_id,
                               periodo_inicio, periodo_fin)
     VALUES ($1,$2,'cobro',$3,$4,'tarjeta',$5,$6,$7,$8,$9,$10)`,
    [newUuidsV7(), sub.id, ev.montoCentavos, ev.moneda, ev.referencia, proveedor, ev.id, sub.plan_id, inicio?.toISOString() ?? null, fin?.toISOString() ?? null],
  );
  if (opened) {
    await move(q, sub, 'pago_confirmado', null, { evento: ev.id });
    return 'pendiente_autorizacion';
  }
  if (sub.estado === 'RECHAZADA') {
    await recordEvent(q, sub, 'pago_tras_rechazo', null, { evento: ev.id });
    return 'requiere_reembolso';
  }
  if (sub.estado === 'PENDIENTE_AUTORIZACION') return 'pago_adicional_registrado';
  await q.query(`UPDATE billing.suscripcion SET periodo_fin = $2, updated_at = now() WHERE id = $1`, [sub.id, fin!.toISOString()]);
  sub.periodo_fin = fin;
  await move(q, sub, 'pago_registrado', null, { evento: ev.id });
  return 'renovada';
}
