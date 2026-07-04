# Scoped Production Live-Mode Report — Gate Opening Plan, Option C

Implements the smallest safe version of Option C from `GATE_OPENING_PLAN.md`:
a production-safe way for exactly one existing allowlisted account
(`theciege26`) to reach `commissioner_os_data_mode=live` and, independently,
a second server-side check inside `analytics/live.ts` and Mission
Control's `live.ts` that must also pass before either module will attempt
a real Decision OS call — for anyone, in any environment. **No Production
env var was changed. No additional `isLiveReady` flag was enabled. Nothing
in this change has been merged to `main` or deployed.**

## What Changed

### 1. Reused the existing admin allowlist (requirement 1)
No new allowlist was created. Everything below calls
`isSiteAdmin()`/`hasAllFantasyTestAccess()` from `lib/auth/admin.ts`
(unchanged) — already backed by the static `STATIC_ALL_ACCESS_USERNAMES = ["theciege26"]`
entry and the `ALL_ACCESS_USERNAMES`/`ADMIN_EMAILS` Production env vars.

### 2. Admin-only Production path to set `commissioner_os_data_mode=live` (requirement 2)
- [`components/commissioner-os/demo-mode/DataModeIndicator.tsx`](../../components/commissioner-os/demo-mode/DataModeIndicator.tsx) — added an `isAdmin` prop (default `false`); the production gate is now `NODE_ENV === 'production' && !isAdmin` (was an unconditional `NODE_ENV === 'production'`). Non-admin production behavior is byte-for-byte unchanged.
- [`app/commissioner-os/layout.tsx`](../../app/commissioner-os/layout.tsx) — now resolves `getServerSession(authOptions)` (added to the existing `Promise.all`, no new round trip pattern) and computes `isDataModeAdmin = isSiteAdmin(session?.user ?? null)` server-side, passed down as a prop. The session is never exposed to the client beyond this one boolean.
- [`components/commissioner-os/shell/CommissionerHeader.tsx`](../../components/commissioner-os/shell/CommissionerHeader.tsx) — threads `isDataModeAdmin` through to `<DataModeIndicator isAdmin={isDataModeAdmin} />`.

**This is UI visibility only.** Even if a technically sophisticated
non-admin user forced this prop client-side (e.g. via dev tools) and set
the cookie themselves, requirement 3 below would still block them —
the client-visible toggle is not the real security boundary.

### 3. Server-side caller check inside both live.ts files (requirement 3, the real boundary)
New file: [`lib/commissioner-os/liveModeAccess.ts`](../liveModeAccess.ts) —
`canAccessLiveDecisionOSData()`, calling `getServerSession()` +
`isSiteAdmin()` directly (independent of the UI cookie), returning `false`
(never throwing) on no session, a non-admin session, or a session
resolution failure.

Wired into every method that previously only checked `isLiveReady()`:
- [`lib/commissioner-os/analytics/decision-os-client/live.ts`](../analytics/decision-os-client/live.ts) — `getSnapshot()`, `getSummary()`.
- [`lib/commissioner-os/decision-os-client/live.ts`](../decision-os-client/live.ts) (Mission Control) — `getLeagueHealthSummary()`, `getManagerHighlights()`, `getMissionControlKpis()`.

Each method's shape is now: `isLiveReady` check → **new** `canAccessLiveDecisionOSData` check → (existing) `resolveActiveLeagueId` → (existing) `callDecisionOS`. A failed admin check returns the exact same `notYetIntegrated()` placeholder already used for `isLiveReady() === false` — no new error shape, no new failure mode.

## Requirements Checklist

| # | Requirement | Status |
|---|---|---|
| 4 | Not exposed to normal users | Met — non-admin production behavior unchanged in both the UI (§2) and the data path (§3, independent of §2) |
| 5 | No additional Commissioner OS flags enabled | Met — `commissioner_os_live_ready_analytics` and `-mission-control` remain the only two `true` rows; nothing else touched |
| 6 | Reports/Help/Workspace/Automations/NFL Redraft untouched | Met — only analytics + Mission Control's `live.ts`, the shared demo-mode/shell files, and `liveModeAccess.ts` were touched |
| 7 | Decision OS not redesigned | Met — `lib/decision-os/` untouched; all changes are inside Commissioner OS's own `live.ts` customization points, exactly where `adapter/README.md` documents real integration work belongs |
| 8 | Transport/adapters not bypassed | Met — the new check runs *before* `callDecisionOS()` is ever called; `callDecisionOS`, `adapter/`, and `resolveDecisionOSAuthHeaders` are all untouched |
| 9 | Graceful degradation intact | Met — verified by tests below; the admin check's failure path reuses the identical `notYetIntegrated()` contract already in place |

