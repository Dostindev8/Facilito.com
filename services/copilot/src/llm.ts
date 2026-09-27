import { isCopilotLevel3Action } from '@facilito/domain';

export interface LlmPort {
  complete(prompt: string): Promise<string>;
}

export class StubLlm implements LlmPort {
  async complete(prompt: string): Promise<string> {
    if (/fiscal|dgii|ncf/i.test(prompt) && !/BEGIN UNTRUSTED/.test(prompt)) {
      return 'No tengo ese dato.';
    }
    return 'Stub LLM response (zero-data-retention flag must be enforced by provider contract).';
  }
}

export function guardAction(action: string): { allowed: boolean; reason?: string } {
  if (isCopilotLevel3Action(action)) {
    return { allowed: false, reason: 'level_3_forbidden' };
  }
  return { allowed: true };
}
