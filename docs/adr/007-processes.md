# ADR-007: Modular NestJS monolith + side processes

## Context
e-CF and Copilot failures must not stop POS sales.

## Decision
Business API is a NestJS modular monolith. `services/ecf` and `services/copilot` are separate Node processes sharing Postgres + Redis queues.

## Alternatives
- Full microservices from day one: over-architecture (Ley 3).
- Everything in one process: fiscal/LLM latency and crash risk.

## Consequences
Queue contracts must be versioned; local Compose runs all three.

## Cost
Two small Node processes; Redis already required.
