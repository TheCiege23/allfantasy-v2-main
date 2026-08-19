# ADR: Phase 7.4 — Widget SDK & Embed Specification

**Status:** ACCEPTED
**Date:** 2026-07-01
**Author:** Decision OS
**Version:** SDK_VERSION = '7.4.0'

---

## Context

Phase 7.3 produced the **Widget Contract Foundation** — deterministic rules for what a widget
embed is allowed to render (`WidgetConfig`, `validateWidgetConfig`, `mapWidgetModeToApiCall`,
`resolveAllowedSections`, `filterSectionsByTier`), plus operational metadata (layout hints,
privacy restrictions, telemetry events, degraded states).

What Phase 7.3 does NOT define is the **runtime contract** a platform-specific SDK (web JS,
React, Vue, Angular, Swift, Kotlin, Flutter, or a raw iframe) needs in order to actually
initialize a widget, authenticate, fetch presentation data, manage its lifecycle, emit
telemetry, and hand rendering off to a host application — without ever touching Decision OS
internals or requiring bespoke per-platform logic.

Without this spec, every future SDK implementation (JS today, Swift/Kotlin/Flutter later)
would reinvent lifecycle states, auth handling, refresh timing, and error taxonomy
independently — producing the same N-implementation divergence problem Phase 7.0 solved for
presentation logic and Phase 7.3 solved for widget configuration.

## Decision

Introduce `lib/decision-os/sdk/` as the single authoritative **SDK specification layer** —
the contract every future platform SDK must implement, expressed entirely as deterministic
types and pure helper functions. No runtime, no rendering, no network calls, no React.

### Architecture position

```
Presentation API  (Phase 7.2, ?view=presentation)
    │
    ▼
IPM  (Phase 7.0 — LeagueApiPresentation / ManagerApiPresentation / PlatformApiPresentation)
    │
    ▼
Widget Contract  (Phase 7.3 — WidgetConfig, sections, API mapping, telemetry, degraded states)
    │
    ▼
Widget SDK Specification   ◄── this module (Phase 7.4)
    │  SDKConfig / SDKAuth / SDKTheme / SDKLocale
    │  Lifecycle state machine
    │  Embed target capability matrix
    │  Event contract + ordering rules
    │  Error taxonomy
    │  Refresh strategy contract
    │  Privacy denylist + stripping
    │
    ▼
Platform SDK Runtime (Phase 7.5+ — JS/React/Vue/Angular/Swift/Kotlin/Flutter)  [NOT built here]
    │
    ▼
Partner Website / App (Sleeper, Yahoo, ESPN, Fantrax, DraftKings, FanDuel, Underdog, CBS, MFL, …)
```

**A platform SDK MUST NEVER import from, call, or reference:**
`lib/decision-os/world/`, `lib/decision-os/behavioral/` (except the public API boundary types
`IntelligenceApiScope`/`IntelligenceTier` needed for auth scope checks), Phase 6 classifiers,
or Prisma/the database, directly or transitively. The only inbound data path is an HTTP call
to `/api/v1/intelligence/{league,manager,platform}?view=presentation`.

### Why the SDK consumes only the Presentation API

The Presentation API (Phase 7.2) is the only Decision OS surface engineered to be:
1. **Stable** — versioned (`presentationVersion`), backward compatible by construction.
2. **Wire-safe** — no internal Decision OS field names, no raw behavioral events, no
   provenance internals (Phase 5.5 `IntelligenceApiMeta` contract, extended in 7.2).
3. **Tenant-scoped** — every response is gated by `IntelligenceApiScope` before assembly.

Any other internal surface (Phase 5/6 objects, Canonical World facts, the database) carries
none of these guarantees and is explicitly off-limits to SDK code per the Architecture Freeze
(`ARCHITECTURE_FREEZE.md` §"Origin Blindness" and §"Purpose Blindness" — the substrate's
internal shape is not a public contract).

### Why the SDK owns the rendering lifecycle

