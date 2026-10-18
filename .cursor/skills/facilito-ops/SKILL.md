---
name: facilito-ops
description: >-
  Use when working in the Facilito monorepo — billing/planes, Neon migrate, suscribirme/login,
  Vercel deploy, RNC, business types, admin subscriptions, or STATUS-AREAS. Load AGENTS.md and
  docs/ops/PROD-BILLING.md; never invent bank data or trust badges.
---

# Facilito Ops (project skill)

## Arranque

1. `AGENTS.md` + `docs/audit/STATUS-AREAS.md`
2. Billing/prod → `docs/ops/PROD-BILLING.md`
3. Personal playbook (si existe): `~/.cursor/skills/god-stack-ing/references/facilito-ops.md`

## Fuentes de verdad

- Planes: `packages/domain/src/plans.ts`
- Tipos negocio: `packages/domain/src/business-types.ts`
- RNC: `packages/domain/src/rnc.ts`
- Web façade: `apps/web/src/lib/plans.ts` (reexport)

## Comandos frecuentes

```bash
pnpm --filter @facilito/domain test
pnpm --filter @facilito/api test
pnpm --filter @facilito/web typecheck
pnpm migrate   # DATABASE_ADMIN_URL = Neon unpooled/owner
pnpm e2e
```

## Smoke

- `GET https://api-facilito.vercel.app/v1/billing/plans` → 200
- Transferencia: `metodos.transferencia` solo true con `BILLING_BANK_*` en Vercel API

## Reglas

- EXTEND-NEVER-OVERWRITE en login/logo
- Sin sellos inventados
- Borrar `.env.prod.local` tras migrate
- No tocar `apps/mobile/tsconfig.json` salvo pedido
