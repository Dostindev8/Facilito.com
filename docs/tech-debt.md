# Technical debt register

| ID | Item | Risk | Cost estimate | Status |
|---|---|---|---|---|
| TD-001 | PSFE / DGII live certification | High (fiscal) | Vendor + legal | Open — stub only |
| TD-002 | LLM provider ZDR contract | High (privacy) | Contract negotiation | Open — stub + flag |
| TD-003 | Production vault (certs, JWT keys) | High | Ops setup | Open — file paths in local |
| TD-004 | TLS 1.3 termination on public domain | Medium | Hosting | Open — local HTTP |
| TD-005 | Exact DGII e-CF deadlines/formats | High | Research | Open — `VERIFICAR EN VIVO` |
| TD-006 | Docker not available on author workstation | Medium | Install Docker Desktop | Open — CI uses service containers |
| TD-007 | WatermelonDB full schema sync polish | Medium | 2-4d | Open — outbox core shipped |
| TD-008 | Expo SDK 52 toolchain pulls vulnerable `tar` (critical/high), `image-size` (high), `uuid` (moderate) in `apps/mobile`; overrides break `@expo/cli`/Metro, so `pnpm audit` in CI stays red until the upgrade. `node-forge@1.4.0` (GHSA-86w9-cpqp-85rv, high, no patched release) arrives only via `expo` > `@expo/cli` / `selfsigned` in `apps/mobile` and is listed in `pnpm.auditConfig.ignoreGhsas` — review by 2026-11-30 or on the Expo upgrade, whichever comes first | High (dev toolchain, not shipped to web/API) | Expo SDK upgrade, 1-2d | Open |
| TD-009 | Legacy `POST /v1/sales` takes `precioUnitario` from the client (new `/v1/invoices` prices server-side) | Medium | Reprice server-side or retire the route, 0.5d | Closed 2026-09-28 — price and ITBIS come from `app.producto`; only owner/manager may override the price (`sales.int.test.ts`) |
| TD-010 | Inventory export is CSV (Excel-compatible); native `.xlsx` pending | Low | 0.5d | Open |
| TD-011 | Tenant logo upload for invoices/PDF (uses the Facilito mark today) | Low | 1d (via untrusted-file pipeline) | Open |
| TD-012 | DGII 606/607/608 generators exist on legacy routes but are disabled in Reportes until the official layout is verified live (`VERIFICAR EN VIVO`) | Medium (fiscal) | Live verification + 1d | Open — third party |
| TD-013 | TOTP enrolment shows the secret/URI; QR image pending | Low | 0.5d | Open |
| TD-014 | Transactional email provider (password reset, invites) | Medium | Vendor + 1d | Open — third party |
| TD-015 | Lighthouse runs are local scripts (`scripts/lighthouse*.mjs`); not gated in CI | Low | 0.5d | Open |
| TD-016 | Edge proxy that overwrites `X-Forwarded-For` before enabling `TRUST_PROXY=1` (ADR-010) | High (rate limiting) | Hosting | Open — defaults safe (`TRUST_PROXY=0`) |

Update this file whenever a TODO/FIXME is introduced.
