# ADR-010: Runtime topology — Fastify, driver abstraction, proxy trust and session hint

## Context
The web app (Next 15) serves the UI and rewrites `/api/*` to the API, so the browser only ever talks to one origin. Four decisions follow from that and from the local constraints (no Docker on the author workstation, see TD-006).

## Decision
1. **Fastify 5 instead of NestJS.** Plugin model (helmet, rate-limit, cookie) plus Zod validation covers the needs with a smaller surface and faster cold start. Controllers stay thin; business rules live in services, so a later move to Nest only touches the HTTP layer.
2. **Database driver abstraction.** `DATABASE_DRIVER=pglite` runs embedded Postgres (same SQL, same RLS policies, same `facilito_app` role without BYPASSRLS) for local work and tests; `DATABASE_DRIVER=pg` targets a real Postgres in CI and production. Migrations are plain SQL shared by both.
3. **Proxy trust.** Next's rewrite forwards a client-supplied `X-Forwarded-For` unchanged, so trusting it would let anyone pick their own rate-limit bucket. `TRUST_PROXY=0` is the default: the API keys rate limits on the socket address. Production sets `TRUST_PROXY=1` only behind an edge proxy (load balancer / CDN) that overwrites `X-Forwarded-For`. The API binds to `API_HOST=127.0.0.1` so only the co-located web server can reach it; startup logs a warning in production when `TRUST_PROXY=0`.
4. **Refresh cookie plus session hint.** The refresh token lives in `fc_rt` (httpOnly, SameSite=Strict, path `/api/v1/auth`), rotated on every use with reuse detection that revokes the whole family. A second cookie `fc_s=1` (readable, path `/`, same lifetime, no secret) tells the client whether a refresh is worth attempting, which avoids a guaranteed 401 on anonymous visits. The server sets and clears both together. Refresh has its own rate limit (`AUTH_REFRESH_RATE_LIMIT_MAX`) separate from login, so several devices behind one shop IP are not logged out.

## Alternatives
- Trust the first `X-Forwarded-For` hop: spoofable through the rewrite.
- Call the API cross-origin with CORS: more attack surface, cookies need SameSite=None.
- Store the refresh token in localStorage: readable by any XSS.

## Consequences
Deployments must document the edge proxy. The hint cookie leaks only "a session may exist", never a credential.

## Cost
One extra cookie and one env variable per concern (`API_HOST`, `TRUST_PROXY`, `AUTH_REFRESH_RATE_LIMIT_MAX`).