A widget embed is not a single fetch-and-paint — it authenticates, loads, renders, refreshes
on multiple independent triggers (visibility, schedule, host callback), can go offline, can be
rate-limited, and must dispose cleanly when the host removes it. Every platform runtime
(React, Vue, native mobile, a raw iframe) needs the *same* answers to "what state am I in and
what can happen next" — so the lifecycle state machine lives in the shared spec, not in each
runtime. `lifecycle.ts` defines the 10 states and the deterministic transition table; a
runtime's only job is to call the transition and re-render for its own platform's paradigm.

### Auth model

Six auth methods are supported, covering the full deployment spectrum from an anonymous public
widget on a partner's marketing page to a fully authenticated enterprise tenant dashboard:

| Method | Use case | Requires credential | Requires tenantId |
|---|---|---|---|
| `api_key` | Server-side or trusted embed | yes | yes |
| `jwt` | Session-scoped web app embed | yes | yes |
| `signed_embed_token` | Short-lived, host-issued iframe token | yes | yes |
| `partner_token` | White-label partner integration | yes | yes |
| `anonymous_public` | Public marketing widget, no PII | no | no |
| `enterprise_tenant_token` | Enterprise licensee, multi-league | yes | yes |

`anonymous_public` is scope-capped to `intelligence:platform:basic` only — it can never reach
league- or manager-scoped data. This is enforced by `validateSDKAuth` (`auth.ts`), not by
convention.

### Tenant isolation

Every `SDKConfig` carries a `tenantId` (except `anonymous_public`). All telemetry
(`SDKEvent`) carries a `tenantIdHash` — a deterministic one-way obfuscation of the tenant ID,
never the raw value — mirroring the Phase 7.3 telemetry design. A single SDK instance is bound
to exactly one tenant for its lifetime; there is no cross-tenant state sharing in the contract
(each `SDKWidgetInstance` is independently configured and disposed).

### API compatibility & versioning

`SDKVersion` pins three independent version axes so a runtime can fail fast on drift instead
of rendering a broken widget:

- `sdkVersion` — this spec's version (`7.4.0`)
- `presentationVersion` — minimum compatible IPM version (`7.0.0`)
- `widgetContractVersion` — minimum compatible Widget Contract version (`7.3.0`)
- `apiVersion` — the Intelligence API's own version string (`v1`, from `IntelligenceApiMeta.version`)

A `VERSION_MISMATCH` error (`errors.ts`) is the deterministic, typed response when any axis is
incompatible — never a silent degrade or a thrown exception a host app must guess how to catch.

### Event lifecycle

Nine telemetry event types cover the full engagement funnel a partner or AllFantasy needs to
measure widget value: `loaded`, `rendered`, `refresh`, `interaction`, `cta_click`,
`recommendation_viewed`, `recommendation_accepted`, `error`, `disposed`. `events.ts` defines
ordering invariants (`loaded` before `rendered`; nothing after `disposed`) via
`validateEventSequence` so runtimes can self-check telemetry correctness in tests without a
live backend.

### Embed lifecycle

Eight embed targets are specified as a capability matrix (`embed.ts`) rather than eight
separate contracts, because the *lifecycle* and *auth* contracts above are embed-target
agnostic — only isolation properties differ (an `iframe` gets full process isolation; a
`web_component` gets DOM isolation only; a `native_bridge` gets none because it's not in a
browser at all).

### Enterprise licensing implications

`SDKEnterpriseExtension` formalizes eight extension points (white-label, OEM, partner
branding, marketplace widgets, premium widgets, commissioner-only widgets, manager-only
widgets, platform analytics widgets) as a **license tier gate**, not a code branch. A runtime
checks `licenseTier` against the extension point's requirement; it never special-cases a named
partner. This keeps the SDK spec provider-agnostic per the "no provider-specific code" rule —
white-label branding is data (`SDKTheme.partnerBrandId` + `WhiteLabelConfig` from Phase 7.0),
never a conditional.

---

## Privacy Layer

