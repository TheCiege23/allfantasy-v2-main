# Scoped Live Mode Implementation Report — Phase L1

Commercial Readiness / Phase L1 — Scoped Production Live Verification.
Implements a production-safe path for exactly one existing allowlisted
account (`theciege26`, via the existing `isSiteAdmin()` allowlist) to use
the real Decision OS Intelligence pipeline in Analytics and Mission
Control, while every other user continues to receive the unchanged demo
experience. **No architecture was introduced.** Every piece reused
below already existed before this change: the transport layer
(`callDecisionOS`), the adapter layer, NextAuth session resolution, the
`isSiteAdmin()` allowlist, the `isLiveReady()` feature-flag system, and
the existing `notYetIntegrated()` graceful-degradation contract.

This report covers the implementation itself. See
`SCOPED_LIVE_MODE_TEST_REPORT.md` for verification evidence.

## Files Changed

| File | Change |
|---|---|
| `lib/commissioner-os/liveModeAccess.ts` | **New.** `canAccessLiveDecisionOSData()` — calls `getServerSession()` and reuses `isSiteAdmin()` from `lib/auth/admin.ts` directly. This is the real security boundary described below. |
| `lib/commissioner-os/analytics/decision-os-client/live.ts` | Added a `canAccessLiveDecisionOSData()` check to `getSnapshot()` and `getSummary()`, immediately after the existing `isLiveReady('analytics')` check and before `resolveActiveLeagueId()`/`callDecisionOS()`. |
| `lib/commissioner-os/decision-os-client/live.ts` (Mission Control) | Same treatment for `getLeagueHealthSummary()`, `getManagerHighlights()`, `getMissionControlKpis()`. |
| `components/commissioner-os/demo-mode/DataModeIndicator.tsx` | Added an `isAdmin` prop (default `false`). Production visibility gate changed from unconditional `NODE_ENV === 'production'` to `NODE_ENV === 'production' && !isAdmin`. |
| `components/commissioner-os/shell/CommissionerHeader.tsx` | Added an `isDataModeAdmin` prop, forwarded to `<DataModeIndicator isAdmin={isDataModeAdmin} />`. |
| `app/commissioner-os/layout.tsx` | Resolves `getServerSession(authOptions)` (added into the layout's existing `Promise.all`) and computes `isDataModeAdmin = isSiteAdmin(session?.user ?? null)` server-side; passes it to `CommissionerHeader`. |
| `__tests__/commissioner-os-live-mode-access.test.ts` | **New** — 6 tests directly covering `canAccessLiveDecisionOSData()`. |
| `__tests__/commissioner-os-data-mode-indicator.test.tsx` | **New** — 4 tests covering the UI visibility gate. |
| `__tests__/commissioner-os-league-analytics-live-integration.test.ts` | Updated — added an explicit mock for the new gate (defaulted `true`, matching every existing test's implicit "authorized caller" assumption) and 3 new tests for the non-admin/admin split. |
| `__tests__/commissioner-os-mission-control-live-integration.test.ts` | Updated — same treatment, 4 new tests across the 3 methods. |

No file outside this list was touched. In particular: `lib/decision-os/`
(the Decision OS backend itself), `adapter/transport/` (the transport
layer), `adapter/` (the adapter layer), any of Reports/Help/Workspace/
Automations/Recommendations/Notifications/Activity/Search/League
Health/Manager Intelligence, and anything under NFL Redraft's own
directories are all completely unmodified.

## Security Review

| Requirement | How it's met |
|---|---|
| No public bypasses | Both gates (`isLiveReady()` and the new `canAccessLiveDecisionOSData()`) are server-side checks evaluated on every request; there is no client-reachable override for either. |
| No hidden query parameters | Nothing in this change reads a query string, header, or any client-supplied value to decide admin status. |
| No client-side-only authorization | `isDataModeAdmin` is computed once, server-side, in `app/commissioner-os/layout.tsx`, from the real NextAuth session — never from a client-supplied prop, cookie value, or localStorage. The client-visible `isAdmin` prop passed to `DataModeIndicator` only controls whether the *switcher UI* renders; **it is not the authorization boundary**. Even if a non-admin user manipulated React state/props client-side to force the switcher visible and set the cookie, `canAccessLiveDecisionOSData()` inside each `live.ts` independently re-checks the real server-side session before any real data is ever fetched — the UI toggle alone cannot produce real data. |
| No weakening of authentication | NextAuth's `getServerSession(authOptions)` is used exactly as it already is everywhere else in this codebase (identical call convention to `resolveDecisionOSAuthHeaders()` and `app/api/user/me/route.ts`). No new auth provider, session shape, or cookie mechanism was introduced. |
| No exposure of Decision OS internals | `canAccessLiveDecisionOSData()` returns a plain boolean; no session data, error detail, or internal Decision OS state is ever returned to the client. A failed check returns the exact same `notYetIntegrated()` error shape every other honest-degradation path already returns. |
| Adapter and transport boundaries preserved | The new check runs *before* `callDecisionOS()` is ever invoked. `callDecisionOS`, `resolveDecisionOSAuthHeaders`, and everything under `adapter/` are byte-for-byte unchanged. |
| Audit logging preserved | `callDecisionOS()`'s existing `logStructured('info'/'error', 'commissioner-os-transport', 'decision_os_call_success'/'decision_os_call_failed', ...)` calls are unaffected — they still fire on every real attempt that gets past both gates, exactly as before. A denied admin check does not call `callDecisionOS()` at all, so (correctly) it produces no transport log line — the denial itself is not separately logged in this change; see Production Risk Assessment below for whether that's acceptable at this stage. |

## Rollback Procedure

Every part of this change is reversible without touching Production data:

1. **Fastest — revert the code.** This entire change is currently uncommitted in this worktree (see the commit step in this same turn). If it turns out to need reverting after being committed/merged/deployed, `git revert <commit>` restores the prior behavior exactly: `DataModeIndicator` returns to an unconditional `NODE_ENV === 'production'` gate, and both `live.ts` files lose the `canAccessLiveDecisionOSData()` check (falling back to `isLiveReady()` alone, i.e. today's already-deployed, already-verified behavior).
2. **No env var rollback needed.** This change touches zero environment variables — Gate B (`DECISION_OS_INTELLIGENCE_API_ENABLED`/`DECISION_OS_BASE_URL`/`DECISION_OS_API_KEY`) remains exactly where the staged rollout left it (Preview-only), so there is nothing to unset in Production even in a rollback scenario.
3. **No data migration to reverse.** Nothing in this change reads or writes `platform_config`, `AppUser`, or any other production table. The only thing a real admin session can change is their own browser's `commissioner_os_data_mode` cookie — clearing it (or simply not being on the allowlist) returns that one session to `demo` immediately, no server-side state to clean up.
4. **Partial rollback is also possible**, if ever needed: reverting only the `DataModeIndicator`/`CommissionerHeader`/`layout.tsx` changes (removing the admin's ability to reach `live` mode) while leaving `canAccessLiveDecisionOSData()` in `live.ts` in place is safe and non-breaking — it would simply mean the extra server-side check never gets exercised (since no session can reach `live` mode at all), a strictly more conservative state.

## Production Risk Assessment

**Overall risk: Low**, contingent on the two items flagged below being
accepted as a deliberate, documented trade-off for this specific
verification phase (not a permanent gap):

- **No real Decision OS backend is reachable from Production regardless of this change.** `DECISION_OS_INTELLIGENCE_API_ENABLED`/`DECISION_OS_BASE_URL`/`DECISION_OS_API_KEY` remain Preview-only. Once this change is deployed, `theciege26` gains the *ability* to select `live` mode, but `analytics`/`mission-control`'s `live.ts` will still hit the same `503`/`notConfiguredError` path already proven throughout this engagement — the admin will see the honest placeholder, not real data, until Gate B is separately opened. This makes the current deployment step low-risk by construction: there is no real data path to expose yet.
- **The denial path is not separately audit-logged** (see Security Review above) — a non-admin session that somehow reached `live` mode (which requires the UI toggle to be forced, itself requiring dev-tools tampering, since no legitimate path sets the cookie for non-admins) would be silently redirected to the placeholder rather than generating a security-relevant log line. Given the UI toggle is genuinely inaccessible to non-admins through any normal interaction, this is assessed as low residual risk for this phase, but worth adding (a single `logStructured('warn', ...)` call in the denial branch) before this mechanism is used for anything beyond this scoped verification.
- **Single-account scoping is enforced correctly** — `isSiteAdmin()` checks `email`/`username`/`name` against the existing allowlist (`STATIC_ALL_ACCESS_USERNAMES = ["theciege26"]` plus the `ALL_ACCESS_USERNAMES`/`ADMIN_EMAILS`/`ALL_ACCESS_EMAILS` env vars already in Production), so this is not a blanket internal-testing bypass — it resolves to exactly the same one-account allowlist already used elsewhere in this app (e.g. `app/api/user/me/route.ts`).
- **No change to the blast radius of any other module.** Recommendations, Notifications, Activity, Search, League Health, Manager Intelligence, Reports, Help, Workspace, and Automations are untouched — their `isLiveReady` flags are still unset, and this change adds no admin-gating logic to any of them (out of scope for this phase, matching the instruction).

## GO / HOLD Recommendation

**GO — safe to commit and, when you separately decide to, merge and
deploy.** This is a narrowly-scoped, fully test-covered, non-destructive
addition on top of an already-deployed, already-verified base platform.
It introduces no new architecture, touches no Production data, and
cannot expose real Decision OS data to anyone until a separate, explicit
decision is made to also open Gate B (Decision OS Intelligence API
enablement in Production) — which remains untouched by this change.

Recommend, before broader use of this specific admin-live-mode mechanism
beyond this verification phase: add the one audit-log line noted above
for denied attempts. Not a blocker for this phase's commit.
