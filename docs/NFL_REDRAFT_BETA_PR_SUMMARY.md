# PR body — NFL Redraft free closed-beta core loop

> **OPENED as draft PR #166** (base `main`, head `nfl-redraft-beta`). This file is the source-of-truth
> PR description; keep it in sync with the live PR body.

**Title:** `NFL Redraft Beta — free closed-beta core loop (G30–G44 + trades/playoffs UI + P0 fix)`
**Base:** `main` · **Head:** `nfl-redraft-beta` (26 commits) · **Draft PR:** #166

## CI status (2026-07-08)

- ✅ **Required check `Draft Room Regression` = PASS** (this branch fixes the `main` TDZ crash).
- ✅ **`next build` + Vercel `allfantasy-v2-main` deploy = PASS** after fixing a branch build regression
  (the G30–G44 slice had missed transitive infra deps — restored beta-clean in commits `c4b1b3812` +
  `6d79abb63`: `f89240bbf` prod modules + `lib/events/*` event foundation + `leagueTabSync`).
- **Environment-only:** `Vercel – allfantasy-v2` "Account is blocked" (repo-wide).
- **Inherited/stale (not this branch):** `Playwright (onboarding-activation)` + the 7 redraft unit
  failures below (proven identical on the `main` baseline). None are required checks.

## Scope

Assembles the **NFL Redraft free closed-beta core loop** onto `main` as a curated, regression-free
slice (details: `docs/NFL_REDRAFT_BETA_SLICE_AUDIT.md`, `docs/NFL_REDRAFT_BETA_ASSEMBLY_LOG.md`).

- **The labeled `G30 → G44` series** — create flow → league home/shell → canonical league runtime →
  draft/draft-room → roster → schedule → live scoring → waiver → trade → **playoff** runtime →
  player-data pipeline → notifications → full-season → polish.
- **Trades UI** (`d78c6f96f`, = the #137 work) and **Playoffs UI** (`3c1600131`, = the #156 work)
  wired into the nflRedraftCore shell.
- **P0 fix** — `PlayerStatCard` no longer leaks a dev placeholder, raw ids, or fabricated projections.
- **Inherited-bug fix** — the `main` draft-room `draftRoomState` temporal-dead-zone crash
  (`DraftRoomPageClient`) is fixed (relocated one early use below its declaration; zero behavior change).
- **Free-beta cleanup** — the home dashboard's "Manager/Commissioner Intelligence / Decision OS" tiles
  are gated behind entitlement, so free-beta users see no parked-product naming.

**What this delivers:** all 10 nflRedraftCore tabs (home/draft/roster/matchups/waivers/trades/standings/
playoffs/chat/commissioner) render real components and are reachable; core routes are real (not stubs);
the core loop is **free-open** (no premium/entitlement gate).

## Verification (structural / local only)

- All touched/assembled surfaces **typecheck clean**.
- `PlayerStatCard` P0 guard test + `g32` home-dashboard test (incl. the free-user "no Intelligence
  surface" assertions) **pass**.
- Draft-room TDZ fixed and verified; all 10 tabs verified reachable.
- **Zero regressions — proven**: the failing redraft tests were run on a fresh `main` baseline worktree
  and produce the **identical** failures (see below).
- **No live DB was used.** No live end-to-end / browser / mobile QA has been run yet.

## Known inherited / stale test failures (NOT introduced by this PR)

Proven identical on a fresh `origin/main` baseline (same tests, same lines):

| Test | Class |
| --- | --- |
| `nfl-redraft-core-tab-bar` ×4 | **stale test** — asserts a `key === 'settings' && nflRedraftCore` string that is count-0 on `main` and `g15` (refactored away; test not updated) |
| `redraft-production-smoke-blockers` ×1 | **inherited main** — asserts the `draft/controls` route, which is byte-identical to `main` |
| `redraft/redraft-core-contract` ×2 | **stale + inherited** — target `ensureRedraftLeagueContract.ts` is inherited from `main`; the test file has uncommitted drift on `g15` |

These are `main`-wide issues; optional follow-ups (out of this PR's scope): the `g15` hardening of the
three `main`-owned files + refreshing the stale assertions.

## Boundary notes (for reviewers)

- **No parked product** — no Manager/Commissioner Intelligence hubs, Replay, or Trade Learning surfaces
  are present or reachable. No provider-migration (G45–G48) or premium/paywall (G49A–J, incl. the G49E
  gate) commits were picked. Free-beta core loop is ungated.
- **`lib/decision-os/runtime-event-derivation.ts` + `draft-runtime-intelligence.ts` are present** — these
  are **pure, deterministic infrastructure** (no I/O/AI/DB; types-only imports from `lib/league-runtime`)
  that the **G34 draft runtime depends on**. This is a *namespace collision* with the parked Decision OS,
  **not** the parked product. Recommended follow-up: rename them out of `lib/decision-os/` (~5-file blast
  radius) — deferred to keep this PR focused.
- **`lib/league-creation/canonical/premiumCreateSettingsGate.ts`** is an **option-gate, not a paywall** —
  standard free league creation is unblocked; it only 403s if a free user explicitly sets premium
  *advanced* create options.

## Not in scope / follow-ups

- **Live QA is pending** — do **not** invite real users until a live non-prod core-loop + mobile QA pass
  (runbook §3, `docs/NFL_REDRAFT_BETA_LANDING_AND_QA_RUNBOOK.md`) is green.
- Payments/Dues, Import/Sync, Team Settings, Advanced-Rules panels remain placeholders (hidden/deferred).
- AI surfaces (Chimmy, `redraft/ai/*`, war room) are a separate track.