The SDK spec defines a hard denylist (`privacy.ts`) of internal field names and terminology
that must never cross the SDK boundary into a host application or a browser devtools network
tab: Decision IDs, internal warnings arrays, provenance objects, completeness *internals*
(vs. the public rounded completeness score, which IS allowed), raw behavioral events, raw
Phase 5/6 intelligence objects, Decision OS terminology strings ("Decision OS", "behavioral
intelligence", "Phase 5", "Phase 6", "Canonical World"), internal numeric scores not already
exposed via `MetricPresentation`, and upstream data-provider identifiers (distinct from
white-label *partner* branding, which is intentionally surfaced).

`stripInternalFields()` is a pure, recursive, denylist-driven object stripper. `hasInternalLeakage()`
scans a serialized string for banned terminology. Both are deterministic and side-effect-free.

---

## Constraints (all must hold)

| Constraint | Rule |
|---|---|
| Deterministic | Same input → same output for every helper function |
| No runtime I/O | No network calls, no timers, no DOM, no storage |
| No rendering | Zero JSX, zero HTML strings, zero CSS |
| No React / Vue / Angular | Zero UI framework imports |
| Provider-agnostic | No `if (platform === 'sleeper')`-style branching anywhere |
| No AI generation | No LLM calls; the SDK spec is pure deterministic contract |
| Privacy-safe | `stripInternalFields`/`hasInternalLeakage` cover the full denylist |
| Backward compatible | Additive only — zero changes to Phase 7.0/7.2/7.3 files |
| Architecture Freeze | No redesign of Canonical World, DCO, or any frozen component |
| No writes | No database access, no mutation of any kind |

---

## Rejected Alternatives

### Option A — One SDK spec per platform (JS spec, Swift spec, Kotlin spec…)
Rejected: guarantees the auth/lifecycle/event/error contracts drift across platforms within
months. A single spec, implemented N times, is the only way to keep partner integrations
interchangeable.

### Option B — Let each embed target define its own auth model
Rejected: an `iframe` embed and a `native_bridge` embed authenticating differently would force
partners choosing between embed targets to also choose between auth capabilities. Auth is
orthogonal to embed target in this spec by design.

### Option C — Fold the SDK spec into Phase 7.3's widget-contracts.ts
Rejected: Phase 7.3 defines *what* a widget is allowed to show (data-shape and scope rules).
Phase 7.4 defines *how* a runtime manages a widget's existence over time (lifecycle, auth
session, refresh cadence, telemetry). Mixing them would make Phase 7.3 depend on runtime
concepts it doesn't need, and would block Phase 7.3 from being consumed by non-SDK contexts
(e.g. server-side pre-rendering) that don't need a lifecycle at all.

### Option D — Include the actual fetch/render implementation now
Rejected by explicit instruction — this phase is contract-only. Runtime implementation is
Phase 7.5+.

---

## Files Created

| File | Purpose |
|---|---|
| `sdk/PHASE_7_4_WIDGET_SDK_ADR.md` | This document |
| `sdk/types.ts` | All SDK contract types |
| `sdk/lifecycle.ts` | 10-state lifecycle machine + transition validation |
| `sdk/theme.ts` | Semantic theme token resolution (no CSS) |
| `sdk/auth.ts` | 6 auth method contracts + validation |
| `sdk/embed.ts` | 8 embed target capability matrix |
| `sdk/events.ts` | 9 event types + ordering validation + event builder |
| `sdk/errors.ts` | 10 deterministic error contracts |
| `sdk/refresh.ts` | 6 refresh strategies + validation |
| `sdk/privacy.ts` | Internal-field denylist + stripping + leakage detection |
| `sdk/config.ts` | `validateSDKConfig` — ties all contracts together |
| `sdk/index.ts` | Barrel export |
| `sdk/PHASE_7_4_WIDGET_SDK_CHECKPOINT.md` | Completion checkpoint |
| `__tests__/decision-os/phase7/widget-sdk-foundation.test.ts` | Test suite |
