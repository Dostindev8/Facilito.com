import { describe, expect, it } from 'vitest';
import { StubPsfe, processComprobante } from './engine.js';

describe('e-CF decoupled engine', () => {
  it('accepts via stub PSFE', async () => {
    const r = await processComprobante(new StubPsfe(), { ventaId: 'v1', total: '100.00' });
    expect(r.status).toBe('accepted');
    expect(r.eNcf).toBeTruthy();
  });

  it('marks contingency when PSFE down — sale already closed elsewhere', async () => {
    const r = await processComprobante(new StubPsfe(true), { ventaId: 'v2', total: '50.00' });
    expect(r.status).toBe('contingency');
  });
});
