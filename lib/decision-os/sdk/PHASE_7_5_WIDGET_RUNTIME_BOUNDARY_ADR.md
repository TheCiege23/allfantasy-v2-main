# ADR: Phase 7.5 — Widget Runtime Implementation Boundary

**Status:** ACCEPTED
**Date:** 2026-07-01
**Author:** Decision OS
**Scope:** Planning only. No runtime code, no SDK package, no UI rendering ships in this phase.

---

## Context

Phase 7.4's checkpoint (`PHASE_7_4_WIDGET_SDK_CHECKPOINT.md`) named seven concrete gaps between
the SDK **specification** (pure types + pure functions, `lib/decision-os/sdk/`) and an actual
embeddable widget:

1. HTTP client
2. DOM rendering boundary
3. Credential verification
4. Timers / refresh engine
5. iframe postMessage schema
6. SDK package structure
7. Telemetry sink

Building all seven at once, in one PR, against one partner, would be the single highest-risk
action available in this project: it would introduce browser-facing, network-facing, I/O-facing
code — the first Decision OS deliverable that is not pure and deterministic — with no prior
sequencing decision about *where that code lives*, *what security model it assumes*, or *what
order minimizes blast radius*.

This ADR makes those decisions before any of the seven gaps are implemented, so Phase 7.6+
tickets are small, independently reviewable, and each has an unambiguous place to live and a
pre-agreed security posture to satisfy.

## Decision

### D1 — Runtime code lives OUTSIDE `lib/decision-os/`

Every existing Decision OS module is pure, deterministic, server-and-test-only (no DOM, no
`fetch`, no timers, no React). The Architecture Freeze governs that world specifically. Widget
runtime code is the opposite on every axis: it runs in a browser or a native app, makes network
calls, owns timers, and (once Phase 7.6+ builds a renderer) renders UI.

Mixing the two would either (a) force impure runtime concerns into files the Freeze governs, or
(b) quietly redefine what "Decision OS" means. Neither is acceptable. Instead:

- **Spec stays put**: `lib/decision-os/sdk/` (types + pure functions, Phase 7.3/7.4) remains the
  single source of truth for contracts. Runtime code imports FROM it, never the reverse.
- **Runtime gets a new home**: `sdk-runtime/` at the repo root (proposed layout in the
  Implementation Plan doc). This directory is explicitly OUTSIDE the Architecture Freeze's
  jurisdiction — it may use whatever engineering patterns fit browser/runtime code (classes,
  mutable state, DOM APIs) without needing an ADR for ordinary runtime engineering decisions.
  Only changes that would alter the **contracts** in `lib/decision-os/sdk/` or
  `lib/decision-os/presentation/` require an ADR.
- Planning documents for the runtime (this ADR + the Implementation Plan) stay alongside the
  spec they plan against, in `lib/decision-os/sdk/`, matching the existing ADR-lives-with-the-
  phase-it-describes convention.

### D2 — Runtime core is framework-agnostic; adapters are thin

Every one of the seven gaps except #2 (DOM rendering) and #6 (package structure) is identical
regardless of whether the eventual consumer is React, Vue, a raw iframe, or a native bridge. A
single **core** module owns auth-gate pre-checks, the HTTP client, the lifecycle controller, the
refresh engine, the error mapper, and the telemetry sink. Framework-specific **adapters** (React
wrapper, Vue wrapper, iframe host, web component, native bridges) depend on the core and supply
only a `WidgetRenderer` implementation — the one piece of gap #2 that is genuinely
framework-specific.

This directly extends the Phase 7.4 checkpoint's recommended order (JS/TS core → React wrapper
→ iframe protocol → partner pilot → native bridges) into an enforceable dependency direction:
adapters may depend on core; core may never depend on an adapter; no adapter may depend on
another adapter.

### D3 — Credential verification is a two-tier check; secrets never verify client-side

