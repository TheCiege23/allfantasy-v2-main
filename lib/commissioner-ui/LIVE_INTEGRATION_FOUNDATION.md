# Commissioner OS — Phase 3.0: Live Decision OS Integration Foundation

Date: 2026-07-03. Scope: adapter and provider infrastructure only — no
module-specific integration, no page changes, no UI behavior change. The
existing Adapter Layer's public surface is unchanged; every module's own
`live.ts` remains the exact same honest placeholder it was before this
phase. What changed is the reusable plumbing a future real `live.ts` will
call through.

## 1. Live Integration Architecture Report

**The single most important finding this phase produced: no real Decision
OS backend exists anywhere in this repository or on `main`.**

A `lib/decision-os/` system — Canonical World, Behavioral Intelligence, a
real Intelligence API with auth/rate-limiting, a Widget SDK — genuinely
exists in this repository's git history, with real commits and real ADRs.
It does **not** exist on `main` and does **not** exist on this branch
(`claude/hungry-swartz-45f298`). Verified directly:

```
git log --oneline --all -- 'lib/decision-os/*'   → finds commits (real, somewhere)
git log --oneline main  -- 'lib/decision-os/*'   → empty (never merged to main)
Glob 'lib/decision-os/**' on this branch          → zero files
```

This repository runs dozens of parallel branches (`git branch -a` lists
20+ `claude/*` branches alone); that work lives on one or more of them,
still unmerged. This is not a judgment call I'm making unilaterally —
merging or otherwise making that work available to Commissioner OS is a
real, cross-branch decision for you to make explicitly. I have not
reached into that branch, assumed its API shape, or built anything that
depends on it existing.

**Architecture, given that finding:** the adapter (`lib/commissioner-os/adapter/`)
was already correctly designed for exactly this situation — every
module's `live.ts` is the sole place a real call happens, and the adapter
normalizes whatever it returns identically to stub/demo. This phase adds
the reusable *transport* that call would use, without inventing a target
to call, split into three layers:

1. **Transport** (`lib/commissioner-os/adapter/transport/`) — a generic,
   backend-agnostic HTTP call function (`callDecisionOS`), reusing this
   app's existing retry (`fetchJsonWithRetry`), timeout idiom
   (`AbortSignal.timeout`), and logging (`logStructured`) infrastructure.
2. **Auth** (`transport/auth.ts`) — pluggable (API key or session
   forwarding), since the real backend's auth requirement is unknown.
3. **Live readiness** (`lib/commissioner-os/liveReadiness.ts`) — a
   per-namespace, DB-backed (reusing `lib/feature-toggle`) kill switch a
   future real `live.ts` checks before attempting a call, so the twelve
   namespaces can be enabled independently rather than all-or-nothing.

None of this is wired into `adapter/index.ts` or any page. The adapter's
public interface (`CommissionerDecisionOSAdapter`, `getDecisionOSAdapter()`)
is byte-for-byte unchanged.

## 2. Provider Audit

| Item the task asked to verify | Finding |
|---|---|
| Existing Decision OS interfaces | None on this branch (see §1) |
| Transport layer | None Commissioner-OS-specific existed; `lib/error-handling/fetch-with-retry.ts` (retry+backoff) is real, existing, general-purpose infrastructure, now reused |
| API clients | None for a real Decision OS; dozens of *other* external-provider clients exist (OpenAI, DeepSeek, Rolling Insights, ESPN, etc.) and were surveyed for convention, not code |
| Service boundaries | N/A — no real backend to have boundaries with yet |
| Authentication | This app's existing NextAuth session (`lib/auth.ts`, `authOptions`) is real and already runs under every Commissioner OS page; reused, not rebuilt |
| Request lifecycle | Established via `fetchJsonWithRetry` + `AbortSignal.timeout`, both real and pre-existing elsewhere in this app |
| Caching | No Commissioner-OS-specific cache exists or was added — out of scope until a real backend defines what's cacheable and for how long; premature to build now |
| Retry logic | Real, existing: `lib/error-handling/retry.ts`'s `retryWithBackoff` (exponential backoff, configurable retryable-status predicate) |
| Telemetry | Real, existing: `lib/logging/structured.ts`'s `logStructured`/`createTimer`, already flagged reusable in Phase 0.3 |
| Error contracts | Already fully specified — `CommissionerErrorContract`/`CommissionerErrorCategory` in Platform Contracts; the transport's job is mapping HTTP outcomes onto this existing contract, not defining a new one |

