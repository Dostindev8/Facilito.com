# apps/api

Modular Fastify API (`/v1`) with Kysely/pg, RLS session GUCs, Argon2id auth, audit hash chain.

## Module order
migrations → repositories (SQL in services) → services → routes in `main.ts` → tests

## Isolation
`pnpm test:isolation` with `RUN_ISOLATION=1` and Postgres.