The existing server gate (`lib/decision-os/behavioral/api/gate.ts`) is — and remains — the sole
authority on whether a credential is valid. `checkIntelligenceGate()` reads the
`X-AllFantasy-API-Key` header, validates format (`afk_{test|live}_{16+ alphanum}`), and resolves
a tier server-side. **No runtime code will ever reimplement this check, embed a signing secret,
or verify a JWT/token signature in the browser.** Doing so would require shipping a secret to
every partner page — an immediate compromise the moment one partner's site is compromised.

The runtime's role is limited to a **cheap, non-authoritative pre-check**: `validateSDKAuth()`
(Phase 7.4, already built) verifies the auth contract's *shape* — is a credential present when
the method requires one, is `expiresAt` in the future — purely to fail fast with a typed
`SDKError` (`UNAUTHORIZED`) before wasting a network round trip. The actual authorization
decision is always deferred to the Presentation API, which already gates every request through
`checkIntelligenceGate()` + scope checks. This two-tier design is the security model's spine and
is elaborated in the Implementation Plan's "Security model" section.

### D4 — The rollout uses a NEW flag family, never the Stage 1 Decision OS soak flags

Widget rollout gating (`WIDGET_SDK_{TARGET}_LIVE`, proposed in the Implementation Plan) is
completely independent of `DECISION_OS_COMMISSIONER_HEALTH_LIVE` and any other Stage 1 soak
flag. Widgets consume the Presentation API; they do not touch the decision engine, the shadow
validation path, or any Stage 1 slice. Coupling widget rollout to Stage 1 flags would create an
accidental dependency between two unrelated concerns and risk disrupting the soak this project
has been explicitly instructed never to touch.

### D5 — This phase produces zero runtime code

Every deliverable in this ADR and its companion Implementation Plan is a document: a dependency
map, a security model, a package layout proposal, a test strategy, a rollout plan, and a single
scoped ticket for Phase 7.6. No `sdk-runtime/` directory is created in this phase. The first line
of runtime code is explicitly Phase 7.6's responsibility, scoped to the smallest safe vertical
slice (see the Implementation Plan's final section).

---

## Constraints (all must hold)

| Constraint | Rule |
|---|---|
| Planning only | Zero runtime code, zero SDK package, zero rendering code in this phase |
| Architecture Freeze | No changes to any frozen Decision OS component |
| No Stage 1 coupling | Widget rollout flags are a separate family from Decision OS soak flags |
| No provider-specific logic | Nothing in the plan names a partner platform in a code path |
| No writes | No database access proposed anywhere in the runtime design |
| Secrets never client-side | Credential verification is always server-authoritative |
| Directional dependency | `sdk-runtime/` may import `lib/decision-os/sdk` + `lib/decision-os/presentation`; the reverse is forbidden permanently |

---

## Rejected Alternatives

### Option A — Build the runtime inside `lib/decision-os/sdk/`
Rejected: would place impure, browser-facing code under the Architecture Freeze's governance,
forcing every ordinary runtime engineering decision (e.g. "should the HTTP client use
`AbortController`?") through the ADR-first process meant for decision-engine architecture. The
spec and the runtime need different governance models.

### Option B — Build all seven gaps in one Phase 7.6 ticket
Rejected: seven concerns of unrelated risk profiles (network, DOM, security-sensitive auth,
timers, cross-origin messaging, packaging, analytics) bundled into one PR is unreviewable and
untestable as a unit. The Implementation Plan sequences them into independently shippable
slices.

### Option C — Let the runtime verify credentials directly (e.g. decode + check a JWT signature in-browser)
Rejected outright on security grounds (D3). A signature-verification secret shipped to a browser
bundle is available to anyone who views the page source — this is not a implementation detail to
defer, it is a permanent prohibition.

### Option D — Reuse the Stage 1 Decision OS soak flag pattern directly for widget rollout
Rejected (D4): widgets are a different blast-radius category (external partner pages, real
network exposure) than internal decision-slice shadow validation. A shared flag family would
make it impossible to reason about either rollout independently.

---

## Companion document

`PHASE_7_5_RUNTIME_IMPLEMENTATION_PLAN.md` — dependency map, security model, package layout,
test strategy, rollout plan, and the first Phase 7.6 ticket.
