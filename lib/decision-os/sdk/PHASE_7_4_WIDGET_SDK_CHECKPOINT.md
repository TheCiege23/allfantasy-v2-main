# Phase 7.4 Checkpoint — Widget SDK & Embed Specification

**Status:** COMPLETE
**Date:** 2026-07-01
**SDK_VERSION:** 7.4.0

---

## Architecture summary

Phase 7.4 adds the **runtime specification layer** above the Widget Contract Foundation
(Phase 7.3). It defines, as pure deterministic types and functions, everything a future
platform SDK needs to initialize, authenticate, render, refresh, and dispose an AllFantasy
Intelligence Widget — without ever importing from Decision OS internals.

```
Presentation API (7.2)  →  IPM (7.0)  →  Widget Contract (7.3)  →  Widget SDK Spec (7.4, this)
                                                                          │
                                                                          ▼
                                                     Platform SDK Runtime (7.5+, NOT built here)
                                                                          │
                                                                          ▼
                                                          Partner Website / App
```

No rendering code, no network calls, no React, no provider-specific branches exist anywhere
in this phase. Every function in `lib/decision-os/sdk/` is pure: same input → same output,
zero side effects, zero I/O.

---

## File inventory

| File | Lines (approx) | Purpose |
|---|---|---|
| `sdk/PHASE_7_4_WIDGET_SDK_ADR.md` | 180 | Architecture Decision Record |
| `sdk/types.ts` | 250 | All SDK contract types (12 top-level type groups) |
| `sdk/lifecycle.ts` | 85 | 10-state lifecycle machine + transition validation |
| `sdk/theme.ts` | 105 | 5 theme modes, semantic token resolution, validation |
| `sdk/auth.ts` | 100 | 6 auth methods, requirements matrix, validation |
| `sdk/embed.ts` | 85 | 8 embed targets, capability matrix |
| `sdk/events.ts` | 90 | 9 event types, tenant obfuscation, ordering validation |
| `sdk/errors.ts` | 85 | 10 error codes, deterministic messages + retryability |
| `sdk/refresh.ts` | 75 | 6 refresh triggers, strategy resolution + validation |
| `sdk/privacy.ts` | 85 | Field denylist, terminology denylist, stripping, leak detection |
| `sdk/config.ts` | 140 | `validateSDKConfig` orchestrator + enterprise extension gating |
| `sdk/index.ts` | 110 | Barrel export |
| `sdk/PHASE_7_4_WIDGET_SDK_CHECKPOINT.md` | this file | Completion checkpoint |
| `__tests__/decision-os/phase7/widget-sdk-foundation.test.ts` | 620 | 146 tests |

**13 files created. Zero files modified. Zero changes to Phase 7.0/7.2/7.3.**

---

## SDK lifecycle

```
initializing ──► authenticating ──► loading ──► rendering ──► ready ──► refreshing ──► ready
     │                 │                │            │           │            │
     ▼                 ▼                ▼            ▼           ▼            ▼
   error            error/           error/        error      error/       error/
     │            rate_limited      offline/                  offline    rate_limited
     ▼                 │           rate_limited                  │            │
 initializing           ▼                │                       ▼            ▼
  (retry)            disposed             ▼                   loading      loading
                                       disposed
```

`disposed` is the only terminal state — reachable from every non-terminal state, with no
outbound transitions. `validateLifecycleSequence()` lets a test or a runtime self-check a
recorded transition history against the table in `lifecycle.ts`.

---

## Compatibility matrix

| Axis | Current value | Enforced by |
|---|---|---|
| `SDK_VERSION` | `7.4.0` | mismatch → warning (non-fatal; SDK is forward-compatible within a major) |
| `presentationVersion` (min) | `7.0.0` | mismatch → error (`VERSION_MISMATCH`-class failure in `validateSDKConfig`) |
| `widgetContractVersion` (min) | `7.3.0` | mismatch → error |
| `apiVersion` | `v1` | carried through, not yet enforced (single API version exists) |

| Embed target | Isolation | Native rendering | Sandboxing |
|---|---|---|---|
| iframe | full | no | yes |
| js_embed | none | no | no |
| web_component | partial | no | no |
| react_wrapper | none | no | no |
| vue_wrapper | none | no | no |
| angular_wrapper | none | no | no |
| native_bridge | none | yes | no |
| flutter_bridge | none | yes | no |

