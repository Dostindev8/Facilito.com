import { describe, expect, it } from 'vitest';
import { guardAction, StubLlm } from './llm.js';

describe('copilot service guards', () => {
  it('blocks level 3', () => {
    expect(guardAction('adjust_inventory_direct').allowed).toBe(false);
    expect(guardAction('read_sales').allowed).toBe(true);
  });

  it('stub llm avoids inventing without docs', async () => {
    const text = await new StubLlm().complete('¿Cuál es el NCF fiscal?');
    expect(text).toContain('No tengo ese dato');
  });
});
