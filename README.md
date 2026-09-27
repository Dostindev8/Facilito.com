# Facilito

Multi-tenant business administration by **Logic Code Spot**.

## Quick start

1. Copy `.env.example` → `.env` and adjust.
2. `docker compose up -d postgres redis`
3. Generate JWT keys into `secrets/`.
4. `pnpm install`
5. `pnpm --filter @facilito/api db:bootstrap && pnpm migrate`
6. `pnpm dev`

## Structure

See the master prompt / ADR-003. Sprint 0 builds isolation before business modules.

## Brand

Emerald `#0B7A45`, accent orange `#F47B20`, mint surfaces — tokens in `@facilito/ui`.
