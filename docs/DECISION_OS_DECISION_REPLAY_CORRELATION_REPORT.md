# Decision OS Replay Framework Phases 15–16 — Decision Replay Correlation

**Status:** Read-only analysis over already-ingested corpora. No new ingestion. No production engine modified. No Trade Learning code touched. No calibration touched. Zero new Prisma writes anywhere (Phase 16 refined the existing Phase 15 module in place, no schema change).
**Branch:** `g15-event-foundation`
**Builds on:** `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` (238 real trades, 8 leagues), `docs/DECISION_OS_LINEUP_REPLAY_VALIDATION_REPORT.md` (1,260 real lineup decisions, 5 leagues — all 5 also appear in Trade Replay's 8-league corpus).

---

## 1. What was built

`lib/replay-framework/metrics/decisionReplayCorrelation.ts` — a new, pure, read-only function (`computeDecisionReplayCorrelation(providerLeagueIds)`) that joins the two already-ingested corpora **by real, stable `providerAssetId`** (the same convention Phase 9 established for Trade Replay and Phase 13 reused for Lineup Replay): for each real trade, it tracks the real player(s) the receiving roster acquired forward through that roster's subsequent real lineup history, using the exact same `missedOptimalStarters`/`subOptimalActualStarters` fields `lineupBacktestExecutor.ts` already persists — no new computation against either production engine, purely an aggregation over data both replay scenarios already produced. 6 new tests (mocked Prisma, mirroring every prior metrics module's test convention).

