# AllFantasy NFL Redraft — Beta Go / No-Go (Pre-Push Hardening Audit)

**Beta Polish Phase 5 — release-candidate assessment of the local `nfl-redraft-beta` branch.**
Answers: *should we push this branch and open the first NFL Redraft beta PR?* No push, no PR, no live
DB were done here. Companions: [assembly log](./NFL_REDRAFT_BETA_ASSEMBLY_LOG.md),
[slice audit](./NFL_REDRAFT_BETA_SLICE_AUDIT.md), [landing & QA runbook](./NFL_REDRAFT_BETA_LANDING_AND_QA_RUNBOOK.md).

**Date:** 2026-07-08 · **Branch:** `nfl-redraft-beta` @ `21b3ed8f5` (20 commits) · **Base:** `origin/main`
(branched at `b140e8cac`; main is now a few commits ahead → trivial rebase before push).

## ⭐ Final recommendation: **GO WITH CONDITIONS**

The slice is a **clean, regression-free addition on top of `main`**: the free-beta core loop is fully
wired, reachable, real (not stubbed), and ungated; the parked Decision OS / Replay / Trade-Learning
product is **not reachable**; and **every** test failure is proven **inherited from `main`** (zero
regressions). It is **push/PR-ready as a release candidate** once the conditions below are handled.
It is **not yet "invite real users" ready** — a live non-prod core-loop + mobile QA pass (runbook §3)
has not run.

---

## Ready Now

- **Core league loop — wired, reachable, real, free-open:**
  - All 10 nflRedraftCore tabs render real components (direct `LeagueShell` inspection): home
    (`NflRedraftLeagueHomeDashboard`), draft (`DraftTab`), roster (`TeamTab`), matchups
    (`MatchupTabContainer`), waivers (`SportAwareWaiverWire`), trades (`TradesTab`), standings/playoffs
    (`RedraftStandingsPlayoffsView`), league chat, commissioner (gated).
  - All spot-checked core routes are **real, not stubs** (79–168 L; no NotImplemented/coming-soon/501):
    `redraft/playoffs/generate`, `redraft/playoff-runtime`, `redraft/waiver-process`,
    `league/trades-panel`, `redraft/matchup`. Runtime libs present (`lib/playoff-runtime`,
    `lib/league-runtime`, `lib/draft-runtime`, `redraft/waiverEngine`, `redraft/scoringEngine`).
  - **No premium/entitlement gate blocks the core loop** — draft/waiver/trades/playoffs/matchup/roster
    routes are all free-open; no G49E "premium production access" enforcement leaked in.
- **P0 fixed** — `PlayerStatCard` no dev-stub/raw-ids/fake projections (`nfl-redraft-player-stat-card-no-stub.test.ts` passes).
- **Inherited draft-room TDZ crash fixed** — `DraftRoomPageClient` `draftRoomState` now declared before use.
- **Typecheck clean** on all touched/assembled beta surfaces.
- **Zero slice regressions** — see Known Main Inheritance.

## Must Fix Before Push

**None are functional blockers.** The core loop works, is free, and is regression-free. The two
items below are **boundary-appearance decisions** (recommendations given) — resolve or consciously
defer-with-a-note-in-the-PR before pushing, because they shape the PR's "no Decision OS" story:

1. **Home-dashboard "Intelligence / Decision OS" upsell teaser tiles.** `NflRedraftLeagueHomeDashboard`
   renders locked tiles named **"Manager Intelligence", "Personal Decision OS panel", "Ask Chimmy",
   "League Intelligence", "Weekly League Report"** (from G32). For a **free** user they are `locked:
   true` with **`onClick: undefined`** — they render the *parked product's names* as upsell previews
   but **do not render or navigate to it** (the parked hubs are absent). Not a functional violation,
   but they surface exactly the naming the beta boundary excludes, and a locked card that goes nowhere
   can read as "shown broken." **Recommendation:** hide/gate these tiles for the free closed beta
   (keep the core tiles: roster, rules, chat, draft). This is a **product call** — flagged, not
   auto-changed, per the "fix only true violations" rule.
2. **Rebase onto current `origin/main`** (branch is a few commits behind) so the PR diff is clean.

## Safe Deferrals

