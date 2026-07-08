# AllFantasy NFL Redraft — Beta Go / No-Go (Pre-Push Hardening Audit)

**Beta Polish Phase 5 — release-candidate assessment of the local `nfl-redraft-beta` branch.**
Answers: *should we push this branch and open the first NFL Redraft beta PR?* No push, no PR, no live
DB were done here. Companions: [assembly log](./NFL_REDRAFT_BETA_ASSEMBLY_LOG.md),
[slice audit](./NFL_REDRAFT_BETA_SLICE_AUDIT.md), [landing & QA runbook](./NFL_REDRAFT_BETA_LANDING_AND_QA_RUNBOOK.md).

**Date:** 2026-07-08 · **Branch:** `nfl-redraft-beta` @ `21b3ed8f5` (20 commits) · **Base:** `origin/main`
(rebased onto `origin/main` `cef05c2af` in Phase 6; branch is `[behind 0]`).

## ⭐ Final recommendation: **GO (push/PR-ready) — live QA gates user invites**

The slice is a **clean, regression-free addition on top of `main`**: the free-beta core loop is fully
wired, reachable, real (not stubbed), and ungated; the parked Decision OS / Replay / Trade-Learning
product is **not reachable**; and **every** test failure is proven **inherited from `main`** (zero
regressions). **As of Phase 6 the two pre-push conditions (teaser-tile naming, rebase) are RESOLVED**,
so the branch is **push/PR-ready as a release candidate now** — pending only the reviewer-facing PR
notes below. It is **not yet "invite real users" ready** — a live non-prod core-loop + mobile QA pass
(runbook §3) has not run; open the PR for review, but hold user invites until that pass is GREEN.

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

## Must Fix Before Push — ✅ RESOLVED in Phase 6

Both pre-push conditions from the Phase 5 assessment are **done** (2026-07-08):

1. ✅ **Home-dashboard "Intelligence / Decision OS" teaser tiles — GATED.** The two G32 Intelligence
   sections (`g32-manager-intelligence-section`, `g32-commissioner-intelligence-section`) now render
   **only when the user is entitled** (`hasManagerIntelligence` / `hasCommissionerIntelligence`).
   Free-beta users (no entitlement) see **neither** section → no "Manager/Commissioner Intelligence"
   or "Decision OS" naming, no "AF Pro/Commissioner preview", no "Ask Chimmy" tile. The now-dead
   "Locked … preview" header strings were deleted. Entitled users (none in the free beta) still get
   the sections, so the future-product surface is preserved, not removed. The two free-user
   assertions in `g32-nfl-redraft-home-dashboard.test.tsx` were updated to require the sections be
   **absent**; **8/8 pass**. (commits: gate + header cleanup)
2. ✅ **Rebased onto current `origin/main`** (`cef05c2af`) — clean, no conflicts; branch is now
   `[ahead N, behind 0]`.

**No functional blockers remain.**

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
| Intelligence/Decision-OS **naming** in UI | ✅ gated (Phase 6) — free users see no Intelligence/Decision-OS tiles | `g32-*-intelligence-section` render only when entitled; `g32` test asserts absence for free users |
| Premium gating scope | ✅ only premium **advanced create options** (free create/draft/play unaffected) | `createLeagueHandler` 403 only when free user sets premium keys |
| Off-limits **commits** on the branch | ✅ none | commit-subject guard clean |

## The push decision, concretely

**GO — push/PR-ready (release candidate).** The Phase 5 pre-push conditions are handled in Phase 6:
✅ (1) the home-dashboard Intelligence/Decision-OS teaser tiles are **gated** (free users see none);
✅ (2) the branch is **rebased** onto current `origin/main`. Remaining before opening the PR: (3) use
the prepared PR description (`NFL_REDRAFT_BETA_PR_SUMMARY.md`), which states the 7 inherited/stale
failures + the 2 `lib/decision-os` infra files + "structural verification only; no live DB." **Open
the PR for review, but do not invite real users** until a live non-prod core-loop + mobile QA pass
(runbook §3) is GREEN. **NO GO** would require a core-loop blocker — none exists.

## CI triage (draft PR #166 — pushed 2026-07-08)

The branch was pushed and **draft PR #166** opened. CI classified:

| Check | Result | Class |
| --- | --- | --- |
| **Draft Room Regression** (only *required* check) | ✅ **PASS** | branch **fixes** the `main` TDZ failure |
| `Landing Perf Budget` / `next build` | ✅ PASS (after fix) | first failed = **branch build regression → FIXED** (missing modules) |
| `Vercel – allfantasy-v2-main` deploy | ✅ PASS (after fix) | was the same build error → cleared |
| Platform Backend Deploy Readiness, DB-First API Boundary | ✅ PASS | — |
| `Vercel – allfantasy-v2` ("Account is blocked") | ❌ fail | **environment-only** (repo-wide; identical on #156) |
| `Playwright (onboarding-activation)` | ❌ fail | **inherited-main** (fails on #137/#131; branch touches no onboarding files) |
| 7 redraft unit failures (`core-tab-bar`×4, `smoke-blockers`×1, `core-contract`×2) | ❌ fail | **inherited/stale** (proven identical on the `main` baseline) |
| `Playwright (referral-growth-db)`, `retention-engagement`, EN/ES parity | ✅ PASS | — |
| `Playwright (core 1–3/3)` | ❌ fail/stall | **inherited-main** — `relation "league_create_options_catalog" does not exist` (create-league code is on `main`; red on #137/#131; ~48-min DB-error timeout loop). Not required; tracked as a separate main CI-health item |

**Branch-caused regressions (found + fixed — 2):**
1. **Build:** the G30–G44 cherry-pick missed transitive infra deps (`f89240bbf` prod modules +
   `lib/events/*` event foundation + `leagueTabSync`) → `next build` failed with `Module not found`.
   Fixed by transplanting the **beta-clean** infra (`c4b1b3812`, `6d79abb63`); build + Vercel deploy green.
2. **e2e:** the Phase-6 tile-gating updated the unit test but missed `e2e/g32-nfl-redraft-league-home.spec.ts`
   (free-manager case still asserted the hidden "Locked Manager Intelligence preview"). Fixed to assert the
   section is absent for free users.

Everything else is environment-only or inherited/stale, and none of those are required checks.

**Net:** the sole required check passes, the branch builds + deploys, and there are **no untriaged or
branch-caused blockers**. PR stays **draft** — live non-prod core-loop + mobile QA (runbook §3) still
gates ready-for-review / user invites. **Awaiting explicit approval to mark ready or merge.**
