# Phase 7.19 — White-Label Partner Onboarding Foundation ADR

## Status

Accepted — 2026-07-01.

## Context

Phases 7.3–7.18 built the full widget contract → SDK → runtime → four-embed-target
→ theming stack. Every layer of that stack assumes a **tenant already has** a
`WidgetTenantConfig` (Phase 7.3), an `SDKAuth` credential (Phase 7.4), an
`SDKTheme` (Phase 7.4/7.18), and knows which `SDKEmbedTarget`s and `WidgetMode`s
it's allowed to use. Nothing in the codebase yet defines **how a partner gets
those values in the first place** — there is no partner "onboarding" contract,
only the runtime-facing shapes a partner is assumed to already possess.

This ticket is explicitly a **foundation**, not a product: no admin UI, no
billing, no database writes beyond pure config schema/fixtures. It answers one
question — "what does AllFantasy need to know about a partner before it can
issue them a tenant config?" — as a deterministic, testable contract layer that
a future admin UI, partner sandbox, or enterprise licensing flow can be built
on top of.

## Decisions

### D1 — Location: `lib/decision-os/sdk/`, flat files, not `sdk-runtime/`

This is a **contract/schema layer** (types + pure validators + pure permission
lookups + pure theme normalization), not runtime/rendering code. Per
`PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md` decision D1, `sdk-runtime/` is
reserved for implementation code that consumes the frozen `lib/decision-os/sdk`
contracts — it is not itself a contract source. Partner onboarding contracts
belong alongside `widget-contracts.ts` (Phase 7.3) and `sdk/*` (Phase 7.4) in
`lib/decision-os/sdk/`, enriching the frozen contract surface rather than
redesigning it (Architecture Freeze: "enrich the frozen components, never
redesign without an explicit ADR" — this document IS that explicit ADR).

Five new flat files, matching the existing `sdk/`/`presentation/` convention
of flat per-concern files rather than nested subdirectories:
`partner-types.ts`, `partner-validation.ts`, `partner-permissions.ts`,
`partner-theme.ts`, `partner-fixtures.ts`.

### D2 — No database, no API routes, no admin UI

Everything in this ticket is pure types + pure functions operating on
in-memory values. `partner-fixtures.ts` exports plain exported constants (e.g.
a sandbox partner record) — never a database seed script, never a Prisma
model, never an API route. Real partner persistence (a table, an admin CRUD
UI, a signup flow) is explicitly future work requiring its own ADR — this
ticket's rules ("No writes unless explicitly limited to config schema/
fixtures", "No admin UI yet") forbid building it here.

### D3 — Reuse over reinvention

Every concept in the ticket's scope that the frozen SDK/presentation layers
already model is REUSED via composition, never duplicated or replaced:

| Ticket concept              | Reused frozen type/function                                    |
|------------------------------|------------------------------------------------------------------|
| Widget permissions by tier   | `SDKLicenseTier` (Phase 7.4's `config.ts`, already tier-ranked) |
| Embed target permissions     | `SDKEmbedTarget`, `ALL_EMBED_TARGETS` (Phase 7.4's `embed.ts`)  |
| Theme / branding config      | `SDKTheme`, `resolveSDKTheme`, `validateSDKTheme` (Phase 7.4/7.18) |
| Privacy settings baseline    | `WidgetPrivacyRestrictions`, `resolveWidgetPrivacyRestrictions` (Phase 7.3) |
| Feature flags                | `WidgetFeatureFlags` (Phase 7.3's `widget-contracts.ts`)        |
| API key scopes               | `IntelligenceApiScope` (Phase 6's `behavioral/api/contracts.ts`) |

`Widget permissions by tier` is a genuinely NEW lookup (`WIDGET_MODE_MIN_TIER`)
because no existing table maps `WidgetMode` → minimum `SDKLicenseTier` — but it
is built in the SAME shape as the already-frozen `EXTENSION_POINT_MIN_TIER` /
`isExtensionPointAllowed` pattern (Phase 7.4's `config.ts`), not a new pattern.

### D4 — API key metadata is METADATA ONLY

`PartnerApiKeyMetadata` carries `keyId`, `keyPrefix` (the SHORT visible prefix
only, e.g. `afk_live_7f3a…`, matching the `afk_{test|live}_*` format already
documented in `PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md`'s security model),
`environment`, `status`, `scopes`, `issuedAt`, `expiresAt`. It structurally has
NO field for a raw secret. Issuing, hashing, storing, or verifying an actual
credential remains the sole responsibility of the existing runtime auth layer
(`checkIntelligenceGate` server-side, `validateSDKAuth` client-side pre-check,
per Phase 7.5 decision D3: "secrets NEVER verify client-side"). This ticket
does not touch that boundary — it only describes what an ALREADY-issued key's
non-secret metadata looks like.

### D5 — Privacy preferences can only tighten, never loosen, the mode baseline

`resolveEffectivePartnerPrivacySettings(mode, preferences)` merges a widget
mode's own baseline (`resolveWidgetPrivacyRestrictions`, Phase 7.3, frozen)
with a partner's preferences using OR-for-booleans and MIN-for-the-numeric-cap
— structurally incapable of producing a WEAKER result than the mode's own
default, regardless of what a partner submits during onboarding. This
prevents an onboarding-time misconfiguration (or a future admin UI bug) from
ever silently relaxing an existing privacy guarantee.

### D6 — Rate limits and default widget catalog are TIER-based, not partner-authored numbers

Per the ticket's "No public billing yet" rule, this ADR deliberately does NOT
build a billing/plan system — but it DOES anchor rate limits
(`RATE_LIMIT_PER_MINUTE_BY_TIER`) and the starting widget catalog
(`resolveDefaultWidgetCatalog`) to the SAME `SDKLicenseTier` used for
extension-point gating (Phase 7.4), rather than letting onboarding accept an
arbitrary partner-supplied number. This keeps the three tier-driven concepts
(extension points, widget modes, rate limit) internally consistent and
ready to be wired to a real billing/plan system later without a breaking
change — a deterministic lookup table swap, not a contract redesign.

### D7 — No provider-specific logic

`whiteLabelPlatform` on `PartnerTenantConfig` stays a free-form optional
`string | null` — identical in shape to the already-frozen
`WidgetTenantConfig.whiteLabelPlatform` (Phase 7.3) — never a hardcoded enum
of named platforms. The pre-existing `WHITE_LABEL_CONFIGS` platform registry
in `presentation/white-label.ts` (Phase 7.0, which DOES hardcode partner
names like `sleeper`/`yahoo`/`espn` — a legitimate, separate, already-frozen
mechanism for a different purpose: mapping IPM tokens to a *known* licensee's
design system) is neither touched nor duplicated by this module. No function
in `partner-*.ts` branches on a partner's identity, name, or platform string —
every decision is tier-rank, format-validity, or explicit-boolean-preference
based.

## Consequences

- A future admin UI can construct/edit a `PartnerTenantConfig`, call
  `validatePartnerTenantConfig`, and get a deterministic pass/fail with
  human-readable errors — no server round-trip required for client-side form
  validation.
- A future partner sandbox environment can start a partner at
  `licenseTier: 'standard'`, call `resolveDefaultWidgetCatalog('standard')` to
  seed their first widget catalog, and `resolveRateLimitPerMinute('standard')`
  to configure their initial `WidgetTenantConfig.rateLimitPerMinute` — the
  Phase 7.3 contract this whole stack ultimately feeds.
- A future enterprise licensing flow can raise `licenseTier` to `'enterprise'`
  and every tier-gated helper (widget modes, extension points, rate limit)
  updates consistently, with zero special-casing.
- Real persistence, an actual admin UI, and real API key issuance remain
  explicitly out of scope and will need their own ADRs.

## Non-goals (explicitly out of scope, per the ticket's own rules)

- No database table, no Prisma model, no migration.
- No admin UI, no API route, no server action.
- No public billing / payment integration.
- No real API key generation, hashing, or storage.
- No provider-specific (named-partner) branching logic anywhere in this module.
