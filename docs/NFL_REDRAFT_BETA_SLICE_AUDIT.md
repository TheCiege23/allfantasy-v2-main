# AllFantasy NFL Redraft — Beta Slice Audit + Assembly Plan

**Beta Polish Phase 3 — audit/planning only.** Identifies the smallest safe NFL Redraft beta slice
that can be assembled onto a focused branch **without dragging in parked/off-limits work**, forecasts
the assembly conflicts, and recommends a strategy. **Nothing is assembled, no branch is created/
pushed, no PR opened/updated, no live DB touched, no product code changed.** Companion to
[`NFL_REDRAFT_LAUNCH_READINESS_AUDIT.md`](./NFL_REDRAFT_LAUNCH_READINESS_AUDIT.md) and
[`NFL_REDRAFT_BETA_LANDING_AND_QA_RUNBOOK.md`](./NFL_REDRAFT_BETA_LANDING_AND_QA_RUNBOOK.md).

**Date:** 2026-07-08 · **Audited from:** local `g15-event-foundation` @ `0de7bc889` · **Base:**
merge-base(local g15, `origin/main`) = `35fb8ff4e`; local g15 = **251 commits** ahead of it.

---

## 1. Executive summary

- **Good news: the beta is a clean, sequential, _labeled_ series, not an entangled shell.** The NFL
  Redraft core loop was built as **G30 → G44** (create flow → league home/shell → canonical league
  runtime → draft → roster → schedule → scoring → waiver → trade → playoff → player-data →
  notifications → full-season → polish). All 15 have beta-clean subjects and no Decision-OS/Replay
  content.
- **Of the 251 g15-only commits, ~169 are parked/off-limits** (Decision OS, Replay, Trade Learning,
  Manager/Commissioner Intelligence, widget/SDK, the G15–G28 event/decision series) and **must be
  excluded**.
- **The open PRs are a partial subset and are NOT sufficient alone.** #154 (=G40 playoff runtime),
  #156 (playoffs UI), #137 (trades UI) do **not** include **G32 (`aed9b1977`)**, the shell keystone
  that creates the nflRedraftCore tab structure #156 wires playoffs into — so even #154+#156 merged
  to `main` would leave playoffs **unreachable**. G32 is in **no PR**.
- **Two off-limits tracks masquerade as "G-series" and must be excluded:** **G45–G48** (provider
  integration/migration) and **G49A–J** (premium service). ⚠ **G49E `091b8db8f` "enforce NFL redraft
  premium production access" is a paywall gate — including it would block/charge free-beta users.**
- **Recommended strategy: cherry-pick the labeled G30–G44 series + the 3 later UI/fix commits onto a
  focused `nfl-redraft-beta` branch off `main`, skipping every excluded commit, with hunk-level
  resolution at the two contaminated shared files (LeagueShell ← G28 Decision-OS; HomeDashboard ←
  Replay card) and a file-transplant for the PlayerStatCard rewrite.** This refines Phase 2's "Option
  B / C-feeds-B": because the beta is a clean labeled series and the shell keystone is PR-less, a
  direct curated cherry-pick is cleaner than routing everything through the PR stack (the PRs stay
  useful as review references).

---

## 2. Required beta slice (surface → files → status)

Legend — **main:** on `origin/main` already · **PR:** covered by an open PR · **local:** local-g15 only.

