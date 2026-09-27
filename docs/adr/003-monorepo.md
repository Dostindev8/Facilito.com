# ADR-003: pnpm + Turborepo monorepo

## Context
Web, mobile, API, e-CF, and Copilot share domain types and vertical configs.

## Decision
pnpm workspaces + Turborepo. TypeScript strict across packages. Module boundary lint by convention (public `index` exports only).

## Alternatives
- Polyrepo: slower shared type evolution.
- npm workspaces: fine, pnpm preferred for disk and lockfile.

## Consequences
Single CI pipeline; shared `@facilito/domain` and `@facilito/ui`.

## Cost
CI minutes shared; no extra cloud spend.
