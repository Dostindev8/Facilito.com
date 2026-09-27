# ADR-008: External ports with stub adapters

## Context
LLM provider, PSFE, and vault are not finalized.

## Decision
Define TypeScript ports + `.env.example` variables. Local/CI use stub adapters. No secrets in repo or frontend bundles. Gitleaks in CI.

## Alternatives
- Hardcode a vendor: locks LCS and invents scope.
- Skip ports until vendor chosen: blocks Copilot/e-CF design.

## Consequences
Honest technical limits documented in `docs/tech-debt.md`. Production ZDR/PSFE require real contracts.

## Cost
Stub maintenance; avoids premature vendor spend.
