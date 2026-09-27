# ADR-009: Identity schema vs tenant schema

## Context
One person may be Owner in business A and Accountant in business B.

## Decision
Schema `identity` (persona, TOTP, refresh tokens, devices) scoped by `app.persona_id`. Schema `app` (negocio and all business data) scoped by `app.tenant_id`. Switching business issues a new access JWT; sessions are never reused across tenants.

## Alternatives
- Embed credentials per tenant: duplicates 2FA and password.
- Global session carrying multiple tenants: increases blast radius.

## Consequences
Login resolves persona; business selection mints tenant-bound token.

## Cost
Slightly more auth endpoints; clearer isolation story.
