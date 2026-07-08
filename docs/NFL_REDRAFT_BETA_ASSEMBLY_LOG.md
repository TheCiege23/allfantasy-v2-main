# AllFantasy NFL Redraft — Beta Branch Assembly Log

**Beta Polish Phase 4 — curated assembly.** Records how the local-only `nfl-redraft-beta` branch was
built from fresh `main` per [`NFL_REDRAFT_BETA_SLICE_AUDIT.md`](./NFL_REDRAFT_BETA_SLICE_AUDIT.md).
**Local only — not pushed, no PR, no live DB.**

**Date:** 2026-07-08 · **Branch:** `nfl-redraft-beta` · **Base:** `origin/main` @ `b140e8cac` ·
**Worktree:** `C:/tmp/af-nfl-redraft-beta` (isolated; the primary `F:` checkout on `g15` was never
switched). **Result:** 19 commits, 190 files vs main.

---

## 1. What was assembled (19 commits)

The clean, labeled `G30→G44` core-beta series + the two later UI commits + the P0 fix + one inherited-bug fix, cherry-picked (`-x`, provenance preserved) in chronological order onto fresh `main`:

| # | Beta commit | Source | Meaning |
| --- | --- | --- | --- |
| 1 | `5ae9fdb4b` | `7fc574f45` | G30 simplify universal create league flow |
| 2 | `ce3b600f4` | `2790dc3ff` | G31 restore create-league video tiles |
| 3 | `c73c11c44` | `aed9b1977` | **G32 overhaul NFL redraft league home (shell keystone)** |
| 4 | `f22ae3c83` | `4863107b6` | G33 establish canonical league runtime |
| 5 | `53d20afe5` | `a9e397675` | G34 draft runtime + smart draft room |
| 6 | `2736c0014` | `76a8e423e` | G35 roster runtime |
| 7 | `316f5a602` | `b2734cf93` | G36 schedule engine |
| 8 | `42d341a0c` | `81ee9f20f` | G37 live scoring engine |
| 9 | `f7bd43d79` | `8faf32644` | G38 waiver runtime |
| 10 | `41ce98240` | `12f91d2fd` | G39 trade runtime integration |
| 11 | `437d8bb10` | `d7c1e75bb` | G40 playoff runtime (= PR #154) |
| 12 | `fe31f12fc` | `1a5ce6097` | G41 player-data pipeline |
| 13 | `8286e3bd4` | `2ad555ccc` | G42 notifications runtime |
| 14 | `d8d08a51b` | `970de5b2a` | G43 full-season runtime |
| 15 | `f95a7aed0` | `5b1e7ac4e` | G44 polish NFL redraft beta |
| 16 | `0e309380f` | `d78c6f96f` | trades UI wiring (= PR #137) |
| 17 | `851331cf6` | `3c1600131` | playoffs UI wiring (= PR #156) |
| 18 | `6b901cdec` | `0de7bc889` | PlayerStatCard P0 fix |
| 19 | `4afa41eee` | *(new, this phase)* | fix inherited draft-room `draftRoomState` TDZ crash |

## 2. Conflict resolutions

Every conflict was on a **core-beta file that `main` never diverged on** (verified per file via
`git log main-merge-base..origin/main -- <file>`), so each was resolved by taking the cherry-picked
commit's version (`--theirs`) — losing nothing from `main`, and later G-series commits layered on top:

| Commit | Conflicted file(s) | Resolution |
| --- | --- | --- |
| G37 | `lib/redraft/scoringEngine.ts`, `lib/redraft/playerWeeklyScoreService.ts` | `--theirs` (main-untouched) |
| G38 | `lib/redraft/waiverEngine.ts` | `--theirs` |
| G41 | `lib/player-data/adapters/redraftDisplayPlayers.ts`, `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` | `--theirs` |
| playoffs UI | `app/league/[leagueId]/LeagueShell.tsx` | `--theirs` — **verified afterward: no Decision OS/Replay refs leaked** |
| P0 fix | `docs/NFL_REDRAFT_LAUNCH_READINESS_AUDIT.md` (doc only) | `--theirs` |

G30–G36 and the trades UI applied with **no conflict**, including the G32 `LeagueShell` keystone.

## 3. Exclusions — verified clean

- **No off-limits commits on the branch** (guard: `git log main..HEAD | grep -iE 'decision.os demo|replay framework|trade learning|manager/commissioner intelligence|G4[5-9]|premium production|provider'` → none).
- **No parked Decision OS PRODUCT surfaces** — verified absent: no Manager/Commissioner hubs, no Replay (`ManagerReplayInsightsCard`/`replay-insights`), no Trade Learning, no `decision-os/world|manager-intelligence|commissioner`, no `sdk-runtime`.
- **The Replay home-dashboard card (`51e3ddb9d`) is absent** — `NflRedraftLeagueHomeDashboard.tsx` has no `ManagerReplayInsights` references (it sits at its G42 state).
- **G28 Decision OS, G45–G48 provider, G49A–J premium (incl. the G49E paywall) were not picked.**

## 4. ⚠ Boundary-judgment items (flagged for your decision)

Three items carry off-limits-adjacent *names* but are **core-runtime artifacts the G-series brought in**, not the parked workstreams. None surface a parked product; all are low-risk, but you should confirm:

1. **`lib/decision-os/runtime-event-derivation.ts` (374 L) + `lib/decision-os/draft-runtime-intelligence.ts` (262 L).** Deterministic derivation utilities **imported by `lib/draft-runtime/resolveNflRedraftDraftRuntime.ts` (G34)** — the beta draft runtime hard-depends on them; the build needs them. They do **not** import any parked `decision-os/*` module. This is a **namespace collision** with the parked Decision OS, not the parked product. *Option (future): move them out of the `lib/decision-os/` namespace to remove the confusion.*
2. **`lib/league-creation/canonical/premiumCreateSettingsGate.ts` (33 L, from G30).** An **option-gate, not a creation paywall**: `createLeagueHandler` only returns 403 **if** a free user explicitly sets premium *advanced* create options without the AF Commissioner entitlement (L150–169). **Standard free league creation is unblocked.** For the free beta: ensure the create UI doesn't surface those premium advanced options (or accept the gated 403). This is the core create flow, **not** the excluded G49 premium track.
3. **`docs/G33_CANONICAL_LEAGUE_RUNTIME_AND_DECISION_OS.md`** — a doc (harmless); named for the G33 runtime.

## 5. Inherited-bug fix (commit 19)

`components/app/draft-room/DraftRoomPageClient.tsx` (unchanged vs `main`) used `draftRoomState` at
~L527 before its `useMemo` declaration at ~L897 → a temporal-dead-zone render crash (the pre-existing
`main` "Draft Room Regression"). The draft room is core-loop, so the beta must not inherit it. Fix:
relocate the single early `startDraftBlocked` const to just after the `draftRoomState` declaration
(its only other uses are in JSX far below) — **zero behavior change**; the `useMemo` + its ~12 deps
are untouched. Verified: first use of `draftRoomState` is now its own declaration.

## 6. Verification results

| Check | Result |
| --- | --- |
| Assembly | 19 commits, 190 files, applied cleanly on fresh `main` |
| Exclude guard (commits) | ✅ no off-limits commits |
| Exclude guard (parked product surfaces) | ✅ none present |
| P0 PlayerStatCard | ✅ `nfl-redraft-player-stat-card-no-stub.test.ts` **passes** |
| **Core-tab reachability** (direct `LeagueShell` inspection) | ✅ all 10 render real components: home→`NflRedraftLeagueHomeDashboard`, draft→`DraftTab`, roster→`TeamTab`, matchups→`MatchupTabContainer`, waivers→`SportAwareWaiverWire`, trades→`TradesTab`, standings/playoffs→`RedraftStandingsPlayoffsView`, chat, commissioner (gated) |
| Draft-room TDZ | ✅ fixed + verified |
| Touched-file typecheck | ✅ **no errors** in `DraftRoomPageClient`, the 2 `decision-os` deps, `RedraftStandingsPlayoffsView`, `PlayerStatCard`, `LeagueShell` |
| Redraft test suites | 7 failures — **all pre-existing / inherited, zero slice regressions** (see §7) |

## 7. Known inherited failures (NOT caused by this assembly)

All 7 failing assertions target files that are **byte-identical to `main`** (not in the beta diff)
or are **stale test assertions** — they fail on `main` too:
- `nfl-redraft-core-tab-bar.test.ts` (4): assert the string `key === 'settings' && nflRedraftCore`, which has **count 0 on `main`, committed `g15`, and the `g15` working tree** (refactored away long ago; test not updated). Matches the documented "4 pre-existing failing redraft tests."
- `redraft-production-smoke-blockers.test.ts` (1): asserts the `draft/controls` route resume block — that route is **inherited from `main` unchanged** (same readiness-symbol count).
- `redraft/redraft-core-contract.test.ts` (2): target `ensureRedraftLeagueContract.ts` (**inherited from `main`**); the test file has **uncommitted drift on `g15`**, so the committed assertion is stale.

**Optional follow-ups** (not done — would expand the slice beyond G30–G44): the `g15` hardening of
three `main`-owned files (`draft/controls/route.ts`, `hooks/useCommissionerActions.ts`,
`lib/redraft-core-contract/ensureRedraftLeagueContract.ts`) is not in the beta slice; and the stale
test assertions above want a refresh. These are `main`-wide issues, not beta blockers.

## 8. Boundaries honored / what's NOT done

- **Local only** — branch not pushed, no PR opened, no live DB touched.
- No Decision OS / Replay / Trade Learning / Manager & Commissioner Intelligence / provider migration
  / G49 premium / AI / payments / Import features assembled.
- Primary `F:` checkout (on `g15`, dirty) was never switched — assembly was isolated in a worktree.
- **Next (Phase 5, needs approval):** run the human QA runbook (§3 of the Landing & QA Runbook) in an
  approved non-prod env; decide the two boundary items in §4; then a push/PR decision — each a
  separate, explicit go-ahead.

## 9. Phase 5 addendum — pre-push hardening audit (2026-07-08)

Full release-candidate assessment: **[`NFL_REDRAFT_BETA_GO_NO_GO.md`](./NFL_REDRAFT_BETA_GO_NO_GO.md)** →
verdict **GO WITH CONDITIONS**. Highlights:
- **Zero slice regressions — PROVEN.** Ran the 7 failing assertions on a fresh `origin/main` baseline
  worktree: **identical 7 failures** (same names + line numbers). All are inherited-main / stale-test.
- **Free-beta core loop is ungated** — draft/waiver/trades/playoffs/matchup/roster routes are all
  free-open; the only entitlement 403 is the create *advanced-options* gate (standard free creation
  unaffected). No G49E premium enforcement present.
- **Boundary:** the 2 `lib/decision-os/*` files are verified **pure infra** (no I/O/AI/DB; types-only
  imports; consumed by the G34 draft runtime) — namespace collision, not the parked product; recommend
  keep + optional follow-up rename. No parked hub/Replay/Trade-Learning surfaces reachable.
- **One flagged boundary-appearance item:** the home dashboard's locked "Manager/Commissioner
  Intelligence / Decision OS" **upsell teaser tiles** (non-navigable for free users) — recommend
  hiding/gating for the free beta (product decision; not auto-changed).
- Core routes are real (not stubs); all runtime libs present.

## 10. Phase 6 addendum — pre-push cleanup + PR readiness (2026-07-08)

Resolved the Phase 5 GO-WITH-CONDITIONS items; branch is now push/PR-ready (local only, still not pushed).
- **Rebased** `nfl-redraft-beta` onto current `origin/main` (`cef05c2af`) — clean, no conflicts (main's
  new commits were sleeper-import/docs, no redraft overlap). Branch `[behind 0]`.
- **Gated the home-dashboard Intelligence tiles** — the two G32 Intelligence sections now render only
  when entitled (`hasManagerIntelligence`/`hasCommissionerIntelligence`); free-beta users see neither,
  so no "Manager/Commissioner Intelligence", "Decision OS", "AF Pro/Commissioner preview", or "Ask
  Chimmy" naming appears. Deleted the now-dead "Locked … preview" header strings. Updated the two
  free-user `g32` test assertions to require the sections be **absent** (8/8 pass). No feature removed;
  entitled path preserved.
- **Re-verified** on the rebased+cleaned branch: `g32` (8/8) + PlayerStatCard (pass); the **same 7
  inherited/stale failures**, zero new; draft-room TDZ still fixed (use = decl); all 10 core tabs still
  render real components; touched-file typecheck clean; boundary guards clean (no off-limits commits;
  only the 2 `lib/decision-os` infra deps + the `premiumCreateSettingsGate` option-gate remain, both
  documented).
- **Prepared** (not opened) the PR description: `NFL_REDRAFT_BETA_PR_SUMMARY.md`.
