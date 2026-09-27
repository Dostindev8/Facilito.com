# Auth & session security review (Fase 1 DoD)

Date: 2026-09-24

## Scope
Persona/Acceso separation, Argon2id, TOTP, JWT RS256 short-lived access, refresh rotation + reuse detection, rate limits, tenant from token only.

## Findings addressed in code
- Passwords: Argon2id (not bcrypt).
- Access JWT: RS256, typ claim, tenantId/rol from token.
- Refresh: hashed at rest; reuse revokes family.
- Switch tenant: mints new access token.
- Rate limit on auth routes; `trustProxy: true` + IP key including X-Forwarded-For first hop.
- RLS FORCE on business tables; app role NOBYPASSRLS.

## Residual / Verificación Viva
- Production keys must come from vault (TD-003).
- TLS termination on public edge (TD-004).
- Brute-force lockout thresholds: tune after traffic metrics.

## Verdict
Auth/session design meets Sprint 0 + Fase 1 DoD for local/CI. Production hardening checklist remains in `docs/tech-debt.md`.
