# ADR-011: e-CF fiscal route — integrate a certified provider behind a fiscal adapter

Status: **Proposed** (needs the owner's choice of provider and a contador's confirmation before Fase 2 code is merged).
Date: 2026-10-05

## Context
- Facilito issues invoices with legacy NCF (`B01`/`B02`, `packages/domain/src/invoice.ts` `formatNcf`) and has a decoupled `services/ecf` engine with a contingency queue, but it does not sign XML, does not talk to DGII and has no provider integration (`services/ecf/src/engine.ts`, `.env.example` `PSFE_*` are placeholders). Reports 606/607/608 are stubs (`apps/api/src/routes/legacy.routes.ts:180`, pinned by `characterization.int.test.ts`).
- DGII Aviso 06-26 (6-may-2026, read on dgii.gov.do on 2026-10-05) extended the e-CF obligation for small, micro and unclassified taxpayers by six months to **15-nov-2026**, with sanctions under Ley 32-23 art. 26/27; DGII stated there will be no further extension. Facilito's target customers are exactly those taxpayers. Six weeks remain.
- DGII recognises three ways for a taxpayer to issue e-CF: its own certified software, a certified provider of electronic invoicing services (PSFE), or the free DGII Facturador Gratuito. Becoming a PSFE requires being an electronic issuer, at least three certified clients and a software activity in the RNC.

## Options
**A. Certified provider (PSFE) through an API adapter.** Facilito keeps the commercial document, inventory, ITBIS and reports; a provider signs, sends to DGII and returns TrackId / status / QR / security code. Facilito stays a management tool and never claims DGII certification (rule R11).
- Candidates seen publicly on 2026-10-05 (prices are the providers' own, unverified with them): ef2 (API plan with the 10 e-CF types and a sandbox, ~RD$2,499/month), EmiteF (free up to 30 documents, then from ~RD$5,000), Factoa (~RD$1,000 for 150), Factura Dominicana (~RD$1,380 for 250). Third-party estimates put certified-provider cost at RD$890–4,500/month per issuer. Each taxpayer still needs its own digital certificate (~RD$2,000–5,000/year).
- Lead time: days to a few weeks (contract + sandbox + adapter). Fits the deadline.

**B. Facilito certifies its own software and later becomes a PSFE.** Full control and no per-document fee, but requires the DGII certification process for each issuing taxpayer, XML signing (XMLDSig) and certificate custody (HSM/KMS), plus three certified clients before applying as a provider. Months of work and an external timeline Facilito does not control. Does not fit 15-nov-2026.

**C. Facturador Gratuito as a manual bridge.** Each customer issues e-CF in DGII's free portal (needs RNC, NCF registration, Oficina Virtual and a certificate; orientative volume around 150/month) and Facilito records the resulting e-NCF against its own sale. Zero integration cost, but double data entry, no automation, and the taxpayer must not already be authorised through another system.

## Decision (proposed)
**A**, implemented behind a provider-agnostic port so the provider can be swapped and B stays possible later:
1. `FiscalProvider` port (`issue(doc)` idempotent by document id, `status(trackId)`, `void(...)`, `health()`), first adapter for the chosen provider, a fake adapter for tests. Matches ADR-008 (external ports).
2. e-NCF reservation reuses the atomic sequence path already proven by the 200-concurrency characterization test.
3. Documents that cannot be sent stay "pendiente de envío" in the existing contingency queue with retries and alerts; fiscal data is never deleted (rule R12).
4. Rollout behind `FEATURE_ECF_ENABLED` per tenant; legacy NCF keeps working for tenants not yet migrated.
5. **C is documented as the fallback** for any customer who must issue before the adapter reaches production.

## Consequences
- Per-document or per-plan cost passes to Facilito's plans (to price in Fase 8).
- A provider outage blocks issuing; mitigated by contingency mode and a runbook (Fase 9).
- New env names (to add to `.env.example` in Fase 2, no values): `FISCAL_PROVIDER`, `FISCAL_PROVIDER_BASE_URL`, `FISCAL_PROVIDER_API_KEY`, `FISCAL_ENV`, `CERT_ENCRYPTION_KEY`. They supersede the current `PSFE_*` placeholders through an expand/contract rename.

## Open items (CONFIRMAR CON CONTADOR/DGII)
- Exact obligations and dates for each customer category; whether a management tool connected to a PSFE needs any registration of its own.
- Which e-CF types are mandatory for the first release (proposed minimum: E31, E32, E34; then E33, E41, E43, E44, E45, E46, E47).
- Document retention period.
- Provider contract terms (SLA, data location, pricing). **Not accepted on the owner's behalf.**