**Conclusion**: nothing was assumed. Every "verify existing X" line above
was checked directly, not inferred from memory (a prior-session memory
claiming a real Decision OS backend existed was itself verified and found
to be branch-scoped to a different, unmerged branch — corrected in
project memory during this phase).

## 3. Transport Audit

`lib/commissioner-os/adapter/transport/` — new, reviewed for correctness
against its own design goals:

- **Timeout policy**: `AbortSignal.timeout(config.timeoutMs)`, default
  10s, configurable via `DECISION_OS_TIMEOUT_MS`. Verified via a mocked-fetch
  test that a persistent failure genuinely retries with real backoff
  timing before surfacing an error (confirms the retry wrapper is truly
  engaged, not bypassed).
- **Retry policy**: inherited unmodified from `fetchJsonWithRetry`'s own
  retryable-status set (408/429/500/502/503) — not redefined, so any
  future change to that shared utility's retry behavior benefits every
  consumer including this one automatically.
- **Cancellation support**: same `AbortSignal` — a caller can pass its own
  `init.signal` and have both the caller's and the timeout's cancellation
  respected (native `fetch` behavior; not a new mechanism).
- **Error normalization**: every failure (not-configured, timeout,
  network, 4xx/5xx, malformed JSON) maps onto `CommissionerErrorContract`
  with a real category (`categorizeStatus`), verified per-status-code in
  tests (401→unauthorized, 500→upstream_unavailable, etc.).
- **Logging**: every call logs a structured success/failure line
  (`decision_os_call_success`/`decision_os_call_failed`) via the existing
  `logStructured`, including `durationMs` from `createTimer` — this is
  the "telemetry hooks"/"tracing hooks" the task asked for, achieved by
  reuse rather than a new observability system.

No caching layer was built — verified as out of scope: caching semantics
(TTL, invalidation, per-namespace policy) depend entirely on what a real
backend's data freshness guarantees actually are, which don't exist yet
to design against. Building a cache now would be exactly the kind of
speculative infrastructure the phase's own instructions warn against.

## 4. Adapter Validation Report

**The existing Adapter Layer required zero changes.** Confirmed directly:
`lib/commissioner-os/adapter/index.ts` and `types.ts` are untouched by
this phase. `wrapMethod`'s normalization/validation/logging pipeline
already treats stub/demo/live identically; nothing about connecting a
real backend requires touching it — a future real `live.ts` simply
returns data through the same pipeline every stub/demo client already
does.

New: `__tests__/commissioner-os-live-integration-foundation.test.ts`,
proving — at runtime, not just via the type system — the exact guarantee
this phase exists to establish:

- All twelve namespaces' stub/demo/live clients expose the *identical*
  method surface (`Object.keys` equality, not just structural typing).
- The adapter itself composes identically regardless of which mode it was
  built for (`buildDecisionOSAdapter('stub'|'demo'|'live')` all expose the
  same twelve namespace keys).
- Swapping only the mode — no page or component change — moves a real
  call site (`adapter.leagueHealth.getHealthDetail()`) from demo data to
  the honest live placeholder, proving the "Stub == Demo == Live from the
  UI's perspective" contract concretely, once per representative call.

## 5. Contract Compatibility Report

No contract changed. `CommissionerPlatformResponse<T>`, `CommissionerErrorContract`,
`CommissionerErrorCategory`, and every module's own data contract in
`lib/commissioner-os/contracts/` are exactly as they were before this
phase. The transport's `categorizeStatus` function produces values drawn
from the existing `CommissionerErrorCategory` union — it does not extend
it, because every HTTP outcome this phase anticipated (400/401/403/404/409/5xx/timeout/network)
already maps cleanly onto an existing category. If a real backend's error
shape turns out to need a category this union doesn't have, that's a
Phase 3.1+ finding, not one this foundation phase needed to anticipate.

## 6. Environment Configuration Guide

