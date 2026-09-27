# ADR-002: Kysely over Prisma

## Context
Need typed SQL with explicit control of RLS session variables and money as numeric.

## Decision
NestJS + Kysely + versioned SQL migrations. Prisma is excluded because it obscures RLS session control.

## Alternatives
- Prisma + middleware: rejected.
- Raw `pg` only: workable but loses typed builders.

## Consequences
More explicit SQL; migrations are first-class artifacts.

## Cost
Slightly more developer time vs ORM; lower risk of silent tenant leakage.
