# Phase 7.20 — Partner Sandbox API Skeleton ADR

## Status

Accepted — 2026-07-01.

## Context

Phase 7.19 built a pure, deterministic contract layer (`lib/decision-os/sdk/partner-*.ts`)
answering "what does AllFantasy need to know about a partner?" — but nothing
could actually CALL it yet. This ticket wires that contract layer up to real
HTTP endpoints so a future partner sandbox (or, later, an admin UI) can
validate a partner's onboarding config, preview their theme, see their
widget catalog, check permissions, and get embed instructions — all before
any admin UI or billing system exists.

This is explicitly a **skeleton**: safe, read-only, sandbox-flavored
endpoints that process only caller-supplied data and return deterministic,
customer-facing output. No tenant lookups, no persistence, no real API key
issuance.

## Decisions

### D1 — Two layers: pure handlers in `lib/decision-os/sdk/`, thin routes in `app/api/v1/sandbox/partner/`

Mirrors the EXISTING, already-frozen pattern used by the Intelligence API
(`lib/decision-os/behavioral/api/intelligence-handlers.ts` + thin
`app/api/v1/intelligence/*/route.ts` wrappers):

- `lib/decision-os/sdk/partner-sandbox-handlers.ts` — framework-agnostic pure
  functions taking a small duck-typed `PartnerSandboxApiContext`
  (`{ headers, searchParams, body }` — NOT `NextRequest`) and returning a
  plain `{ status, body }` result. No exceptions for expected error paths;
  malformed input is caught and converted to a structured 400, never an
  unhandled crash (see D5).
