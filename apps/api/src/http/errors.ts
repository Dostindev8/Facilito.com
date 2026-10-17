import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { InvoiceCalcError } from '@facilito/domain';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail: string,
    public readonly code?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail);
  }
}

/** RFC 9457 Problem Details */
export function sendProblem(reply: FastifyReply, err: AppError): FastifyReply {
  return reply
    .status(err.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .send({
      type: `https://facilito.lcs/errors/${err.code ?? 'error'}`,
      title: err.title,
      status: err.status,
      detail: err.detail,
      code: err.code,
      ...(err.extra ?? {}),
    });
}

interface PgLikeError {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Translates database errors into business messages without leaking SQL. */
export function mapDbError(e: unknown): AppError | null {
  const err = e as PgLikeError;
  const msg = err?.message ?? '';
  if (msg.includes('NEGATIVE_STOCK')) {
    return new AppError(409, 'Stock insuficiente', 'No hay suficiente inventario para completar la operación.', 'stock');
  }
  if (msg.includes('PRODUCT_NOT_FOUND')) {
    return new AppError(404, 'Producto no encontrado', 'El producto no existe en este negocio.', 'not_found');
  }
  if (msg.includes('business must keep at least one owner')) {
    return new AppError(409, 'Dueño requerido', 'El negocio debe conservar al menos un dueño.', 'owner_required');
  }
  switch (err?.code) {
    case '23505':
      return new AppError(409, 'Registro duplicado', 'Ya existe un registro con esos datos.', 'duplicate', {
        constraint: err.constraint,
      });
    case '23503':
      return new AppError(400, 'Referencia inválida', 'Uno de los elementos seleccionados no existe.', 'reference');
    case '23514':
      return new AppError(400, 'Dato inválido', 'Algún valor no cumple las reglas del negocio.', 'check');
    case '22P02':
    case '22003':
      return new AppError(400, 'Formato inválido', 'Revisa el formato de los datos enviados.', 'format');
    case '42501':
      return new AppError(403, 'Sin permiso', 'No tienes permiso para esta operación.', 'forbidden');
    case '42P01':
      return new AppError(
        503,
        'Servicio no disponible',
        'El catálogo de planes no está listo. Intenta de nuevo en unos minutos.',
        'plans_unavailable',
      );
    default:
      return null;
  }
}

export function problemHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    sendProblem(reply, error);
    return;
  }
  if (error instanceof ZodError) {
    sendProblem(
      reply,
      new AppError(400, 'Datos inválidos', 'Revisa los campos marcados.', 'validation', {
        errors: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      }),
    );
    return;
  }
  if (error instanceof InvoiceCalcError) {
    sendProblem(reply, new AppError(400, 'Factura inválida', error.message, 'invoice', { line: error.lineIndex }));
    return;
  }
  const db = mapDbError(error);
  if (db) {
    sendProblem(reply, db);
    return;
  }
  const fe = error as FastifyError;
  if (fe.statusCode === 429) {
    sendProblem(reply, new AppError(429, 'Demasiadas solicitudes', 'Espera un momento e intenta de nuevo.', 'rate_limit'));
    return;
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    sendProblem(reply, new AppError(fe.statusCode, 'Solicitud inválida', 'La solicitud no se pudo procesar.', 'bad_request'));
    return;
  }
  request.log.error({ err: { message: error.message, code: (error as PgLikeError).code } }, 'unhandled');
  sendProblem(reply, new AppError(500, 'Error interno', 'Ocurrió un error. Intenta de nuevo.', 'internal'));
}
