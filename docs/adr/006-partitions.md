# ADR-006: Time + hash partitioning for high-volume tables

## Context
Kardex and audit grow unboundedly. Partition-per-tenant explodes catalog.

## Decision
`PARTITION BY RANGE (created_at)` monthly with `HASH (tenant_id)` subpartitions (fixed bucket count). Indexes lead with `tenant_id`.

## Alternatives
- Partition only by tenant: rejected.
- Single table + archive jobs only: insufficient at scale.

## Consequences
Migration tooling must create future partitions; retention process is the only audit mutator.

## Cost
Modest storage management work; avoids catalog bloat.
