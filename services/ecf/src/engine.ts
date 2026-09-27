import type { FiscalStatus } from '@facilito/domain';

export interface PsfePort {
  submit(xml: string): Promise<{ status: FiscalStatus; eNcf?: string; error?: string }>;
}

/** Stub PSFE — never blocks POS; maps to contingency on failure. */
export class StubPsfe implements PsfePort {
  constructor(private readonly fail = false) {}

  async submit(xml: string): Promise<{ status: FiscalStatus; eNcf?: string; error?: string }> {
    if (this.fail || xml.includes('FORCE_FAIL')) {
      return { status: 'contingency', error: 'PSFE unavailable' };
    }
    // TODO: VERIFICAR EN VIVO — e-NCF allocation and DGII acceptance codes
    return { status: 'accepted', eNcf: `E310000000001` };
  }
}

export function buildSignedXml(ventaId: string, total: string): string {
  // TODO: VERIFICAR EN VIVO — official e-CF XML schema and signing
  return `<ECF venta="${ventaId}" total="${total}" signed="stub"/>`;
}

export async function processComprobante(
  psfe: PsfePort,
  input: { ventaId: string; total: string },
): Promise<{ status: FiscalStatus; eNcf?: string; xml: string }> {
  const xml = buildSignedXml(input.ventaId, input.total);
  const result = await psfe.submit(xml);
  return { status: result.status, eNcf: result.eNcf, xml };
}
