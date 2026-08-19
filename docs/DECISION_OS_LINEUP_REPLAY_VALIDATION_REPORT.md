# Decision OS Replay Framework Phases 13–14 — Lineup Replay: Implementation, First Validation, and 5-League Corpus Expansion

**Status:** Working implementation (Phase 13) + real cross-league corpus expansion (Phase 14, §8 onward). No trade-engine, Trade Learning, calibration, or recommendation-engine code touched at any point. No code changes in Phase 14 — pure corpus expansion + reporting, using the exact ingestion/metrics code Phase 13 already built and verified.
**Branch:** `g15-event-foundation`
**Builds on:** `docs/DECISION_OS_REPLAY_LINEUP_SCENARIO_SELECTION_ADR.md` (Phase 12 — selected Lineup Replay, added type-only scaffolding), `docs/DECISION_OS_REPLAY_FRAMEWORK_GENERALIZATION_ADR.md` (Phase 11 — the generic architecture this phase builds against).

---

## 1. What was built

Four files, mirroring Trade Replay's exact layout (per Phase 11's documented Replay Scenario shape):

- `lib/replay-framework/normalize/lineupSleeperNormalizer.ts` — converts a real Sleeper `SleeperMatchup` (one roster's one week) into `LineupReplayPayload`/`ReplayImportInput` (`decisionType: 'lineup'`). Deterministic synthetic `providerTransactionId` (`lineup-{leagueId}-roster{rosterId}-week{week}`) since a lineup decision has no natural provider transaction ID, preserving the same idempotent-upsert guarantee every other decision type gets from `writer.ts` unchanged.
- `lib/replay-framework/backtest/lineupBacktestExecutor.ts` — calls the real, unmodified `optimizeLineupDeterministic()` (`lib/lineup-optimizer-engine/`), feeding it real historical `players_points` as `projectedPoints` (a deliberate, valid reuse, not a misuse — see §2). Computes `actualPoints`/`optimalPoints`/`pointsLeftOnBench`/`efficiencyPct`/`benchValueLeft`/`pointsFromSuboptimalStarters`/`startSitMistakeCount`/mistake detail lists.
- `lib/replay-framework/ingest/ingestSleeperLineupsForLeague.ts` — per-week loop (mirroring `getAllLeagueTrades()`'s existing pattern), skips weeks with no real recorded scoring yet (Sleeper's matchups endpoint returns placeholder all-zero rows for future weeks, unlike trades where only real transactions ever appear).
- `lib/replay-framework/metrics/lineupReplayMetrics.ts` — reuses `metrics/shared.ts`'s `bucketize()`/`average()` (Phase 11's extraction). Computes average points left on bench, optimal-lineup %, weekly efficiency trend, position-level mistake counts, starter efficiency, distribution histograms.

**One framework-level generalization, informed by this real second consumer** (exactly as Phase 11 §8.1 recommended deferring until this moment): `versioning.ts`'s `computeDeterministicConfigVersion()` now accepts either a bare number (trade's original `calibratedB0` call site, byte-identical output, zero behavior change) or a generic `Record<string, string|number>` descriptor — lineup replay has no tunable calibrated config at all, so its call site passes `{}`, resolving to the stable literal `'none'`.

**23 new tests** across 4 new test files (`lineupSleeperNormalizer.test.ts`: 7, `lineupBacktestExecutor.test.ts`: 6, `ingestSleeperLineupsForLeague.test.ts`: 4, `lineupReplayMetrics.test.ts`: 6) — replay-framework's total test count rose from 68 (Phase 11) to 91, all passing. `isolation.test.ts` required **zero edits** — its recursive scan automatically covered all four new files, exactly as Phase 11 designed.

---

## 2. Why feeding real points into a `projectedPoints`-named parameter is correct, not a misuse

