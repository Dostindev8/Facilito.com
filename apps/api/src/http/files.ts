import type { FastifyReply } from 'fastify';

/** ASCII-only filename for Content-Disposition (no header injection, no path segments). */
export function safeFilename(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'archivo'
  );
}

export function sendFile(
  reply: FastifyReply,
  bytes: Buffer | string,
  mime: string,
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): FastifyReply {
  return reply
    .header('content-type', mime)
    .header('content-disposition', `${disposition}; filename="${safeFilename(filename)}"`)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .send(bytes);
}
