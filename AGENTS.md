# AGENTS.md — Facilito

Instrucciones para cualquier agente (Cursor / Claude Code / CI). Protocolo: **GOD-STACK-ING v8.3** (`DIGEST.md` + este archivo).

## Stack

- Turborepo + pnpm · Node ≥22
- `apps/web` — Next.js 15 (App Router) · Vercel project `facilito` → https://facilitord.vercel.app
- `apps/api` — Fastify · Vercel project `api-facilito` → https://api-facilito.vercel.app
- `packages/domain` — planes, business-types, RNC (fuente única)
- Idioma UI: español RD · moneda RD$ · marca `#00A651` / `#F5A623` / `#1A2B3C`

## Antes de editar

1. Leer `docs/audit/STATUS-AREAS.md` (qué está ✅ / 🔒).
2. Billing/prod: `docs/ops/PROD-BILLING.md`.
3. EXTEND-NEVER-OVERWRITE: no rediseñar login/logo; no inventar sellos ni datos bancarios.
4. Web: importar `@facilito/domain/plans` (subpath), no el barrel que tira `node:crypto`.
5. No commitear `apps/mobile/tsconfig.json` ni `.env*`.

## Comandos

```bash
pnpm typecheck && pnpm test
pnpm --filter @facilito/web build
pnpm migrate                          # necesita DATABASE_ADMIN_URL (owner/unpooled)
pnpm e2e
```

## Smoke prod

```
GET https://api-facilito.vercel.app/v1/billing/plans   → 200, 3 planes
https://facilitord.vercel.app/login
https://facilitord.vercel.app/suscribirme
https://facilitord.vercel.app/legal/privacidad
```

Checkout real exige `BILLING_BANK_*` en Vercel API (`metodos.transferencia === true`).

## Fuentes de verdad

| Qué | Dónde |
|---|---|
| Precios / trust | `packages/domain/src/plans.ts` |
| Tipos de negocio | `packages/domain/src/business-types.ts` |
| RNC | `packages/domain/src/rnc.ts` |
| Status vivo | `docs/audit/STATUS-AREAS.md` |

## Git / deploy

- Commit/push/merge/prod solo si el usuario lo pide (o mega-prompt de ship explícito).
- Conventional Commits · PR con CI `quality` verde.
- Vercel stuck Building → `npx vercel redeploy <url> --target production`.

## Playbook personal (agente Dostin)

`~/.cursor/skills/god-stack-ing/references/facilito-ops.md` · `agent-toolkit.md`