`optimizeLineupDeterministic()` maximizes whatever numeric value it's given per player — it has no opinion on whether that number is a forward-looking projection or a backward-looking real result. Feeding it real, historical `players_points` computes the exact, true retrospective-optimal lineup: "given what we now know actually happened, what was the best possible lineup?" This is the standard, well-understood "optimal points" / "lineup efficiency" metric used across the fantasy industry — not a workaround or reinterpretation of the engine, simply the natural backtest use of a forward-looking optimizer.

---

## 3. A genuine, load-bearing finding: the real engine has a practical roster-size ceiling

While selecting a real league for the staging validation run, ingestion against the originally-planned league ("Going Deep League," a 12-team dynasty league also used in Trade Replay's corpus) **repeatedly failed to complete** — not from a bug in this phase's code, but from a real, previously-undiscovered scalability property of `optimizeLineupDeterministic()` itself.

**Root cause, verified directly, not assumed:** the optimizer's DFS memoizes on `(slotIndex, usedMask)`, where `usedMask` is a bitmask over the *entire* roster (`lib/lineup-optimizer-engine/LineupOptimizerEngine.ts` lines 228–276). For a real dynasty roster of this league's actual size — confirmed via a direct Sleeper API check: real rosters ranged **35–40 players** — the reachable state space for filling ~8–10 real starting slots is on the order of `C(40, 8) ≈ 77 million` combinations. This is computationally infeasible in practice (the ingestion script never completed within a 6-minute timeout across three separate attempts at 18, 8, and 3 weeks).

**This is not a bug in this phase's replay glue, and this phase does not modify the optimizer** (per the explicit "do NOT build another optimizer" / do-not-modify-the-engine instruction) — it is a real, load-bearing constraint on which real leagues Lineup Replay can practically ingest today. Confirmed via a direct roster-size scan across the 8 leagues already in Trade Replay's corpus:

| League | Max real roster size | Lineup-replay-viable today? |
|---|---|---|
| Beta 1 Zombie League | 9 | **Yes — used for this phase's validation run** |
| KGBs On The Spectrum SF League | 17 | Yes |
| Jeepers Keepers! | 18 | Yes |
| Pirate League! | 18 | Yes |
| $20 Pirate League | 23 | Yes, but larger — untested this phase |
| Nfl Dreaming 2! | 35 | **No — same class of scalability failure expected** |
| Dynasty for life! | 35 | **No** |
| Going Deep League | 40 | **No — confirmed failing, this phase** |

**Recommendation, not implemented this phase:** a future phase could pre-filter each roster to a smaller, real candidate subset before calling the optimizer (e.g., only players eligible for at least one real starting slot, or the top-N players by points at each position) — this would be replay-glue work analogous to Phase 9's `providerAssetId`/`pos` translation fixes, never a modification to `optimizeLineupDeterministic()` itself. Not attempted this phase, since the selected small-roster league already provided a clean, real, honest validation run without it.

---

## 4. Real staging validation run

**League:** Beta 1 Zombie League (`1183130567676063744`) — a true redraft league, 20 rosters, real 2025 season, already an approved/ingested league from Trade Replay's Phase 9 corpus expansion (selected here specifically to reuse an already-connected, already-real league and to sidestep §3's scalability constraint).

