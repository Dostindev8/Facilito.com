# ADR-004: pgvector for Copilot RAG

## Context
Copilot needs tenant-isolated embeddings. Extra vector DB adds ops cost.

## Decision
pgvector in the same PostgreSQL instance, with mandatory `tenant_id` filter (and RLS). Qdrant deferred until scale metrics demand it.

## Alternatives
- Qdrant from day one: more isolation surface, more infra.
- External SaaS vectors: data residency and ZDR complexity.

## Consequences
One less service in MVP; vector isolation covered by the isolation suite.

## Cost
Shared Postgres; monitor embedding table growth.