Three new variables, added to `.env.example` following the exact
`{PROVIDER}_API_KEY`/`{PROVIDER}_BASE_URL` convention already used by
every other external integration in this app (`OPENAI_API_KEY`/`OPENAI_BASE_URL`,
`ROLLING_INSIGHTS_API_KEY`/`ROLLING_INSIGHTS_BASE_URL`, etc.):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DECISION_OS_BASE_URL` | No | unset (→ not configured) | The real backend's root URL. Its mere presence is what `isDecisionOSConfigured()` checks — until it's set, in any environment, every `callDecisionOS` call short-circuits to the honest placeholder with zero network activity. |
| `DECISION_OS_API_KEY` | No | unset | Service-to-service Bearer token. When absent, auth falls back to forwarding the current commissioner's session identity instead. |
| `DECISION_OS_TIMEOUT_MS` | No | `10000` | Per-call hard timeout via `AbortSignal.timeout`. |

No other environment configuration is required. The existing
`commissioner_os_data_mode` cookie (stub/demo/live selection) is
unaffected and unrelated — it decides which *tier* a request targets;
these three variables decide what a `live`-tier request, once a real
`live.ts` exists, actually connects to.

Per-namespace live readiness (`lib/commissioner-os/liveReadiness.ts`) is
**not** an environment variable — it's a runtime, DB-backed flag (reusing
`lib/feature-toggle`), settable without a redeploy, defaulting to `false`
for all twelve namespaces today.

## 7. Remaining Integration Roadmap

Per your own stated success criteria, the only remaining work is
replacing each individual `live.ts` placeholder with a real
implementation. Concretely, per namespace, that means:

1. Confirm (with you) that a real Decision OS backend is reachable —
   either the unmerged sibling-branch work is merged, or a different real
   backend is stood up. **This is the actual blocker**, not anything in
   this foundation.
2. Set `DECISION_OS_BASE_URL`/`DECISION_OS_API_KEY` for the target
   environment.
3. For one namespace at a time: replace its `live.ts`'s placeholder body
   with a real call through `callDecisionOS`, gated by
   `isLiveReady(moduleId)` (see the transport README's own example).
4. Call `setLiveReady(moduleId, true)` for that namespace once its real
   implementation is verified.
5. Repeat per namespace — Mission Control, League Health, Manager
   Intelligence, Recommendations, Workspace, Automation, Analytics,
   Reports, Search, Notifications, Activity, Help, in whatever order
   the real backend's own rollout supports.

No further foundation work is anticipated before that first real
`live.ts` is written — this phase's own test suite already proves the
adapter, contracts, and every page are ready for it.

---

## Files changed

New: `lib/commissioner-os/adapter/transport/{config,auth,client,index,README}.ts/md`,
`lib/commissioner-os/liveReadiness.ts`, `lib/commissioner-os/LIVE_INTEGRATION_FOUNDATION.md`,
`__tests__/commissioner-os-{transport,live-readiness,live-integration-foundation}.test.ts`.
Modified: `.env.example` (3 new variables), `C:\Users\Guap_\.claude\projects\...\memory\` (branch-scope correction — see project memory, not part of this repo), `lib/commissioner-os/PRODUCTION_HARDENING_AUDIT.md` (corrected a false "no tables exist" claim found during this phase's browser verification).

Zero changes to: `lib/commissioner-os/adapter/{index,types}.ts`, any module's own `decision-os-client/`, any page under `app/commissioner-os/`, any component under `components/commissioner-os/`.

## Tests run

Full Commissioner OS suite: **22 files, 300/300 passing** (up from 19
files / 259 tests — 3 new files, 41 new tests). Repo-wide typecheck:
**3,156 errors, exactly the established baseline, zero new.**

New test files: `commissioner-os-transport.test.ts` (12 tests — config,
auth header resolution, `callDecisionOS`'s not-configured/success/error-category
paths), `commissioner-os-live-readiness.test.ts` (3 tests — default-false,
set/get roundtrip, graceful DB-failure degradation), `commissioner-os-live-integration-foundation.test.ts`
(26 tests — the cross-namespace Stub==Demo==Live parity proof).

## Browser verification

Confirmed via `preview_*` tools: `/commissioner-os/league-health` renders
identically to before this phase (score, deduction breakdown, risk
table, recommendations, Send Check-In action) — zero visual or behavioral
difference, as expected since nothing from this phase is wired into any
page yet. No new console errors. (Incidentally, this pass also caught and
corrected a real error in the prior Phase 2 report — see Files Changed.)

## Remaining risks

- **The real Decision OS backend's existence is the actual open
  question**, not anything built this phase — see §1 and §7. This phase
  cannot resolve it; it requires your decision.
- The real backend's actual auth requirement, error shape, and rate
  limits are unknown until it exists — `callDecisionOS`'s auth strategy
  and error mapping are reasonable, precedented defaults, not guarantees
  they'll fit a real backend unmodified.
- No caching layer exists yet (deliberately, per §3) — the first real
  `live.ts` integration may surface a genuine need for one, which should
  be built against real latency/freshness data at that point, not
  guessed at now.
