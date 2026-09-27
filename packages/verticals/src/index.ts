import { createRequire } from 'node:module';
import type { ErrorObject } from 'ajv';
import colmado from './profiles/colmado.json' with { type: 'json' };
import ferreteria from './profiles/ferreteria.json' with { type: 'json' };
import farmacia from './profiles/farmacia.json' with { type: 'json' };

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AjvCtor = require('ajv') as new (opts?: object) => {
  compile: (schema: object) => ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
};
const addFormats = require('ajv-formats') as (ajv: unknown) => void;

export interface VerticalProfile {
  id: string;
  version: string;
  label: string;
  productAttrSchema: Record<string, unknown>;
  features: {
    lots: boolean;
    fefo: boolean;
    barcode: boolean;
  };
}

export const VERTICALS: Record<string, VerticalProfile> = {
  colmado: colmado as VerticalProfile,
  ferreteria: ferreteria as VerticalProfile,
  farmacia: farmacia as VerticalProfile,
};

const ajv = new AjvCtor({ allErrors: true, strict: false });
addFormats(ajv);

export function listVerticals(): VerticalProfile[] {
  return Object.values(VERTICALS);
}

export function getVertical(id: string): VerticalProfile | undefined {
  return VERTICALS[id];
}

export function validateProductAttrs(
  verticalId: string,
  attrs: unknown,
): { ok: true } | { ok: false; errors: ErrorObject[] } {
  const profile = getVertical(verticalId);
  if (!profile) {
    return {
      ok: false,
      errors: [
        {
          keyword: 'vertical',
          instancePath: '',
          schemaPath: '',
          params: {},
          message: `Unknown vertical: ${verticalId}`,
        },
      ],
    };
  }
  const validate = ajv.compile(profile.productAttrSchema);
  const ok = validate(attrs);
  if (ok) return { ok: true };
  return { ok: false, errors: validate.errors ?? [] };
}