| Surface | Key file(s) | Status | Source commit(s) | Notes |
| --- | --- | --- | --- | --- |
| Core-league detection | `lib/league/is-nfl-redraft-core-dashboard.ts` | **main (unchanged)** | — | already on main; no port |
| Tab-id set | `app/league/[leagueId]/LeagueTabs.tsx` (`NFL_REDRAFT_CORE_TAB_IDS`) | main + **local diff** | G32 `aed9b1977` (+18/-14) | constant added by G32 |
| **Shell wiring (keystone)** | `app/league/[leagueId]/LeagueShell.tsx` | main + **local diff (+168/-65, 5 commits)** | G32 `aed9b1977`, playoffs `3c1600131`, flicker `c6be83352`; ⚠ also G28 `925110077` (Decision OS) + repo-wide TS `50d2ae5f9` | **hunk-resolve** — include G32+playoffs, exclude G28/TS-sweep |
| League home | `components/league-home/NflRedraftLeagueHomeDashboard.tsx` | **local-only (+464)** | G32 `aed9b1977` (creates), G42 `2ad555ccc`, `f69d2112c`; ⚠ Replay `51e3ddb9d` (+230/-67) | **hunk-resolve** — exclude the Replay card |
| Home entry (`LeagueTab`) | `app/league/[leagueId]/tabs/LeagueTab.tsx` | main + **local diff (all Decision OS)** | 5 Decision-OS commits | **EXCLUDE local diff — use main's version** (nflRedraftCore home = `NflRedraftLeagueHomeDashboard`, not this) |
| Draft | `app/league/[leagueId]/tabs/DraftTab.tsx` + `lib/draft-runtime`, draft room | main + local (+11/-11) | G34 `a9e397675`, `f69d2112c`, ⚠ G49E `091b8db8f` | exclude the G49E premium-gate hunk |
| Roster | `app/league/[leagueId]/tabs/TeamTab.tsx` + `lib/player-data/*` | main + **local diff (+90)** | G41 `1a5ce6097` | depends on G41 data pipeline (large, additive) |
| Matchups | `components/matchup-center/MatchupTabContainer.tsx` | **main (unchanged)** | — | no port (data comes from G41) |
| Waivers | `components/waiver-wire/SportAwareWaiverWire.tsx` | **main (unchanged)** | G38 runtime `8faf32644` (lib side) | component unchanged; waiver runtime = G38 |
| Trades | `app/league/[leagueId]/tabs/TradesTab.tsx`, `ProposeTradeModal.tsx` | **PR #137** + G39 runtime | G39 `12f91d2fd` (runtime) + `d78c6f96f` (UI = #137) | runtime **and** UI both needed |
| Standings/Playoffs | `.../tabs/redraft/RedraftStandingsPlayoffsView.tsx`, `StandingsView.tsx` | **PR #154+#156** | G40 `d7c1e75bb` (=#154), `3c1600131` (=#156) | reachability depends on G32 shell |
| Commissioner settings | `app/league/[leagueId]/components/CommissionerSettingsModal.tsx` | **main (unchanged)** | — | core panels already on main |
| Player card (P0) | `app/league/[leagueId]/components/PlayerStatCard.tsx` | main + **local rewrite** | `0de7bc889` | **file-transplant** (rewrite; won't cherry-pick clean) |
| League runtime foundation | `lib/league-runtime/*` (`leagueRuntimeEvents.ts` etc.) | **local** | G33 `4863107b6` | dependency of G40 playoff runtime + G41 |
| Season/schedule/scoring runtimes | `lib/*runtime*`, `/api/redraft/*` | **local** | G35/G36/G37/G43 | core-loop runtimes |

---

## 3. Commit / file dependency graph

### Group A — already in open PRs (review-credit subset)
| PR | Commit | Content | State |
| --- | --- | --- | --- |
| **#154** | `d7c1e75bb` (G40) | playoff runtime: `lib/playoff-runtime/*`, `/api/redraft/playoff-runtime`, playoffs routes, StandingsView runtime, `lib/league-runtime/leagueRuntimeEvents` | OPEN, MERGEABLE but **BEHIND** main |
| **#156** | `3c1600131` | playoffs UI: LeagueShell(+53), `RedraftStandingsPlayoffsView` (new), StandingsView UI, `lib/redraft/client` | OPEN, stacked on #154, **UNSTABLE** (checks) |
| **#137** | `d78c6f96f` | trades UI: `TradesTab`, `ProposeTradeModal` (new), trades-panel + rosters routes, `types` | OPEN, base main, **not currently mergeable** |

> These 3 commits are also members of the local series below — Group A is the *already-reviewed*
> subset, not a separate set.

### Group B — local-only, beta-critical, **no PR** (must assemble)
- **The G30–G44 core series (15 commits), chronological:**
  `7fc574f45` G30 create-flow · `2790dc3ff` G31 create video tiles · **`aed9b1977` G32 home/shell
  (KEYSTONE)** · **`4863107b6` G33 canonical league runtime** · `a9e397675` G34 draft runtime/room ·
  `76a8e423e` G35 roster runtime · `b2734cf93` G36 schedule engine · `81ee9f20f` G37 live scoring ·
  `8faf32644` G38 waiver runtime · `12f91d2fd` G39 trade runtime · `d7c1e75bb` G40 playoff runtime
  (=#154) · `1a5ce6097` G41 player-data pipeline · `2ad555ccc` G42 notifications · `970de5b2a` G43
  full-season runtime · `5b1e7ac4e` G44 polish.
- **Later UI/fix commits:** `d78c6f96f` trades UI (=#137) · `3c1600131` playoffs UI (=#156) ·
  **`0de7bc889` PlayerStatCard P0 fix** (file-transplant).

### Group C — local-only, optional / defer
- `2790dc3ff` G31 create-league video tiles (polish) · `c6be83352` draft/league tab-flicker fix ·
  `2ad555ccc` G42 notifications (include if clean; not core-loop-blocking) · selected hunks of the
  repo-wide TS sweep `50d2ae5f9` **only** if a ported file fails typecheck without them.

### Group D — MUST EXCLUDE
- **G28 `925110077`** "prove authenticated Decision OS league surfaces" — Decision OS (ancestor of
  G32; hunk-exclude its LeagueShell/LeagueShellClient lines + the `decision-os-proof-league` route).
- **Provider track (`provider migration`, off-limits):** `77ff03693` G45, `9715b3ed1`/`a775b108a`/
  `8ebc1d77c` G46A-C, `f0255c5d5`/`a5babb2d6` G47A-B, `069f2b081` G48.
- **Premium track (`payments`-adjacent, off-limits):** `0841fc011` G49A … `2bc522db6` G49J — incl.
  ⚠ **`091b8db8f` G49E "enforce premium production access"** (paywall; excluding it keeps the beta free).
- **`51e3ddb9d` Replay Framework Phase 20** (Manager Replay Insights card) — Replay; hunk-exclude
  from `NflRedraftLeagueHomeDashboard`.
- **All Decision OS (~27), Replay (~21), Trade Learning (~10), Manager Intelligence (~6),
  Commissioner Intelligence (~10), widget/SDK** commits — the ~169 parked total.
- The `LeagueTab.tsx` Decision-OS diff (`1beaa47d6`, `5af53c2e7`, `c676a32b6`, `134210b63`,
  `eec572855`) — use `main`'s `LeagueTab.tsx`.

---

## 4. Conflict forecast (assembly zones)

| Zone / file | Why it conflicts | Touched by (include / **exclude**) | Resolution strategy | Tests to cover |
| --- | --- | --- | --- | --- |
| **`LeagueShell.tsx`** (highest) | 5 interleaved g15 commits; an **excluded** Decision-OS commit (G28) is an *ancestor* of the included G32, plus a repo-wide TS sweep | G32 `aed9b1977`, playoffs `3c1600131`, flicker `c6be83352` / **G28 `925110077`, TS `50d2ae5f9`** | cherry-pick G32 then playoffs; on conflict keep the nflRedraftCore wiring, **drop any Decision-OS references**; take TS-sweep hunks only if typecheck needs them | `nfl-redraft-core-tab-bar`, `standings-playoffs-ui-wiring`, `redraft-production-smoke-blockers` |
| **`NflRedraftLeagueHomeDashboard.tsx`** (high) | Created by G32, later **modified by the excluded Replay card** (+230/-67); a wanted QA commit may sit atop it | G32 `aed9b1977`, G42 `2ad555ccc`, `f69d2112c` / **Replay `51e3ddb9d`** | assemble G32 version (+G42/QA); **strip the Replay-card hunks/imports** (`ManagerReplayInsightsCard`, `replay-insights` route) | `g32-nfl-redraft-home-dashboard` |
| **`StandingsView.tsx`** (med) | 2 large beta commits stack | G40 `d7c1e75bb` (#154), `3c1600131` (#156) | apply in order G40 → playoffs; clean if sequenced | `standings-playoffs-ui-wiring`, `g40-nfl-redraft-playoff-runtime` |
| **`TradesTab.tsx`** (med) | #137 is **not currently mergeable** vs main | G39 `12f91d2fd` (runtime) + `d78c6f96f` (UI) | rebase/resolve #137 onto the branch; runtime (G39) must precede UI | `trades-tab-native-builder-wiring`, `trades-panel-native-route` |
| **`PlayerStatCard.tsx`** (low) | full rewrite; main holds the old placeholder version | `0de7bc889` | **file-transplant** (`git checkout 0de7bc889 -- <file> <test>`), not cherry-pick | `nfl-redraft-player-stat-card-no-stub` |
| **`lib/redraft/client.ts`** (low-med) | appended by 3 beta commits | `3c1600131`, `d7c1e75bb`, `1a5ce6097` | additive; cherry-pick in chronological order | redraft client-helper tests |
| **`lib/player-data/*`, `lib/*runtime*`** (low, large) | mostly **new** files (G33/G35/G41) | G33/G35/G41 | additive; low conflict but big surface — build-verify | g33/g35/g41 suites |
| **`DraftTab.tsx`** (low) | small diff, but one hunk is the **excluded** G49E premium gate | G34 `a9e397675`, `f69d2112c` / **G49E `091b8db8f`** | include G34/QA hunks; **drop the premium-access enforcement** | draft-room smoke suites |

---

### ⚠ Baseline risk — `main` carries pre-existing failures a beta branch would inherit

Fresh CI evidence (from PR #154, 2026-07-08) shows **`origin/main` itself has failing required
checks unrelated to redraft**, so a beta branch cut from `main` inherits them unless a G-series
commit supersedes the file:
- **Draft Room Regression** — `ReferenceError: Cannot access 'draftRoomState' before initialization`
  in `components/app/draft-room/DraftRoomPageClient.tsx` (used ~L527, declared ~L897 → temporal
  dead-zone render crash; on `main`, file last touched 2026-06-24). **The draft room is core-loop —
  if the G-series (esp. G34 `a9e397675` draft runtime/room) doesn't already rewrite/fix this file,
  it is a beta P0.** The build+QA step (B1) must confirm the draft room actually renders.
- **Playwright (onboarding-activation)** — missing `onboarding-step-welcome` / `onboarding-checklist`
  testids (welcome UI not rendering).

Two implications: (1) it is **another reason to prefer the curated cherry-pick over the PR-first
path** — #154's required E2E gate cannot go green by rebase/rerun while `main` holds these bugs
(merging is an owner decision: fix on `main` first via separate PRs, or admin-override); (2) the
assembly must **diff the beta branch's `DraftRoomPageClient.tsx` against the fix** and, if `main`'s
buggy version survives, either cherry-pick the g15 fix for it or apply a targeted TDZ fix (hoist the
`draftRoomState` `useMemo` above its first use) — tracked as a beta-blocker, not silently inherited.

## 5. Recommended assembly strategy

**Hybrid, primary = Strategy 1 (curated cherry-pick of the labeled series), with Strategy 2 surgery
at the two contaminated files.** Rationale: the beta is a clean sequential G-series, so replaying it
onto `main` is cleaner than resolving three stacked PRs whose union still misses the G32 keystone.
Strategy 3 (land #154/#156/#137 first) is **optional** — their commits are already in the series;
keep the PRs as review references or close them as superseded once the beta branch is reviewed.

**Sequence (chronological, skipping every Group-D commit):**
1. Branch `nfl-redraft-beta` off `origin/main`.
2. Cherry-pick **G30 → G44** in order (`7fc574f45 … 5b1e7ac4e`), **skipping G28/G45–G49 and all
   parked commits**. Resolve `LeagueShell` (drop G28/Decision-OS lines) and `NflRedraftLeagueHomeDashboard`
   (drop the Replay card) as they arrive.
3. Cherry-pick the later UI commits **`d78c6f96f` (trades) → `3c1600131` (playoffs)**.
4. **Transplant** the P0 fix file(s) from `0de7bc889`.
5. Guard the exclude-list, then **build + typecheck + run the redraft test suites**. Build/typecheck
   is the completeness arbiter (it will surface any missing transitive dependency).

> Whether to include **G42 notifications** and **G46/G47 richer player data** is a beta-scope call:
> default **exclude G45–G49** (provider/premium) and run the free beta on the **G41** pipeline with
> honest fallbacks where live provider data is absent (consistent with the P0 fix philosophy).

---

## 6. Exact next commands — **run ONLY after explicit approval** (not executed here)

```bash
git fetch origin
git switch -c nfl-redraft-beta origin/main

# G30–G44 core series, in order (resolve LeagueShell = drop G28/Decision-OS,
# HomeDashboard = drop Replay card; DraftTab = drop G49E premium gate if it appears)
for c in 7fc574f45 2790dc3ff aed9b1977 4863107b6 a9e397675 76a8e423e b2734cf93 \
         81ee9f20f 8faf32644 12f91d2fd d7c1e75bb 1a5ce6097 2ad555ccc 970de5b2a 5b1e7ac4e; do
  git cherry-pick "$c" || { echo "resolve conflicts in $c, then: git cherry-pick --continue"; break; }
done

# later UI wiring
git cherry-pick d78c6f96f   # trades UI (#137)
git cherry-pick 3c1600131   # playoffs UI (#156)

# P0 fix — transplant (rewrite won't cherry-pick clean)
git checkout 0de7bc889 -- \
  "app/league/[leagueId]/components/PlayerStatCard.tsx" \
  "__tests__/nfl-redraft-player-stat-card-no-stub.test.ts"
git commit -m "NFL redraft beta: PlayerStatCard P0 fix (transplant 0de7bc889)"

# EXCLUDE guard — must print nothing
git log --oneline origin/main..HEAD | grep -iE "decision.os|replay|trade learning|manager dna|G4[5-9]|premium production access" \
  && echo "!! off-limits commit leaked — STOP and remove" || echo "exclude-list clean"

# completeness arbiter
npm run build && npx vitest run __tests__/nfl-redraft-* __tests__/redraft/ __tests__/redraft-*
```
Caveats: order matters; expect manual resolution at `LeagueShell.tsx` and
`NflRedraftLeagueHomeDashboard.tsx`; do **not** push or open a PR without a separate approval; do
**not** connect to a live DB.

---

## 7. Do-not-touch boundaries (this phase + carried forward)

- **Decision OS, Replay, Manager & Commissioner Intelligence, Trade Learning remain parked** — never
  cherry-pick their commits into the beta branch (the exclude guard above enforces this).
- **Provider migration (G45–G48) and premium/payments (G49A–J incl. the G49E paywall) are excluded**
  from the free-beta slice.
- **No AI/Chimmy, draft-assistant, waiver/start-sit AI, payments, or Import/Sync features** built.
- **This phase assembled nothing** — no branch created/pushed, no PR opened/updated, no live DB, no
  product code changed. Assembly happens only after explicit approval (Phase 4).