**Ingestion result:** 18 weeks scanned, 0 weeks skipped as unscored (this league's full 2025 season is complete), **360 real `ReplayImport` + 360 real `ReplayBacktestResult` rows written, 0 errors** (20 rosters × 18 weeks). Idempotency confirmed by re-running the exact same ingestion a second time — counts stayed at 360/360, not 720/720.

**Housekeeping note, disclosed honestly:** three earlier attempts against "Going Deep League" (§3) partially wrote 149 orphaned `ReplayImport` rows (only 1 with a matching backtest) before each attempt was killed by the scalability wall. These were debris from this phase's own diagnostic process, not real validation data — deleted via a precisely-scoped query (`decisionType = 'lineup' AND providerLeagueId = '1182428029165572096'`) before this report's numbers were finalized. Trade Replay's 238/238 rows were never at risk (a different `providerLeagueId`, and the delete was scoped to that exact league).

### 4.1 Real metrics (360 real lineup decisions, 1 league, 18 real weeks, season 2025)

| Metric | Value |
|---|---|
| Avg actual points (what managers really scored) | 61.73 |
| Avg optimal points (the real, deterministic best-possible lineup) | 69.80 |
| Avg points left on bench (net: optimal − actual) | 8.07 |
| Avg bench value left (gross: real points sitting unused on the bench) | 12.94 |
| Avg points gained from suboptimal starters (gross: real points the "wrong" picks still contributed) | 4.87 |
| **Avg starter efficiency ("optimal lineup %")** | **88.36%** |
| Avg start/sit mistakes per lineup | 1.05 |

(Sanity check confirming internal consistency: `benchValueLeft (12.94) − pointsFromSuboptimalStarters (4.87) = 8.07 = pointsLeftOnBench`, exactly, as the metric definitions require.)

**Efficiency distribution:** heavily right-skewed toward high efficiency — 193 of 360 lineups (54%) landed in the 90–100% band, 86 more (24%) in 80–90%. Only 8 lineups (2%) scored below 50% efficiency. This is a real, plausible signal: most real managers in a redraft league mostly start their best players most weeks, with occasional real mistakes rather than systematic ones.

**Weekly efficiency trend ("weekly improvement"):** ranged from a low of 79.6% (week 18) to a high of 93.6% (week 8), no clean monotonic improvement trend across the season — real managers' week-to-week lineup quality fluctuates with real-world factors (injuries, bye weeks, playoff-motivation changes) more than it steadily improves, at least in this single-league sample.

**Position mistakes:** WR (135 occurrences) and RB (115) accounted for the large majority of missed-optimal-starter mistakes, TE (86) and QB (43) far fewer — consistent with WR/RB being the deepest, most flex-contested positions on a real roster (more real bench depth at those positions creates more opportunities for a real start/sit mistake), while most rosters carry only 1–2 real rostered QBs, leaving little room for a QB-position mistake to even be possible.

### 4.2 Isolation reconfirmed against real data

Measured directly, immediately after ingestion: `TradeOfferEvent` count `0`, `TradeOutcomeEvent` count `0`, `TradeLearningStats` count `0` — unaffected. Trade Replay's own corpus reconfirmed unchanged at exactly `238`/`238` replays/backtests, both before and after this phase's writes — direct proof the two decision types coexist in the same shared tables without any cross-contamination, exactly as the schema's `(provider, decisionType, providerLeagueId, providerTransactionId)` unique constraint was designed to guarantee since Phase 3.

---

## 5. Verification

- `npx vitest run __tests__/replay-framework/` — all tests pass (see §7 for the exact count), including the 4 new lineup test files.
- `npx vitest run __tests__/replay-framework/isolation.test.ts` — passes unchanged, zero edits needed for the 4 new files.
- `npx vitest run __tests__/decision-os/` — all 2422 tests pass, unaffected.
- `npx tsc --noEmit` — 158 errors, identical to the established baseline, zero new errors, none in any replay-framework file.
- Real staging isolation re-check (§4.2): `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` all `0`; Trade Replay's 238/238 unaffected.

---

## 6. Recommendation for Phase 14 (Phase 13's original recommendation — now acted on below)

1. **Do not modify `optimizeLineupDeterministic()`.** §3's scalability finding is real, but the fix belongs in replay glue (a roster pre-filter), never in the production engine, mirroring this workstream's consistent discipline of never modifying the systems it validates.
2. **If a larger real corpus is wanted:** build the roster pre-filter sketched in §3 as its own explicitly-scoped phase, verified against real data (confirm the filtered subset still contains the true optimal lineup in realistic cases) before trusting its output the way this phase's 360-row corpus can be trusted today.
3. **Expand the current corpus** with the other three already-viable small/medium-roster leagues (KGBs On The Spectrum SF League, Jeepers Keepers!, Pirate League! — all under 20 real players) before reaching for the pre-filter — more real, unmodified-engine validation data is available today without needing item 2 at all.
4. **Cross-reference lineup efficiency against trade activity**, once both corpora are larger — an open, real question this phase's single-league sample can't answer: do managers who make more/better trades also set more optimal lineups, or are these independent skills?

Phase 14 acted on items 1 and 3 directly (§8 below); item 2 (roster pre-filter) remains not implemented, per Phase 14's own explicit "do not modify `optimizeLineupDeterministic()`" scope; item 4 remains open.

---

## 8. Phase 14 — Corpus expansion: 4 more leagues, 1,260 real lineup decisions total

### 8.1 A real operational finding, caught and fixed before it could distort this report

While starting Phase 14, the real `ReplayImport` table showed 10 unexpected rows for "Going Deep League" — the large (35–40 player) league Phase 13 had already excluded for scalability reasons and cleaned up. Investigation found the very first ingestion attempt from Phase 13 (auto-backgrounded by the tool, never explicitly confirmed dead after its visible output stalled) had, in fact, remained alive the entire time since — slowly grinding through that league's combinatorially infeasible roster sizes in the background across all of Phase 13's remaining work, sporadically completing a handful of rows with no corresponding log output (the ingest script only logs after the *entire* multi-week ingestion resolves, so a still-running process produces no visible symptom beyond new, otherwise-unexplained database rows).

**Found and stopped directly** (`TaskStop` on the original background task ID), then the resulting 10 orphaned rows were deleted via the same precisely-scoped query as Phase 13's cleanup (`decisionType = 'lineup' AND providerLeagueId = '1182428029165572096'`). Reconfirmed zero further growth after stopping it. This is recorded here as an honest operational lesson for this workstream: a long-running ingestion attempt that appears to produce no more output is not necessarily dead, especially against a roster size known to trigger the DFS optimizer's combinatorial blowup — future large-roster attempts should be explicitly stopped, not merely abandoned in favor of a different approach.

### 8.2 Corpus expansion

4 additional leagues ingested via the exact same `ingestSleeperLineupsForLeague()` used in Phase 13 — no code changes, all real Sleeper API data, all already-approved (same account, same leagues already in Trade Replay's corpus). Roster sizes pre-confirmed viable via Phase 13's own scan (all well under the ~35-player threshold that made "Going Deep League" infeasible):

| League | Real rosters | Roster slots (starting + bench) | Real replays written | Errors |
|---|---|---|---|---|
| KGBs On The Spectrum SF League | 12 | 9 starting + 7 bench | 216 | 0 |
| Jeepers Keepers! | 12 | 10 starting + 7 bench | 216 | 0 |
| Pirate League! | 14 | 11 starting + 5 bench | 252 | 0 |
| $20 Pirate League | 12 | 9 starting + 10 bench | 216 | 0 |

Combined with Beta 1 Zombie League's existing 360 (Phase 13), the corpus now totals **1,260 real lineup decisions across 5 leagues, 18 real weeks each, season 2025.**

### 8.3 Cross-league comparison

| League | Rosters | Starting slots | Bench slots | Scoring | Format | Avg efficiency | Avg pts left on bench (net) | Avg bench value left (gross) | Avg mistakes/lineup |
|---|---|---|---|---|---|---|---|---|---|
| Beta 1 Zombie League | 20 | 5 (4×FLEX + SUPER_FLEX, no dedicated QB/RB/WR/TE slots) | 3 | Half-PPR | Redraft | **88.36%** | 8.07 | 12.94 | **1.05** |
| Pirate League! | 14 | 11 | 5 | Full PPR | Redraft | 88.33% | 17.34 | 25.80 | 1.91 |
| KGBs On The Spectrum SF League | 12 | 9 | 7 | Full PPR | Keeper | 86.71% | 19.57 | 31.97 | 2.18 |
| Jeepers Keepers! | 12 | 10 | 7 | Full PPR | Keeper | 86.51% | 18.75 | 33.11 | 2.40 |
| $20 Pirate League | 12 | 9 | **10** | Full PPR | Keeper | **82.46%** | **23.93** | **38.71** | **2.71** |
| **Combined (1,260 rows)** | — | — | — | — | — | **86.74%** | 16.44 | 26.65 | 1.93 |

### 8.4 League-to-league differences detected: roster/bench depth is the dominant driver, not league size or format

**Bench depth correlates cleanly with efficiency loss, across this real 5-league sample.** Beta 1 Zombie League (only 3 bench slots) has both the highest efficiency (88.36%) and the fewest real mistakes per lineup (1.05); $20 Pirate League (10 bench slots — the deepest of the five) has both the lowest efficiency (82.46%) and the most mistakes (2.71) — a monotonic-looking real relationship: more bench spots means more real start/sit decisions to get right each week, and real managers get a meaningfully larger fraction of them wrong as that count grows. Total league size (rosters: 12–20) and scoring format (half-PPR vs. full PPR) show no comparably clean pattern in this sample — Beta 1 Zombie League has the *most* teams (20) yet the *best* efficiency, ruling out "more teams competing for players" as the dominant factor here.

**Position mistakes are consistent across every league**, not incidental to any one: WR and RB dominate everywhere (700 and 860 combined mistakes across all 5 leagues), TE meaningfully fewer (468), QB fewer still (355), and K/DEF (only present in 2 of the 5 leagues) barely register (9 and 43) — real, structural evidence that mistake opportunity tracks real bench depth *at each position*, not league identity.

**Slot configuration matters at the margin, not the center.** Leagues with a `SUPER_FLEX` slot (Beta 1 Zombie League, KGBs, Pirate League!, $20 Pirate League) don't cluster together on efficiency — SUPER_FLEX presence alone doesn't explain the spread; bench depth remains the stronger real signal in this sample.

### 8.5 Weekly efficiency trend (combined, 1,260 rows) — "weekly improvement potential"

Combined across all 5 leagues: efficiency ranged from 76.1% (week 18) to 91.5% (week 5), with no clean season-long improvement trend (consistent with Phase 13's single-league finding) — real week-to-week lineup quality is dominated by real, unpredictable factors (injuries, bye weeks, end-of-season motivation shifts for eliminated teams) more than by managers steadily getting better at the mechanical task over a season. The late-season dip (weeks 16–18: 83.9%, 81.7%, 76.1%) is the most consistent real pattern across the combined data — plausibly explained by managers in eliminated real playoff races reducing effort, though this specific explanation is not directly testable from lineup data alone.

### 8.6 Replay-glue improvements for future large-dynasty-roster support (documented, not implemented)

Per this phase's explicit "do not modify `optimizeLineupDeterministic()`" constraint, no engine change was made. The concrete replay-glue options for a future phase, ranked by how much they preserve exact correctness:

1. **Exact, but scoped:** pre-filter each real roster to only players eligible for at least one real starting slot type (e.g., drop any player whose position never appears in `roster_positions`, such as a rostered TE in a league with no TE/FLEX/SUPER_FLEX slot) before calling the optimizer — reduces N without changing the true optimal answer, since an ineligible player could never have been part of it anyway. This alone would not be enough for a 40-player dynasty roster (most of those 40 are still real, eligible skill-position players), but is a free, zero-risk first step.
2. **Approximate, with a disclosed bound:** cap the candidate pool per position to the top-K real players by actual points (e.g., top 15 skill players total) before calling the optimizer — this can only ever miss the true optimum if a real top-scoring player was excluded from the top-K, a knowable, boundable risk that should be measured directly (compare the approximate optimal against the exact one on a league small enough to compute both) before being trusted for reporting, not assumed safe.
3. **Not recommended:** any change to `optimizeLineupDeterministic()`'s own memoization strategy — explicitly out of scope for this entire workstream, which validates existing engines rather than modifying them.

---

## 9. Recommendation for Phase 15

1. **Cross-reference lineup efficiency against trade activity** (Phase 13's item 4, still open) — now genuinely answerable without any new ingestion: all 5 of Lineup Replay's leagues are the exact same 5 leagues Trade Replay's Phase 9 corpus expansion already ingested (Beta 1 Zombie League, KGBs On The Spectrum SF League, Jeepers Keepers!, Pirate League!, $20 Pirate League) — a real per-league join between the two corpora is possible today.
2. **If item 6.2's top-K approximation is pursued**, verify it against Beta 1 Zombie League first (small enough to compute both the exact and approximate optimal and compare directly) before trusting it on any larger roster.
3. **Do not modify `optimizeLineupDeterministic()`** — unchanged guidance from Phase 13, reconfirmed by this phase's real cross-league data (the bench-depth-vs-efficiency finding is itself interesting *because* it reflects the real engine's real, unmodified behavior).
4. **Investigate the late-season efficiency dip (§8.5)** with real, join-able data this workstream already has access to (e.g., real playoff-elimination status per roster per week) before treating "reduced manager effort" as more than a plausible, untested hypothesis.

---

## 10. Files changed in this session

**Phase 13** (new library/test files, all unchanged this phase):

- `lib/replay-framework/normalize/lineupSleeperNormalizer.ts` (new)
- `lib/replay-framework/backtest/lineupBacktestExecutor.ts` (new)
- `lib/replay-framework/ingest/ingestSleeperLineupsForLeague.ts` (new)
- `lib/replay-framework/metrics/lineupReplayMetrics.ts` (new)
- `lib/replay-framework/types.ts` (extended Phase 12's `LineupBacktestOutput` scaffolding with `LineupMistakeDetail`, `benchValueLeft`, `pointsFromSuboptimalStarters`, `startSitMistakeCount`, `missedOptimalStarters`, `subOptimalActualStarters`)
- `lib/replay-framework/versioning.ts` (generalized `computeDeterministicConfigVersion()`, added `LINEUP_MODEL_VERSION`; byte-identical for trade's existing call site)
- `__tests__/replay-framework/lineupSleeperNormalizer.test.ts` (new, 7 tests)
- `__tests__/replay-framework/lineupBacktestExecutor.test.ts` (new, 6 tests, real unmocked engine)
- `__tests__/replay-framework/ingestSleeperLineupsForLeague.test.ts` (new, 4 tests)
- `__tests__/replay-framework/lineupReplayMetrics.test.ts` (new, 6 tests)

**Phase 14** (no code changes — pure corpus expansion + reporting):

- `docs/DECISION_OS_LINEUP_REPLAY_VALIDATION_REPORT.md` (this document — Phase 13 new, Phase 14 added §6 update, §8, §9, renumbered §10)

No trade-engine file was modified at any point. No Trade Learning code was modified. No calibration math, threshold, or weight was changed. No recommendation engine was touched. `optimizeLineupDeterministic()` was never modified. Real staging writes: Phase 13 wrote 360 `ReplayImport` + 360 `ReplayBacktestResult` rows (`decisionType: 'lineup'`) plus a scoped cleanup of 149 orphaned debris rows; Phase 14 wrote 216+216+252+216 = 900 more real `ReplayImport`/`ReplayBacktestResult` rows across 4 leagues (0 errors), found and stopped one still-running Phase 13 background process, and cleaned up the resulting 10 orphaned rows (§8.1). Final real corpus: **1,260 `ReplayImport` + 1,260 `ReplayBacktestResult` rows, `decisionType: 'lineup'`, 5 leagues.** `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` remain untouched at every point (reconfirmed at 0 after Phase 14's writes); Trade Replay's own corpus reconfirmed unchanged at exactly 238/238 both phases. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