- `app/api/v1/sandbox/partner/*/route.ts` — six route files whose ONLY job
  is: build the context object from `req` (parse the JSON body for POST
  routes), call the matching handler, translate `{status, body}` into
  `NextResponse.json(body, { status })`. No business logic in these files
  (the ticket's own "keep route handlers thin" requirement) — each is
  10-20 lines, matching the existing Intelligence API route file length.

`app/api/v1/` is the established versioned-API root (already holds
`app/api/v1/intelligence/*`, `app/api/v1/stories/*`) — `sandbox/partner/`
sits alongside it, not a new top-level convention.

### D2 — New, dedicated env flag: `PARTNER_SANDBOX_API_ENABLED`

Not `DECISION_OS_*` (would imply this is a Stage 1 soak slice cutover flag —
it is not; this ticket's rules explicitly forbid touching those) and not
`WIDGET_SDK_{TARGET}_LIVE` (that family, from
`PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md` D4, gates per-EMBED-TARGET
rollout; this is a whole API SURFACE being enabled, the same kind of
decision the Intelligence API already makes with its own
`DECISION_OS_INTELLIGENCE_API_ENABLED` flag). `PARTNER_SANDBOX_API_ENABLED`
is a sibling flag in that same naming spirit, but its own independent name —
enabling the Intelligence API does not enable this, and vice versa.

Read via a small local `isPartnerSandboxApiEnabled(env)` helper using the
defensive `String(value ?? '').trim().toLowerCase() === 'true'` idiom
(matching `lib/decision-os/core/shadow/flag.ts`'s pattern, not the bare
`!== 'true'` form the Intelligence API gate uses) — defaults OFF, and takes
an injectable `env` parameter so it is testable without mutating
`process.env` in tests.

When disabled, EVERY handler returns the same shape the Intelligence API
gate already established for its own disabled state: **503**, a structured
error envelope (`{ code: 'SANDBOX_DISABLED', message, requestId }`) — never
a bare 404, never a differently-shaped body. This is checked FIRST, inside
each pure handler (mirroring `checkIntelligenceGate` being called from
inside each Intelligence handler, not from the route file) — before any
input parsing or contract-function call.

### D3 — No per-request API-key auth on these endpoints

Every Phase 7.19 helper this ticket wires up (`validatePartnerTenantConfig`,
`normalizePartnerBranding`, `resolveDefaultWidgetCatalog`,
`isWidgetModeAllowedForTier`) operates ENTIRELY on data the caller supplies
in the request itself — no tenant lookup, no stored partner record, no
real intelligence data. There is nothing here for an API key to gate access
TO. Requiring `checkIntelligenceGate`-style auth would be theater: a partner
onboarding for the first time, by definition, doesn't have a real key yet.
The environment flag (D2) is the only gate — it controls whether this
sandbox surface exists on a given deployment at all, which is the actual
risk this ticket's "no admin UI yet"/"no billing yet" rules are protecting
against (accidentally shipping partner-facing tooling before it's ready),
not per-caller authorization.

### D4 — GET with query params for simple lookups, POST with a JSON body for config objects

- `POST validate-config` — body is a full `PartnerTenantConfig`.
- `POST preview-theme` — body is a `PartnerBrandingConfig`.
- `GET widget-catalog?licenseTier=standard` — one string param.
- `GET check-widget-permission?licenseTier=standard&mode=commissioner` — two string params.
- `GET embed-instructions?licenseTier=standard&mode=commissioner&embedTarget=iframe` — three string params.
- `GET test-key-metadata` — no params.

Matches the Intelligence API's own GET+searchParams convention for
simple-parameter reads, while reserving POST+body for the two endpoints that
genuinely need a structured object (a whole tenant config, a whole branding
submission) rather than forcing those into query-string encoding.

### D5 — Defensive shape guards, never an unhandled crash on malformed input

Every Phase 7.19 pure function assumes a well-typed `PartnerTenantConfig`/
`PartnerBrandingConfig`/etc. — accessing e.g. `config.allowedOrigins.origins`
on a caller-supplied JSON body that's missing `allowedOrigins` entirely would
throw a raw `TypeError`, not a graceful validation error (the same class of
gap F7.17's js-embed adapter found and fixed for its own plain-JS callers).
Since these endpoints are explicitly meant to accept ARBITRARY,
possibly-malformed partner input during onboarding testing, each handler
wraps its call to the Phase 7.19 contract function in a try/catch,
converting any thrown error into a structured `400 INVALID_REQUEST` response
with a generic message — NEVER the raw `error.message` or a stack trace
(ADR D6, no backend internals leak through an error path either).

### D6 — Every response is customer-facing output only

No handler ever returns: a raw `error.stack`, a Decision OS internal field
name, a real (non-fixture) API key value, or any data not either (a) echoed
back from the caller's own request or (b) a Phase 7.19 pure-function result
that is ALREADY guaranteed customer-safe (every Phase 7.19 validator/
normalizer/permission function was already built with "no internal leakage"
as a tested invariant in Phase 7.19 — this ticket does not weaken that, it
only adds an HTTP transport on top). The `test-key-metadata` endpoint
specifically returns the Phase 7.19 `SANDBOX_PARTNER_TENANT_CONFIG` fixture's
already-fake example key metadata (`keyPrefix: 'afk_test_7f3a9c'`, not tied
to any real credential) — never a freshly-generated or real key.

### D7 — Embed instructions are a static, deterministic lookup table

`embed-instructions` returns step-by-step guidance per `SDKEmbedTarget`,
sourced from a hardcoded `Record<SDKEmbedTarget, string[]>` table describing
the ACTUAL public APIs this codebase already ships
(`createAllFantasyWidgetHost`/F7.12, `defineAllFantasyWidgetElement`/F7.16,
`AllFantasy.createWidget`/F7.17) — never computed, never templated from live
data, never provider-specific. This satisfies "no intelligence computation"
literally: the instructions are fixed strings selected by a lookup key, not
derived from any input value beyond which key to select.

## Consequences

- A future partner sandbox environment (not built here) can point at these
  six endpoints, flip `PARTNER_SANDBOX_API_ENABLED=true` on a non-production
  deployment, and let a partner iterate on their onboarding config with
  immediate, safe feedback before any admin UI or real API key exists.
- Because the pure handler layer lives in `lib/decision-os/sdk/`, it inherits
  the SAME import-boundary discipline the rest of Phase 7 established (no
  imports from `lib/decision-os/behavioral/*`, no Prisma, no writes) —
  testable in isolation from Next.js entirely.
- Real API key issuance, tenant persistence, and an actual admin UI remain
  explicitly out of scope and will each need their own ADR.

## Non-goals (explicitly out of scope, per the ticket's own rules)

- No admin UI.
- No billing / payment integration.
- No database writes (test fixtures only, reusing Phase 7.19's).
- No real API key generation or storage.
- No per-request API-key authentication (D3).
- No provider-specific (named-partner) branching logic anywhere in this module.
