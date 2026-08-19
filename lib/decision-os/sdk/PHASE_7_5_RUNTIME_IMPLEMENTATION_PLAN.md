# Phase 7.5 — Widget Runtime Implementation Plan

**Companion to:** `PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md`
**Status:** Planning complete. Zero runtime code exists yet.

---

## 1. Runtime component dependency map

```
                          lib/decision-os/sdk/          lib/decision-os/presentation/
                          (types + pure functions,       (types + pure functions,
                           Phase 7.3/7.4 — FROZEN)         Phase 7.0 — FROZEN)
                                    ▲                              ▲
                                    │  read-only imports            │  read-only imports
                                    │                              │
                         ┌──────────────────────────────────────────────────┐
                         │           sdk-runtime/core   (Phase 7.6)          │
                         │  framework-agnostic, zero DOM deps except fetch   │
                         │                                                    │
                         │  ConfigGate ── validateSDKConfig (7.4)             │
                         │  AuthPreCheck ── validateSDKAuth (7.4, shape only) │
                         │  HttpClient ── mapWidgetModeToApiCall (7.3)        │
                         │  LifecycleController ── lifecycle.ts (7.4)         │
                         │  RefreshEngine ── resolveRefreshStrategy (7.4)     │
                         │  ErrorMapper ── buildSDKError (7.4)                │
                         │  TelemetrySink (interface) ── buildSDKEvent (7.4)  │
                         │  PrivacyGuard ── stripInternalFields/hasLeakage    │
                         └──────────────────────────────────────────────────┘
                                    ▲            ▲            ▲           ▲
                        depends on  │            │            │           │  depends on
                     ┌──────────────┘            │            │           └──────────────┐
                     │                            │            │                          │
        ┌────────────────────┐    ┌───────────────────────┐   │            ┌─────────────────────┐
        │ embed-iframe        │    │ embed-web-component    │   │            │ embed-js (js_embed)  │
        │ (Phase 7.8)         │    │ (Phase 7.9)             │   │            │ (Phase 7.9)           │
        │ postMessage schema  │    │ Shadow DOM isolation    │   │            │ direct DOM, trusted   │
        │ iframe host page    │    │ Custom Element wrapper  │   │            │ first-party only      │
        └────────────────────┘    └───────────────────────┘   │            └─────────────────────┘
                                                                 │
                                                    ┌────────────────────┐
                                                    │ react (Phase 7.7)   │
                                                    │ thin wrapper +      │
                                                    │ WidgetRenderer impl │
                                                    └────────────────────┘

                     (vue / angular / native_bridge / flutter_bridge — future,
                      same shape, not scheduled — placeholders only)
```

**Dependency direction is one-way and permanent**: adapters (`react`, `embed-iframe`,
`embed-web-component`, `embed-js`, future `vue`/`angular`/native bridges) depend on `core`.
`core` depends only on the two frozen spec packages. No adapter depends on another adapter.
`lib/decision-os/sdk` and `lib/decision-os/presentation` NEVER import from `sdk-runtime/`.

**The `WidgetRenderer` interface** is the one seam that crosses the core/adapter boundary in the
other direction: core's `LifecycleController` calls into a renderer supplied by whichever adapter
instantiated it (`render(presentationData, theme): void`), rather than core depending on a
specific rendering technology. This is what lets one `LifecycleController` implementation serve
React, a raw iframe, and eventually native bridges without forking core logic.

---

## 2. Security model — iframe / web component / JS embed

### Cross-cutting rules (apply to every embed target)

- **Credential never verifies client-side** (ADR D3). The runtime's `AuthPreCheck` only checks
  shape/expiry via the existing `validateSDKAuth()`; the Presentation API's
  `checkIntelligenceGate()` remains the sole authority.