| Auth method | Credential | Tenant | Scope cap |
|---|---|---|---|
| api_key | required | required | none |
| jwt | required | required | none |
| signed_embed_token | required | required | none |
| partner_token | required | required | none |
| anonymous_public | forbidden | forbidden | `intelligence:platform:basic` only |
| enterprise_tenant_token | required | required | none |

---

## Enterprise readiness

`EXTENSION_POINT_MIN_TIER` gates 8 extension points by license tier (`standard` <
`premium` < `enterprise`), resolved by rank comparison — never a named-partner conditional:

| Extension point | Min tier |
|---|---|
| marketplace_widget | standard |
| commissioner_only_widget | standard |
| manager_only_widget | standard |
| white_label | premium |
| partner_branding | premium |
| premium_widget | premium |
| oem | enterprise |
| platform_analytics_widget | enterprise |

`buildEnterpriseExtension()` resolves `enabled` deterministically from tenant tier —
ready for a licensing/billing system to call directly once one exists.

---

## Licensing readiness

- Auth model separates **who** (tenant) from **what** (scopes, from Phase 5.5's
  `IntelligenceApiScope`) from **how much** (license tier, this phase's addition).
- `SDKEnterpriseExtension.restrictions: string[]` is an open string list — a future
  billing system can attach per-tenant restriction reasons without a schema change.
- Telemetry (`SDKEvent`) never carries a raw tenant ID, so usage analytics can be
  aggregated and billed without a privacy review of the SDK layer itself.

---

## White-label readiness

- `SDKTheme` with `mode: 'partner_override' | 'enterprise_branding'` plus a required
  `partnerBrandId` is the hook a white-label runtime resolves against a brand's own
  token table (mirrors Phase 7.0's `WhiteLabelConfig` pattern).
- `partnerBrandId` is validated present/absent by mode (`validateSDKTheme`) so a
  misconfigured white-label embed fails validation instead of silently rendering
  default branding.

---

## Remaining runtime implementation gaps (explicitly out of scope for 7.4)

1. **No actual HTTP client** — `mapWidgetModeToApiCall` (7.3) produces the call shape;
   nothing in 7.3 or 7.4 issues the fetch.
2. **No DOM/React/Vue/Angular rendering** — lifecycle states exist; nothing paints pixels.
3. **No credential verification** — `validateSDKAuth` checks contract *shape* only; real
   signature/JWT verification is a runtime + backend concern.
4. **No timer/scheduler** — `resolveRefreshStrategy` produces a plan; nothing runs a
   `setInterval` or visibility-change listener.
5. **No iframe postMessage protocol** — `EMBED_CAPABILITIES.iframe.supportsPostMessage`
   documents the capability; the actual message schema is undefined.
6. **No SDK package/bundle** — no npm package, no CDN script, no native binary.
7. **No telemetry sink** — `SDKEvent` objects are built; nothing sends them anywhere.

---

## Recommended Phase 7.5 implementation order

1. **JS/TS SDK runtime core** — implement the fetch + lifecycle state transitions against
   this spec, targeting `js_embed` and `iframe` first (widest partner reach, simplest auth
   surface via `signed_embed_token`).
2. **React wrapper** — thin wrapper around the JS core; AllFantasy's own dashboard becomes
   the first internal consumer, proving the spec against a real host before external partners.
3. **iframe postMessage protocol** — define the concrete message schema referenced as a gap
   above; needed before any partner can embed via `iframe` in production.
4. **First white-label partner pilot** — pick one partner, wire `SDKTheme.partner_override`
   + `WhiteLabelConfig` (7.0) end-to-end, validating the full chain from Presentation API to
   rendered widget.
5. **Native bridges (Swift/Kotlin/Flutter)** — only after the JS core and one real partner
   integration have shaken out spec gaps; native bridges are the highest cost to fix if the
   spec needs to change.

---

## Verification

- **146 new tests GREEN** — configuration validation, theme validation, auth contracts
  (6 methods), widget lifecycle (10 states, all valid/invalid transitions), event ordering,
  refresh logic (6 triggers), privacy guarantees (denylist + terminology scan), determinism,
  version compatibility, error contracts (10 codes), tenant isolation, serialization, no
  internal leakage, enterprise extension tier gating.
- **2229 total Decision OS tests GREEN, 0 regressions** (2083 prior + 146 new).
- **`npx tsc --noEmit`** — zero new type errors. The 8 pre-existing errors are unrelated JSX
  parse issues in `LeagueShell.tsx` / `TeamTab.tsx`, untouched by this phase.
- No writes, no Stage 1 soak changes, no Architecture Freeze violations.
