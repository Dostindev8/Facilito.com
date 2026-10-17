import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';

/**
 * Payment providers behind one contract. Today only bank transfer (verified by a platform admin) can take money.
 * A card gateway (Azul, CardNet or PayPal, see docs/audit/DECISIONES_PENDIENTES.md) plugs in by implementing
 * startCheckout + parseWebhook; the subscription state machine, ledger and idempotency stay the same.
 */

export type CheckoutStart =
  | { kind: 'instrucciones'; banco: BankInstructions }
  | { kind: 'redireccion'; url: string; proveedorRef: string };

export interface BankInstructions {
  banco: string;
  cuenta: string;
  tipoCuenta: string;
  titular: string;
  documentoTitular: string;
}

export interface WebhookEvent {
  id: string;
  tipo: 'pago.exitoso' | 'pago.fallido' | 'reembolso.exitoso';
  suscripcionId: string | null;
  proveedorRef: string | null;
  montoCentavos: number;
  moneda: 'DOP' | 'USD';
  referencia: string | null;
  ocurridoAt: Date;
}

export interface PaymentProvider {
  id: string;
  metodo: 'transferencia' | 'tarjeta';
  disponible(): boolean;
  startCheckout(input: { suscripcionId: string; montoCentavos: number; email: string }): Promise<CheckoutStart>;
  /** Throws AppError(400/401) when the request is not authentic. Never trusts the payload before the signature. */
  parseWebhook?(raw: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent;
}

export function bankInstructions(): BankInstructions | null {
  const env = getEnv();
  if (!env.BILLING_BANK_NAME || !env.BILLING_BANK_ACCOUNT || !env.BILLING_BANK_HOLDER) return null;
  return {
    banco: env.BILLING_BANK_NAME,
    cuenta: env.BILLING_BANK_ACCOUNT,
    tipoCuenta: env.BILLING_BANK_ACCOUNT_TYPE || 'Corriente',
    titular: env.BILLING_BANK_HOLDER,
    documentoTitular: env.BILLING_BANK_HOLDER_ID || '',
  };
}

export const transferProvider: PaymentProvider = {
  id: 'manual',
  metodo: 'transferencia',
  disponible: () => bankInstructions() !== null,
  async startCheckout() {
    const banco = bankInstructions();
    if (!banco) {
      throw new AppError(503, 'Pagos no disponibles', 'Los pagos por transferencia aún no están habilitados. Escríbenos por WhatsApp.', 'billing_unavailable');
    }
    return { kind: 'instrucciones', banco };
  },
};

const SIGNATURE_TOLERANCE_SECONDS = 300;

const webhookPayload = z
  .object({
    id: z.string().min(1).max(200),
    tipo: z.enum(['pago.exitoso', 'pago.fallido', 'reembolso.exitoso']),
    ocurridoAt: z.string().datetime(),
    datos: z
      .object({
        suscripcionId: z.string().uuid().nullable().optional(),
        proveedorRef: z.string().min(1).max(120).nullable().optional(),
        montoCentavos: z.number().int().positive().max(100_000_000),
        moneda: z.enum(['DOP', 'USD']).default('DOP'),
        referencia: z.string().max(120).nullable().optional(),
      })
      .refine((d) => d.suscripcionId || d.proveedorRef, 'suscripcionId o proveedorRef requerido'),
  })
  .passthrough();

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` — the same scheme most gateways use. */
export function verifySignature(raw: Buffer, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): void {
  const bad = () => new AppError(401, 'Firma inválida', 'La firma del webhook no es válida.', 'webhook_signature');
  if (!header || header.length > 500) throw bad();
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1 ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) throw bad();
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) throw bad();
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  const given = Buffer.from(v1, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();
}

export function signWebhook(raw: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Generic signed gateway (relay from the card processor or its integration). Disabled until BILLING_WEBHOOK_SECRET is set. */
export const gatewayProvider: PaymentProvider = {
  id: 'pasarela',
  metodo: 'tarjeta',
  disponible: () => false,
  async startCheckout() {
    throw new AppError(503, 'Tarjeta no disponible', 'El pago con tarjeta estará disponible pronto. Usa transferencia.', 'billing_unavailable');
  },
  parseWebhook(raw, headers) {
    const secret = getEnv().BILLING_WEBHOOK_SECRET;
    if (!secret) throw new AppError(404, 'No encontrado', 'La ruta solicitada no existe.', 'route_not_found');
    const sig = headers['x-facilito-signature'];
    verifySignature(raw, Array.isArray(sig) ? sig[0] : sig, secret);
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new AppError(400, 'Payload inválido', 'El cuerpo del webhook no es JSON válido.', 'webhook_payload');
    }
    const p = webhookPayload.safeParse(json);
    if (!p.success) throw new AppError(400, 'Payload inválido', 'El evento no tiene el formato esperado.', 'webhook_payload');
    const d = p.data.datos;
    return {
      id: p.data.id,
      tipo: p.data.tipo,
      suscripcionId: d.suscripcionId ?? null,
      proveedorRef: d.proveedorRef ?? null,
      montoCentavos: d.montoCentavos,
      moneda: d.moneda,
      referencia: d.referencia ?? null,
      ocurridoAt: new Date(p.data.ocurridoAt),
    };
  },
};

const PROVIDERS: Record<string, PaymentProvider> = { manual: transferProvider, pasarela: gatewayProvider };

export function providerById(id: string): PaymentProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id]! : null;
}