- **Credential never logged, never echoed.** `PrivacyGuard` wraps every outbound `SDKError` and
  `SDKEvent` through `hasInternalLeakage()`/`stripInternalFields()` before it can reach a host
  callback (`onError`, `onEvent`) or a telemetry sink. HTTP request/response logging in `core`
  (dev-mode only) must redact the `X-AllFantasy-API-Key` header unconditionally.
  <br>Because the widget renders inside a partner's own execution context — not a sandbox
  AllFantasy controls end-to-end — this redaction is a defense against AllFantasy's own runtime
  accidentally handing the partner page a way to exfiltrate the key (e.g. via a thrown error
  object a partner's own error-monitoring tooling might capture), not a defense against the
  partner acting maliciously with a key it was legitimately issued.
- **Tenant assertion on every response.** Before rendering, `core` verifies the Presentation
  API response's entity identifiers match the `SDKConfig` that was requested. Mismatch → typed
  `TENANT_MISMATCH` `SDKError` (already defined in Phase 7.4), never a silent render of the
  wrong tenant's data.
- **Rate limiting is respected, not fought.** On a `RATE_LIMITED` `SDKError`, `RefreshEngine`
  backs off per the resolved `SDKRefreshStrategyConfig` (Phase 7.4) — it never retries
  immediately or in a tight loop.

### iframe (strongest isolation — the target for first partner pilot)

- Iframe `sandbox` attribute: `allow-scripts allow-popups` only. **`allow-same-origin` is never
  combined with `allow-scripts`** — that combination lets sandboxed content programmatically
  remove its own sandbox restrictions, defeating the isolation entirely.
- The AllFantasy-hosted page loaded inside the iframe sets
  `Content-Security-Policy: frame-ancestors <allowlisted partner origins>` — resolved from the
  tenant's `WidgetTenantConfig.allowedOrigins` (Phase 7.3). An origin not on the allowlist cannot
  frame the widget at all, regardless of postMessage behavior.
- Every inbound `postMessage` handler validates `event.origin` against the same allowlist before
  processing. Every outbound `postMessage` call specifies an explicit `targetOrigin` — **never
  `'*'`**.
- The iframe authenticates using a **short-lived `signed_embed_token`** issued by AllFantasy's
  backend per embed session, scoped to exactly one `widgetId` + entity + expiry — never the
  partner's raw long-lived `api_key` or `partner_token`, which stay server-side on the partner's
  own backend if they issue embed sessions themselves.
- A handshake nonce (generated by the host page, echoed by the iframe on its first message)
  binds a specific mounted iframe instance to a specific `widgetId`, preventing a malicious
  script elsewhere on the same host page from spoofing messages to a widget it doesn't own.

### Web component (`embed-web-component`)

- No process isolation is possible — a Custom Element shares the host page's JS realm by
  definition. Mitigations narrow the *blast radius* rather than eliminating it:
  - **Closed-mode Shadow DOM** prevents host page CSS and `querySelector` from reaching into
    widget-internal DOM structure.
  - The credential is held only in a **module-private `WeakMap` keyed by element instance** —
    never a DOM attribute, never a public property, never anything `element.getAttribute(...)`
    or `JSON.stringify(element)` could expose.
  - Documentation (not enforcement) advises partners to serve pages embedding this target over
    HTTPS with a reasonably strict CSP; AllFantasy cannot enforce a partner's own page CSP.

### JS embed (`embed-js`, direct DOM)

- The **weakest isolation** target — full mutual trust with the host page is required, since the
  loader script runs directly in the host's JS realm with no boundary at all.
- Per the ADR, this target should launch gated to **trusted first-party AllFantasy surfaces and
  explicitly allowlisted partners only** (enforced by scope: `partner_token`s issued for
  `js_embed` carry a narrower default scope than tokens issued for `iframe`), not offered as an
  open self-serve embed target until the iframe and web-component targets have proven the
  security model in production.

---

## 3. SDK package layout proposal

```
sdk-runtime/                              (NEW top-level directory — outside lib/decision-os/)
  core/
    src/
      configGate.ts          — wraps validateSDKConfig (7.4)
      authPreCheck.ts         — wraps validateSDKAuth (7.4), shape-only
      httpClient.ts           — implements mapWidgetModeToApiCall (7.3) as a real fetch
      lifecycleController.ts  — drives lifecycle.ts (7.4) transitions
      refreshEngine.ts        — implements resolveRefreshStrategy (7.4) as real timers
      errorMapper.ts          — normalizes fetch/network failures into buildSDKError (7.4)
      telemetrySink.ts        — TelemetrySink interface + NoopTelemetrySink default
      privacyGuard.ts         — runtime wrapper around stripInternalFields/hasInternalLeakage
      widgetRenderer.ts       — the WidgetRenderer interface (no implementation)
      index.ts
    package.json               — "@allfantasy/widget-sdk-core", private: true (unpublished)
  react/
    src/
      WidgetRenderer.tsx       — React implementation of the core WidgetRenderer interface
      useWidget.ts             — hook wrapping LifecycleController for React consumers
      index.ts
    package.json               — "@allfantasy/widget-sdk-react", private: true
  embed-iframe/
    src/
      postMessageSchema.ts     — versioned message types + origin validation
      iframeHost.ts            — the bootstrap script the hosted iframe page runs
      iframeClient.ts          — the host-page-side controller a partner's page loads
    package.json               — "@allfantasy/widget-sdk-iframe", private: true
  embed-web-component/
    src/
      WidgetElement.ts         — Custom Element definition, Shadow DOM, WeakMap credential store
    package.json               — "@allfantasy/widget-sdk-web-component", private: true
  embed-js/
    src/
      loader.ts                — script-tag loader for trusted first-party/allowlisted use
    package.json               — "@allfantasy/widget-sdk-js", private: true
  vue/  angular/  native/swift/  native/kotlin/  native/flutter/
    (directory placeholders only — no source files until scheduled; each will mirror `react/`'s
     shape: a thin adapter depending on `core` + a platform-native WidgetRenderer)
```

**Why unpublished (`private: true`) initially:** every package stays internal to this repo until
the Partner Sandbox rollout stage (§6) validates the contract against a real second party. There
is no cost benefit to publishing a public npm package before a single external consumer exists,
and publishing early would lock in API surface prematurely. `@allfantasy/*` naming is reserved
now so the eventual publish is a visibility flip, not a rename.

**Why monorepo-internal rather than a separate repo:** `core` and every adapter depend on the
frozen contract types in `lib/decision-os/sdk` and `lib/decision-os/presentation`. Keeping them
in this repo means those imports are ordinary TypeScript path imports, type-checked on every
change to the spec — a spec change that breaks the runtime fails CI immediately instead of
silently drifting until a separate repo's next dependency bump.

---

## 4. Runtime test strategy

| Layer | Strategy | Pattern reused from this codebase |
|---|---|---|
| `core` unit tests | Pure-function-style tests with every I/O boundary injected (fake `fetch`, fake timers via `vi.useFakeTimers()`, fake `TelemetrySink`) | Mirrors `IntelligenceDataProvider` injection in `intelligence-handlers.ts` — no real network or real timers in CI, ever |
| Import-graph architecture test | Static test asserting `sdk-runtime/core` never imports from `lib/decision-os/world`, `lib/decision-os/behavioral/*` (beyond the public `IntelligenceApiScope`/`IntelligenceTier` types), or any Prisma client | Directly reuses the pattern already proven in `canonical-world-architecture.test.ts` |
| Credential-safety tests | Assert no `SDKError`, `SDKEvent`, or thrown exception ever contains a fixture credential string, across every HTTP failure mode the mock `fetch` can simulate (401, 429, network error, malformed JSON) | Extends the `hasInternalLeakage()` test pattern from Phase 7.4's suite to live HTTP mocks |
| postMessage schema tests | Simulate `window.postMessage` with both allowlisted and non-allowlisted mock origins; assert rejection of the latter; assert every outbound call in test fixtures specifies a non-`'*'` `targetOrigin` | New pattern — no prior postMessage code in this repo to reuse |
| Lifecycle integration tests | Drive `LifecycleController` through full sequences (init → auth → load → render → ready → refresh → dispose) against a fake `HttpClient` and fake `WidgetRenderer`; assert every transition matches `validateLifecycleSequence()` from Phase 7.4 | Reuses the Phase 7.4 lifecycle validator directly as the test oracle |
| Rate-limit / backoff tests | Fake `fetch` returns `RATE_LIMITED` on the Nth call; assert `RefreshEngine` waits at least `backoffSeconds` (via fake timers) before retrying, and never exceeds `maxRetries` | New pattern, mirrors the deterministic-config style already used for `resolveRefreshStrategy` |
| Browser/E2E smoke tests | Deferred to the Staging Widget rollout stage (§6) — once a real `WidgetRenderer` exists, use the repo's existing Playwright setup to load a demo page and assert the widget renders, refreshes, and disposes cleanly | Reuses the project's existing Playwright infrastructure (visible in `.next-playwright-3101/` build artifacts) rather than introducing a new E2E tool |

**No live network calls are permitted in CI at any layer.** Every test above either injects a
fake `fetch`/`TelemetrySink`/timer, or (for the eventual E2E tier) talks only to a staging
Presentation API instance backed by the non-prod database (`ep-winter-salad`), never production.

---

## 5. Rollout plan

Four stages, each strictly gated on the previous stage's success, each independently reversible.
**None of these stages execute in Phase 7.5** — this section is the plan, not the execution.

### Stage 1 — Internal demo
- `core` + `react` adapter rendered inside the AllFantasy app itself (dogfooding), behind a new
  feature flag (`WIDGET_SDK_INTERNAL_DEMO_ENABLED`), visible only to internal accounts.
- Talks to the Presentation API on non-prod data. No partner exposure, no iframe, no external
  origin involved at all — this stage validates the `core` + `react` chain end-to-end for the
  first time before any cross-origin concern is introduced.
- Exit criteria: a real internal user can see a real widget render, refresh on a timer, and
  dispose cleanly with zero console errors and zero telemetry-sink failures.

### Stage 2 — Staging widget
- Same widget, now embedded via the `embed-iframe` adapter on a **staging-only, second-origin
  "partner simulator" page** built specifically to exercise the cross-origin security model from
  §2 — origin allowlist rejection, postMessage nonce handshake, CSP `frame-ancestors`.
- Reachable by QA only; backed by the non-prod database.
- Exit criteria: the postMessage schema tests from §4 pass against the real staging deployment
  (not just mocks), and a deliberate "wrong origin" attempt is observably rejected.

### Stage 3 — Partner sandbox
- One real cooperating partner (or an AllFantasy-controlled sandbox origin standing in for one)
  receives a `partner_token`-scoped sandbox tenant.
- **iframe only** at this stage — the strongest-isolation target ships first; `embed-js` and
  `embed-web-component` are not offered to any partner until iframe has run in this stage without
  a security incident for an agreed observation period.
- Rate limits and scopes are kept deliberately tighter than eventual production defaults.
  `TelemetrySink` is wired to a real but clearly sandboxed collector — no sandbox telemetry ever
  mixes with production analytics.
- Exit criteria: the partner successfully embeds, renders, and refreshes a widget in their own
  environment with zero involvement from AllFantasy engineering after initial setup.

### Stage 4 — Production widget
- Graduated per embed target, using a **new, independent flag family**
  (`WIDGET_SDK_IFRAME_LIVE`, `WIDGET_SDK_WEB_COMPONENT_LIVE`, `WIDGET_SDK_JS_EMBED_LIVE`) —
  explicitly never the existing Stage 1 Decision OS soak flags (ADR D4).
- iframe flips on first; web component and JS embed follow independently, each individually
  reversible without affecting the others.
- Exit criteria per target: matches whatever bar the existing Decision OS Stage 1 soak process
  uses for its own graduation (parity/error-rate thresholds), adapted to widget-specific signals
  (render success rate, telemetry delivery rate, `SDKError` rate by code).

---

## 6. Phase 7.6 first implementation ticket

The smallest safe vertical slice: **`sdk-runtime/core`, excluding refresh timers and all
adapters.**

```
PHASE 7.6 — Widget SDK Runtime Core (HTTP + Auth Pre-check + Lifecycle + Errors)

Goal: Implement the framework-agnostic runtime core that drives a widget through its lifecycle
using the Phase 7.3/7.4 contracts, with zero DOM, zero React, zero timers, zero embed adapter.

Rules: ADR referenced (7.5, no new ADR needed unless a contract changes). Preserve Architecture
Freeze. No refresh engine (deferred — needs real timers, a separate ticket per D2's slicing).
No embed adapter (iframe/web-component/js/react all deferred). No SDK publish. No Stage 1 soak
changes. No writes. Every network call goes through an injected `fetch`-compatible interface —
never the global `fetch` directly — so tests never touch a real network.

Scope: Create `sdk-runtime/core/src/`:
  - `httpClient.ts` — takes a `WidgetApiCall` (from `mapWidgetModeToApiCall`, Phase 7.3) + an
    injected fetch function + an `SDKAuth`, attaches credentials per auth method (Authorization
    header for api_key/jwt/enterprise_tenant_token; token param for signed_embed_token/
    partner_token; no credential for anonymous_public), returns the parsed presentation
    response or a mapped `SDKError`.
  - `authPreCheck.ts` — thin wrapper around Phase 7.4's `validateSDKAuth`, returning a typed
    `SDKError('UNAUTHORIZED')` immediately on shape failure, before `httpClient` is invoked.
  - `lifecycleController.ts` — owns current `SDKLifecycleState`, exposes `transition(to)`
    that calls `isValidLifecycleTransition` (Phase 7.4) and throws a typed programmer error
    (not an `SDKError`) if the caller attempts an invalid transition — this is a code-correctness
    guard, not a user-facing failure mode.
  - `errorMapper.ts` — maps `httpClient` failures (network error, non-2xx status, malformed
    JSON, tenant-mismatch on the returned entity) to the correct `SDKErrorCode` via
    `buildSDKError` (Phase 7.4).
  - `index.ts` — barrel export.

Tests: unit tests per module (all I/O injected, no real fetch/timers), plus the import-graph
architecture test asserting `sdk-runtime/core` never imports from `lib/decision-os/world`,
`lib/decision-os/behavioral/*` (beyond the public scope/tier types), or any Prisma client.

Success: A caller can construct a `LifecycleController`, call `transition('initializing')` →
`transition('authenticating')` → (authPreCheck) → `transition('loading')` → (httpClient, fake
fetch) → `transition('rendering')` → `transition('ready')`, entirely against fakes, with every
transition validated against the Phase 7.4 lifecycle table and every failure surfaced as a typed
`SDKError` — with zero DOM, zero timers, and zero adapter code written.
```

This ticket deliberately excludes `refreshEngine.ts` (needs real timer semantics — its own
ticket), `telemetrySink.ts` (needs a decision about the sandbox-vs-production collector split
from §5 Stage 3 — premature before Stage 1 even exists), and `privacyGuard.ts` (thin enough to
fold into whichever ticket first needs to redact a real HTTP error, likely this one's follow-up).
Keeping the first ticket to HTTP + auth pre-check + lifecycle + errors matches the ADR's D2
slicing principle: the smallest piece that is independently testable, independently reviewable,
and produces a runtime component with no framework dependency at all.