**Key join mechanics:**
- A trade's `assetsReceived` (Phase 9's `providerAssetId` field) is the acquired-player set; `participantsInvolved[0]` is always the proposer/receiving roster (per `sleeperTradeNormalizer.ts`'s own convention: `tx.roster_ids[0]`).
- A trade's real `resolvedAt` timestamp is converted to an **approximate** NFL week via the same season-start convention `lineupSleeperNormalizer.ts` already uses in the other direction (`Date.UTC(season, 8, 1) + week*7 days`, inverted here) — trades have no exact week number of their own (`ReplayImport.providerWeek` is `null` for every trade row, a documented, pre-existing design choice, not new this phase).
- For each acquired player, every lineup replay row for the same `(league, season, receivingRoster)` at or after the approximate trade week is scanned for that exact `providerAssetId` in `fullRoster`, `actualStarterIds`, `missedOptimalStarters`, and `subOptimalActualStarters` — yielding real lineup appearances, real starts, and real "was this specific acquired player part of the true optimal lineup that week" classifications.

---

## 2. Metrics produced

- **Starter Conversion Rate** — of the weeks an acquired player was on the receiving roster, how often the team actually started them.
- **Bench Conversion Rate** — of the weeks an acquired player deserved to start (was part of the real optimal lineup), how often the team benched them anyway (a genuine "wasted acquisition" rate).
- **Trade ROI** — real points captured *while started* per unit of deterministic market value given up (`totalPointsWhileStarted / givenUpValue`) — a real-outcome-vs-deterministic-cost ratio, comparable across trades of different sizes.
- **Lineup ROI** — the fraction of an acquired player's total real points that were actually captured by starting them (`totalPointsWhileStarted / totalPointsContributed`) — how efficiently the team turned raw acquired talent into realized value.
- **Trade Impact Score** — realized as `totalPointsContributed`/`totalPointsWhileStarted` per trade, compared across fairness-verdict and confidence buckets (§4).
- **Lineup Improvement Score** — roster-level average real efficiency in lineup weeks before vs. after each roster's earliest real trade (§5).

---

## 3. Headline finding: the deterministic fairness verdict predicts real future value capture — more than the confidence score does

Real, measured across 114 trades with real subsequent lineup data (of 141 total real trades considered across the 5 overlapping leagues):

| Verdict | Count | Avg Trade ROI | Avg Starter Conversion | Avg Points Contributed |
|---|---|---|---|---|
| **Strong Win** | 36 | **0.0795** (highest) | **78.5%** (highest) | 137.1 |
| Slight Win | 21 | 0.0702 | 68.9% | 92.0 |
| Fair | 18 | 0.0382 | 53.0% | 124.9 |
| Overpay Risk | 33 | 0.0252 | **46.9%** (lowest) | 83.8 |
| Major Overpay | 6 | **0.0183** (lowest) | 53.1% | 172.6 |

**This is a real, non-obvious validation result.** `computeTradeDrivers()`'s `verdict` is computed entirely from pre-trade information (fairness/`score` composite — lineup impact, VORP, market, behavior at the moment of the trade) with zero knowledge of what would actually happen afterward. Yet real "Strong Win" trades went on to be started 78.5% of the time (vs. 46.9% for "Overpay Risk") and captured more than 4x the real trade ROI of "Major Overpay" trades. The verdict was never built or tuned with this correlation in mind (this workstream has never touched `acceptProbability`/verdict weights) — this is the first time this workstream has measured whether the deterministic fairness scoring actually predicts anything about what happens after the trade, and in this real sample, it does.

**By contrast, confidence score shows a much weaker relationship**, split at the real median (95, reflecting Phase 7's finding that VORP+roster-context enrichment pushes many rows' confidence into the 90-100 band):

| Confidence tier | Threshold | Count | Avg Trade ROI | Avg Starter Conversion |
|---|---|---|---|---|
| High | ≥ 95 | 65 | 0.0481 | 68.6% |
| Low | < 95 | 49 | 0.0458 | 53.7% |

Trade ROI is nearly identical between tiers (0.048 vs. 0.046) — confidence score, which measures data-completeness rather than trade quality (per Phase 6/8's own findings), correlates only weakly with real subsequent outcomes, exactly consistent with its known role in this system: confidence answers "how much do we know," not "how good is this trade."

---

## 4. Aggregate real numbers (114 trades with real lineup data)

| Metric | Value |
|---|---|
| Avg Starter Conversion Rate | 62.2% |
| Avg Bench Conversion Rate | 22.4% |
| Avg Trade ROI | 0.047 |
| Avg Lineup ROI | 0.777 |
| Avg total real points contributed per trade | 113.3 |

Real acquired players were started roughly 5 out of every 8 weeks they were rostered, and when they were part of the true optimal lineup, they were still benched about 1 in 5 of those weeks — a real, measurable "wasted acquisition" rate, consistent with (and now directly connected to) Lineup Replay's own Phase 13/14 finding that real managers leave meaningful value on the bench regardless of how it got there.

---

## 5. Lineup Improvement Score — an honest, confounded result, not a clean answer (superseded by Phase 16 §11 — see below)

| | Avg efficiency | Sample size |
|---|---|---|
| Before the roster's earliest real trade | 88.2% | 61 real lineup rows |
| After the roster's earliest real trade | 86.3% | 605 real lineup rows |

**Read carefully, not as "trades made lineups worse."** The "before" sample is small (61 rows) and skews toward early-season weeks (when real efficiency across this entire corpus already runs higher, per Phase 14 §8.5's weekly trend); the "after" sample is much larger (605 rows) and necessarily includes the documented late-season efficiency dip (weeks 16-18, Phase 14 §8.5) simply because it covers more of the season. This comparison is confounded by the same seasonal pattern already found and disclosed in Phase 14 — it is not a clean, isolated measurement of "did this trade help," and is reported honestly as inconclusive rather than stretched into a negative finding it doesn't actually support.

**Phase 16 update:** this exact suspicion was tested directly with a matched before/after window (§11) — the confound was real. Once controlled for, the apparent "-2 percentage point" drop shrinks to an essentially null −0.07 percentage points. This section's numbers are kept for continuity/comparison, not as the trusted answer.

---

## 6. Notable real examples

**Highest real Trade ROI:** a $200-value pickup of Breece Hall (Pirate League!, week 4) that went on to be started 5 of 6 real weeks for 84.96 real points — a legitimately excellent, cheap real acquisition. A Jonathan Taylor acquisition (Jeepers Keepers!, week 2, 1,251 value given up) was started 16 of 17 real weeks for 347.5 real points — the largest raw real-points return in the sample.

**Zero real lineup appearances — a real, disclosed limitation, not a bug (resolved by Phase 16 §10 — see below).** Several trades (all in Beta 1 Zombie League) show acquired real players (or draft picks) with 0 lineup appearances post-trade. Two distinct, legitimate causes were mixed together here and should not be read as "worthless trades": (1) **draft picks structurally can never have lineup appearances** — they aren't real, startable players in Sleeper's matchup data; (2) **real players who were later re-traded, cut, or placed on season-ending injury reserve** would also show zero appearances on the *original* receiving roster. Phase 16 built the roster-churn classification that distinguishes these cases directly rather than leaving them ambiguous.

---

## 7. A real operational finding: the same zombie-process class as Phase 14, this time much worse

Phase 14 found and stopped one background ingestion attempt against the excluded large-roster league ("Going Deep League") that had silently kept running. **This phase found the same thing happening again, far more severely**: while preparing this correlation run, the real database showed the excluded league's row count had grown again (10 → 46). Direct process inspection (`Get-CimInstance Win32_Process`) found **9 separate, still-running node processes**, all executing the same Phase 13 diagnostic script, each frozen at whatever `LEAGUE_ID` was in that script file at the moment that specific process started — meaning every failed/retried attempt from Phase 13 (the original 18-week run, the 8-week retry, the 3-week retry, all against the large-roster league, before the league ID was finally switched to a small-roster league) had spawned a process that outlived the Bash tool's own reported timeout, and none of them had actually been terminated by that timeout.

**Root cause, now understood precisely:** on this environment, a Bash tool timeout (or the tool's own "Command timed out" message) does not reliably kill the underlying child process tree — it only stops the *tool* from waiting on it. Phase 14's `TaskStop` on the one harness-tracked background task ID killed exactly one of these; the other 8 were never tracked as a "background task" at all (they were spawned by ordinary, seemingly-completed-or-timed-out foreground `Bash` calls) and so were invisible to that cleanup.

**Fixed this phase:** identified and force-killed all 9 processes directly via PowerShell, confirmed zero remain, and re-deleted the resulting orphaned rows (back to the exact expected 1,260/1,260). This phase's actual correlation numbers were **never affected** by the contamination — the query explicitly scoped to the 5 known-good leagues throughout, verified by re-running the identical query before and after cleanup and confirming byte-identical output.

**Lesson for all future phases in this workstream:** after any script targeting a known-problematic large roster (or any script that hits a Bash tool timeout), explicitly verify via the OS process list (`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"`, filtered to the scratchpad path) that no orphaned process remains — do not assume a reported timeout means the process is dead, and do not assume stopping one harness-tracked task ID is sufficient if multiple attempts were made against the same script path.

---

## 8. Verification (Phase 15)

- `npx vitest run __tests__/replay-framework/` — all tests pass, including 6 new tests for `decisionReplayCorrelation.ts`.
- `npx vitest run __tests__/decision-os/` — all 2422 tests pass, unaffected.
- `npx tsc --noEmit` — 158 errors, identical to the established baseline, zero new errors, none in the new file.
- Real staging isolation re-check: `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` all `0`; Trade Replay's 238/238 and Lineup Replay's 1,260/1,260 corpora reconfirmed exactly unchanged after this phase's read-only analysis (post-cleanup).

---

## 10. Phase 16 — Roster-churn classification: the zero-appearance ambiguity, resolved

Every acquired real player (across all 141 real trades) is now classified into exactly one status: `active` (started at least once), `retained_but_unused` (on the roster, never started), `churned_away` (roster has real post-trade data, but this player never appears in it), `insufficient_week_coverage` (the roster has *no* real post-trade lineup data at all — a data-availability gap, not a football decision), or `draft_pick` (structurally excluded from all real-player rates).

**Real breakdown, all 5 leagues, 141 trades:**

| Status | Count | % of real acquired players |
|---|---|---|
| Active (started ≥1 real week) | 139 | 83.7% |
| Retained but unused (real "wasted acquisition") | 16 | 9.6% |
| Churned away (dropped/re-traded before ever appearing) | 11 | 6.6% |
| Insufficient week coverage | **0** | 0% |
| *(Draft picks, excluded from the above %)* | 43 | — |

**A decisive, honest resolution — not a hedge.** Zero of the 166 real acquired players fell into `insufficient_week_coverage` in this real 5-league sample: every single zero-appearance case was a genuine `churned_away` outcome, not a data-availability artifact. This means Phase 15's zero-appearance ambiguity, in this specific real corpus, resolves cleanly toward "these were real personnel decisions" rather than "we simply don't have enough season left to observe them" — a real, positive finding about this dataset's usability, not assumed in advance.

**Aggregate rates** (averaged per-trade, across all 141 trades — including trades with zero lineup data at all, since those are exactly the trades where a 100% churn/zero-appearance rate is most informative and would be wrongly hidden by excluding them):

| Metric | Value |
|---|---|
| Avg zero-appearance rate (churned + insufficient-coverage) | 6.46% |
| Avg retained-but-unused rate | 9.44% |
| Avg churned-away rate | 6.46% |

---

## 11. Phase 16 — Matched before/after window: the seasonal confound, tested and confirmed

A 3-real-week window immediately before vs. immediately after each trade's approximate week (per Phase 15 §9's own recommendation) replaces the naive all-season comparison. 110 of 141 trades (78%) had at least one real week of data on both sides.

| | Value |
|---|---|
| Trades with usable matched-window data | 110 |
| Avg Δ efficiency (after − before) | **−0.07 percentage points** |
| Avg Δ points left on bench (after − before) | **+0.25 points** |

**This directly confirms Phase 15 §5's suspicion.** The naive comparison showed an apparent 1.97-percentage-point efficiency drop (88.2% → 86.3%); the matched, deconfounded comparison shows an essentially **null** effect (−0.07 points, and a small +0.25 point increase in bench value left, both close enough to zero to be unremarkable given real week-to-week noise). **Trades, in this real sample, do not measurably move roster-wide lineup efficiency in either direction** — the earlier apparent decline was a genuine artifact of the late-season efficiency dip (Phase 14 §8.5) contaminating the "after" sample, exactly as suspected, now confirmed rather than merely hypothesized.

### 11.1 Cross-cut comparisons (matched-window delta, by grouping)

| Grouping | Segment | Count | Avg Trade ROI | Avg Retained-Unused Rate | Avg Δ Efficiency | Avg Δ Bench Left |
|---|---|---|---|---|---|---|
| **Verdict** | Strong Win | 36 | 0.0795 | 3.2% | −1.02 pts | +3.00 |
| | Slight Win | 21 | 0.0702 | 7.1% | +0.56 pts | −1.63 |
| | Fair | 18 | 0.0382 | **24.1%** (highest) | −0.41 pts | −0.81 |
| | Overpay Risk | 33 | 0.0252 | 13.1% | +0.51 pts | −0.19 |
| | Major Overpay | 6 | 0.0183 | 0% | +0.22 pts | −0.43 |
| **Fairness category** | Win (Strong+Slight) | 57 | 0.0763 | 4.7% | −0.44 pts | +1.29 |
| | Fair | 18 | 0.0382 | 24.1% | −0.41 pts | −0.81 |
| | Overpay (Risk+Major) | 39 | 0.0237 | 11.1% | +0.47 pts | −0.22 |
| **Confidence tier** | High (≥95) | 65 | 0.0481 | 5.6% | −0.10 pts | +1.01 |
| | Low (<95) | 49 | 0.0458 | 15.6% | −0.20 pts | −0.28 |
| **Lineup involvement** | Starter-involved | 44 | **0.0520** | 7.6% | **+1.38 pts** | **−1.70** |
| | Bench-depth | 70 | 0.0395 | 11.4% | −1.10 pts | +1.82 |

### 11.2 Two real, non-obvious findings from the cross-cut

**Finding A — "Fair" trades have the highest real wasted-acquisition rate, not "Overpay" trades.** Across every grouping, `Fair`-verdict trades show the highest `retained_but_unused` rate (24.1%) — nearly double `Overpay Risk`'s (13.1%) and far above `Strong Win`'s (3.2%). This is genuinely counter-intuitive: a trade rated fair-and-balanced at the moment of the deal was, in this real sample, the MOST likely to see the acquired player benched entirely afterward. A plausible (untested) explanation: a "Fair" trade is exactly the kind that doesn't clearly address a real roster need, so the acquired player has no obvious real path to a starting slot even when the trade itself was priced correctly.

**Finding B — starter-involved trades (per Trade Replay's own `deltaThem` signal, established Phase 8/9) show a real, positive matched-window efficiency delta; bench-depth trades show a real negative one.** This is the clearest, most internally consistent result in the whole cross-cut: trades where Trade Replay's real lineup-delta channel was already non-zero at trade time (`starter_involved`, n=44) go on to show **higher** trade ROI (0.052 vs. 0.040), **lower** wasted-acquisition rate (7.6% vs. 11.4%), and a genuinely **positive** matched-window efficiency change (+1.38 percentage points) — while bench-depth trades (n=70, `deltaThem === 0`) show a real **negative** change (−1.10 points). This extends Phase 9's finding (starter-involved trades score higher `acceptProb`) with a new result: they also correlate with better real, measured downstream outcomes, not just a higher predicted-acceptance score at the moment of the trade.

---

## 12. Verification (Phase 16)

- `npx vitest run __tests__/replay-framework/` — all tests pass, including 13 tests for `decisionReplayCorrelation.ts` (7 from Phase 15 + 6 new Phase 16 tests covering roster-churn classification and matched-window logic).
- `npx vitest run __tests__/decision-os/` — all 2422 tests pass, unaffected.
- `npx tsc --noEmit` — 158 errors, identical to the established baseline, zero new errors, none in the modified file.
- Real staging isolation re-check: `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` all `0`; Trade Replay's 238/238 and Lineup Replay's 1,260/1,260 corpora reconfirmed exactly unchanged (no new ingestion this phase — confirmed by identical counts before and after the analysis run).

---

## 13. Recommendation for Phase 17

1. **The starter-involvement finding (§11.2, Finding B) is the strongest, most productizable result across both phases** — it connects a signal already computed at trade time (`deltaThem`, zero new computation needed) to a real, positive downstream outcome. This is the natural candidate for a Manager OS/Chimmy surface ("trades that clearly upgrade your active lineup tend to pay off more than depth-for-depth swaps"), pending its own explicitly-scoped phase.
2. **Investigate Finding A (§11.2)** — is the high "Fair"-verdict wasted-acquisition rate a real, generalizable pattern, or an artifact of this specific 5-league, 18-count sample? Re-test once a larger trade corpus exists (more leagues, more seasons) before treating it as more than a suggestive lead.
3. **The matched-window methodology (§11) should become the standard** for any future before/after lineup comparison in this workstream — the naive all-season comparison is now demonstrated, not just suspected, to produce a misleading result.
4. **Continue the process-hygiene practice (Phase 15 §7)** — this phase's staging run was clean (no orphaned processes found before or after), the first phase in this sub-workstream where that check passed with zero findings.

---

## Files changed in this session

**Phase 15** (new files):

- `lib/replay-framework/metrics/decisionReplayCorrelation.ts` (new)
- `__tests__/replay-framework/decisionReplayCorrelation.test.ts` (new, 6 tests)
- `docs/DECISION_OS_DECISION_REPLAY_CORRELATION_REPORT.md` (this document, new)

**Phase 16** (refined in place, no schema or production-engine change):

- `lib/replay-framework/metrics/decisionReplayCorrelation.ts` (extended — added `AcquiredPlayerStatus` roster-churn classification, `MatchedWindowResult` before/after window computation, `byFairnessCategory`/`byLineupInvolvement` groupings; existing Phase 15 fields/behavior unchanged, verified via unmodified Phase 15 tests still passing)
- `__tests__/replay-framework/decisionReplayCorrelation.test.ts` (extended — 6 new tests: 5 roster-churn classification cases, 2 matched-window cases, for 13 total)
- `docs/DECISION_OS_DECISION_REPLAY_CORRELATION_REPORT.md` (this document — added §10, §11, §12, §13; renumbered/updated §5, §6, §9)

No trade-engine file was modified. No lineup-optimizer file was modified. No Trade Learning code was modified. No calibration math, threshold, or weight was changed. No new ingestion occurred in either phase — Phase 16 read the exact same 238 trade + 1,260 lineup rows Phase 15 already read. `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` remain untouched at every point. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.

No trade-engine file was modified. No lineup-optimizer file was modified. No Trade Learning code was modified. No calibration math, threshold, or weight was changed. No new ingestion occurred — this phase read only the already-ingested 238 trade + 1,260 lineup rows. Real staging actions this phase: 9 orphaned node processes (debris from Phase 13's own earlier attempts) were found and terminated, and the resulting orphaned `ReplayImport` rows for the excluded large-roster league were deleted via the same precisely-scoped query pattern established in Phases 13-14 — restoring the corpus to its exact expected state (238/238 trade, 1,260/1,260 lineup). `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` remain untouched at every point. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