- **The two `lib/decision-os/*` infra files** (`runtime-event-derivation.ts` 374 L,
  `draft-runtime-intelligence.ts` 262 L). Verified **pure, deterministic infrastructure**: import only
  *types* from `lib/league-runtime/*`, **no fetch/prisma/AI/HTTP/env** I/O, exported as pure derivation
  functions; consumed by `lib/draft-runtime/resolveNflRedraftDraftRuntime.ts` (G34) + 2 tests. This is a
  **namespace collision** with the parked Decision OS, **not** the parked product. **Recommendation:
  keep for the beta** (the build depends on them); **optional follow-up — rename out of `lib/decision-os/`
  → `lib/league-runtime/`** (blast radius = 5 files) to remove reviewer confusion. Not a push blocker.
- **The 3 pre-existing/stale test failures** (see below) — main-wide, not beta-specific. Optionally
  refresh the stale assertions in a separate main-facing change; safe to ship with them noted.
- **Payments / Import-Sync / Team-Settings / Advanced-Rules panels** — placeholder, correctly deferred;
  keep hidden or clearly-unavailable for the free beta (per the runbook's free-beta rule).
- **AI surfaces (Chimmy, `redraft/ai/*`, war room)** — separate track, not depth-audited; the "Ask
  Chimmy" home tile is a teaser (no functional wiring asserted) — tie off with item 1 above.

## Known Main Inheritance (NOT caused by this slice — proven)

Ran the 3 failing suites on a fresh `origin/main` baseline worktree: **identical 7 failures**
(same test names + line numbers). Classification:

| Failing test | Class | Evidence |
| --- | --- | --- |
| `nfl-redraft-core-tab-bar` ×4 (L39/74/108/119) | **stale test** | asserts the string `key === 'settings' && nflRedraftCore`, which has **count 0 on `main`, committed `g15`, and the `g15` working tree** (refactored away; test not updated) |
| `redraft-production-smoke-blockers` ×1 (L89) | **inherited main** | asserts the `draft/controls` route resume block; that route is **byte-identical to `main`** (not in the beta diff) |
| `redraft/redraft-core-contract` ×2 (L41/66) | **stale test + inherited main** | targets `ensureRedraftLeagueContract.ts` (**inherited from `main`**); the test file has **uncommitted drift on `g15`** → committed assertion is stale |
| — any **beta regression** | **NONE** | main baseline shows the same 7; beta introduces 0 new failures |

Also inherited but **fixed on this branch:** the draft-room `draftRoomState` TDZ crash.

**Optional main-facing follow-ups (out of the beta slice):** the `g15` hardening of three `main`-owned
files (`draft/controls/route.ts`, `hooks/useCommissionerActions.ts`,
`lib/redraft-core-contract/ensureRedraftLeagueContract.ts`) + refreshing the stale tab-bar/contract
assertions.

## Boundary Verification

| Boundary | Status | Evidence |
| --- | --- | --- |
| Decision OS **product** (Manager/Commissioner hubs) | ✅ not present / not reachable | no `manager-hub`/`intelligence` league route; no parked hub components imported |
| Replay Framework | ✅ absent | no `ManagerReplayInsightsCard`/`replay-insights` in the home dashboard or anywhere; `51e3ddb9d` not picked |
| Trade Learning | ✅ absent | no trade-learning files/commits |
| Provider migration (G45–G48) | ✅ excluded | not cherry-picked |
| Premium service / paywall (G49A–J, incl. G49E) | ✅ excluded | not cherry-picked; no premium enforcement in core-loop routes |
| `lib/decision-os/*` files | ⚠ 2 present = **pure infra** (namespace collision, not product) | see Safe Deferrals |
| Intelligence/Decision-OS **naming** in UI | ⚠ locked upsell teaser tiles on home dashboard | see Must Fix #1 |
| Premium gating scope | ✅ only premium **advanced create options** (free create/draft/play unaffected) | `createLeagueHandler` 403 only when free user sets premium keys |
| Off-limits **commits** on the branch | ✅ none | commit-subject guard clean |

## The push decision, concretely

**GO WITH CONDITIONS** — push + open the beta PR once: (1) the home-dashboard Intelligence teaser
tiles are hidden/gated **or** explicitly deferred-with-a-note in the PR; (2) the branch is rebased onto
current `origin/main`; (3) the PR description states the 7 inherited/stale failures + the 2 infra files
+ "structural verification only; live core-loop + mobile QA (runbook §3) pending before inviting real
users." **Do not invite real users** until that live QA pass is GREEN. **NO GO** would require a
core-loop blocker — none exists.