## Tests Added

- **`__tests__/commissioner-os-live-mode-access.test.ts`** (new, 6 tests) — proves `canAccessLiveDecisionOSData()` reuses the real allowlist: resolves `true` for `theciege26` (any casing) and the static allowlisted email, `false` for an ordinary account, `false` for no session, `false` (never throws) if session resolution itself fails.
- **`__tests__/commissioner-os-data-mode-indicator.test.tsx`** (new, 4 tests) — non-admin in production renders nothing (both the default and explicit-`false` cases); admin in production renders the switcher; development is unaffected regardless of `isAdmin`.
- **`__tests__/commissioner-os-league-analytics-live-integration.test.ts`** (updated, +3 tests) — new "admin-only gating" block: non-admin gets the placeholder without ever touching prisma/transport; admin proceeds to the transport. All prior tests updated to explicitly mock the new gate as `true` (an authorized caller), preserving what they always proved.
- **`__tests__/commissioner-os-mission-control-live-integration.test.ts`** (updated, +4 tests) — identical treatment for all 3 Mission Control methods.

### Test Results

```
npx vitest run commissioner-os
 Test Files  32 passed (32)
      Tests  399 passed (399)
```
Includes, specifically:
```
npx vitest run commissioner-os-league-analytics-live-integration commissioner-os-mission-control-live-integration
 Test Files  2 passed (2)
      Tests  39 passed (39)
```
No regressions in any of the 32 Commissioner OS test files, including
`commissioner-os-demo-mode.test.ts`'s stub/demo/live parity checks (its
"live placeholder" test short-circuits on the real `isLiveReady()` check
before ever reaching the new admin check, so it is byte-for-byte
unaffected).

## Typecheck

`npx tsc --noEmit -p tsconfig.json` — full run produces the same
pre-existing ~3,300-line baseline noise already tracked in this
repo's session memory (unrelated to this change). **Zero** errors
reference any file touched by this change (`liveModeAccess.ts`,
`DataModeIndicator.tsx`, `CommissionerHeader.tsx`,
`app/commissioner-os/layout.tsx`, either `live.ts`) — confirmed by
grepping the full output for each touched path.

## What This Does *Not* Do Yet

- **Not merged to `main`, not deployed.** All of the above exists only
  in this worktree/branch. Until it is committed, merged, and a new
  Production deployment completes, none of this code runs in Production
  at all — the current Production behavior is unchanged from
  `PRODUCTION_VISUAL_UPDATE_AUDIT.md`.
- **No Production env var was changed**, per your explicit instruction.
  This means: even after this code is deployed, Gate B
  (`DECISION_OS_INTELLIGENCE_API_ENABLED`/`DECISION_OS_BASE_URL`/
  `DECISION_OS_API_KEY`, all still Preview-only) remains closed. Once
  deployed, `theciege26` would be able to see and use the data-mode
  switcher and flip their own session to `live` — but `analytics`/
  `mission-control`'s `live.ts` would still hit the same `503
  INTELLIGENCE_UNAVAILABLE` / `notConfiguredError` path already proven
  throughout this engagement, and render the honest "not yet integrated"
  placeholder, not real data. Opening Gate B is a separate, deliberate
  decision this change does not make.
- **No additional `isLiveReady` flags were enabled.** Recommendations,
  Notifications, Activity, Search, League Health, and Manager
  Intelligence remain exactly where the staged rollout left them.

## Safe Next Action

This is code sitting in the working tree, verified by tests and
typecheck, not yet part of any commit. Recommend, in order, once you're
ready: (1) review this diff, (2) commit it (I have not committed
anything this turn, per not overstepping scope), (3) decide separately
whether/when to merge and deploy, and (4) only after that is live, decide
separately whether to also open Gate B for a real end-to-end verification
by `theciege26` — each a distinct, separately-approvable step.
