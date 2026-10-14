import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addStaff, api, bootApp, createProduct, register, shutdown, type Session } from './helpers.js';

const mail = vi.hoisted(() => ({
  configured: true,
  fail: false,
  sent: [] as Array<{ to: string; negocio: string; numero: string; total: string; filename: string; bytes: number }>,
}));
vi.mock('../services/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/mailer.js')>();
  return {
    ...actual,
    emailProviderConfigured: () => mail.configured,
    sendInvoiceEmail: async (to: string, negocio: string, numero: string, total: string, pdf: { filename: string; bytes: Buffer }) => {
      if (mail.fail) throw new actual.MailDeliveryError('smtp down');
      mail.sent.push({ to, negocio, numero, total, filename: pdf.filename, bytes: pdf.bytes.length });
    },
  };
});

let app: FastifyInstance;
let owner: Session;

beforeAll(async () => {
  app = await bootApp();
  owner = await register(app);
});
afterAll(async () => {
  await shutdown(app);
});
beforeEach(() => {
  mail.configured = true;
  mail.fail = false;
  mail.sent.length = 0;
});

async function newInvoice(s: Session) {
  const p = await createProduct(app, s, { precioVenta: '100', stockInicial: '5' });
  const res = await api(app, s).post('/v1/invoices', { clientUuid: randomUUID(), metodoPago: 'efectivo', ncfTipo: null, lineas: [{ productoId: p.id, cantidad: '1' }] });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; numeroLabel: string };
}

describe('envío de factura por correo', () => {
  it('adjunta el PDF y lo envía a la dirección indicada', async () => {
    const f = await newInvoice(owner);
    expect((await api(app, owner).get(`/v1/invoices/${f.id}`)).json().emailDisponible).toBe(true);

    const res = await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: '  Cliente@Example.com ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enviado: true, email: 'cliente@example.com' });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'cliente@example.com', numero: f.numeroLabel, total: 'RD$ 118.00' });
    expect(mail.sent[0]!.filename).toMatch(/\.pdf$/);
    expect(mail.sent[0]!.bytes).toBeGreaterThan(500);
  });

  it('rechaza correos inválidos y campos extra', async () => {
    const f = await newInvoice(owner);
    expect((await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: 'no-es-correo' })).statusCode).toBe(400);
    expect((await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: 'a@b.com', cc: 'x@y.com' })).statusCode).toBe(400);
    expect((await api(app, owner).post(`/v1/invoices/${f.id}/email`, {})).statusCode).toBe(400);
    expect(mail.sent).toHaveLength(0);
  });

  it('no envía facturas anuladas ni de otro negocio', async () => {
    const f = await newInvoice(owner);
    await api(app, owner).post(`/v1/invoices/${f.id}/void`, { motivo: 'Error de digitación' });
    const voided = await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: 'cliente@example.com' });
    expect(voided.statusCode).toBe(409);
    expect(voided.json().code).toBe('invoice_voided');

    const other = await register(app);
    const g = await newInvoice(owner);
    expect((await api(app, other).post(`/v1/invoices/${g.id}/email`, { email: 'cliente@example.com' })).statusCode).toBe(404);
    expect(mail.sent).toHaveLength(0);
  });

  it('responde 503 sin proveedor y 502 si el SMTP falla', async () => {
    const f = await newInvoice(owner);
    mail.configured = false;
    expect((await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: 'cliente@example.com' })).statusCode).toBe(503);
    mail.configured = true;
    mail.fail = true;
    const res = await api(app, owner).post(`/v1/invoices/${f.id}/email`, { email: 'cliente@example.com' });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('email_delivery_failed');
  });

  it('roles sin permiso de venta no pueden enviar', async () => {
    const f = await newInvoice(owner);
    const accountant = await addStaff(app, owner.tenantId, 'accountant');
    expect((await api(app, accountant).post(`/v1/invoices/${f.id}/email`, { email: 'cliente@example.com' })).statusCode).toBe(403);
  });
});
