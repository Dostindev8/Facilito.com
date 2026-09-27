# ADR-005: Exact money with decimal.js

## Context
Floating point corrupts inventory costs and tax totals.

## Decision
PostgreSQL `numeric(20,4)` and TypeScript `decimal.js` via `@facilito/domain` Money. Half-up rounding in one place. DGII-specific rounding marked `TODO: VERIFICAR EN VIVO`.

## Alternatives
- Integer cents only: awkward for multi-currency and 4-decimal costs.
- `number`: forbidden.

## Consequences
All APIs exchange money as strings. Tests assert half-up behavior.

## Cost
None material; prevents financial defects.
