# Sleeper Trade Replay — Validation Metrics Report

**Status:** Analysis only. Read-only aggregate queries against the real replay corpus deployed to staging in Phase 4 (`docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md` §10), **re-measured after Phase 6's roster-context enrichment (§8)**. No trade-engine math, calibration, or scoring changed at any point. No writes beyond the replay corpus itself.
**Branch:** `g15-event-foundation`
**Data source:** the 38 real, backtested Sleeper trades (3 leagues, 2 seasons) ingested in Phase 4, re-ingested in place (same natural keys, idempotent update) with roster context in Phase 6 — staging only, never production.

---

## 1. What was built

`lib/replay-framework/metrics/tradeReplayMetrics.ts` — a single, pure, read-only function (`computeTradeReplayMetrics()`) that queries `ReplayImport`/`ReplayBacktestResult` (two `findMany` calls, zero writes) and computes: totals, season/league coverage, predicted-acceptance summary statistics, a fairness (verdict) distribution, a value-delta distribution, a confidence-score distribution, an accepted-trade-probability distribution, and a per-league-settings breakdown. Bucket-histogram shape (10 buckets, 0–100%) mirrors the existing convention in `lib/trade-engine/calibration-metrics.ts` rather than inventing a new one. Isolation re-confirmed against real data after running this query: `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` counts all remained `0`.

## 2. Real metrics summary (38 replays, 38 backtests, staging)

| Metric | Value |
|---|---|
| Total replays / backtests | 38 / 38 |
| Seasons | 2025, 2026 |
| Leagues | 3 (`Going Deep League`, `Nfl Dreaming 2!`, `Dynasty for life!`) |
| Avg predicted acceptance | **0.2566** |
| Min / max predicted acceptance | 0.20 / 0.31 |
| Avg accepted-trade probability (real outcome = ACCEPTED only) | **0.2566** (all 38 rows are `ACCEPTED` — see §4) |

**Fairness (verdict) distribution:**

| Verdict | Count | % |
|---|---|---|
| Overpay Risk | 18 | 47% |
| Fair | 12 | 32% |
| Major Overpay | 5 | 13% |
| Slight Win | 2 | 5% |
| Strong Win | 1 | 3% |

**Confidence-score distribution:** entirely clustered in 30–40 (27 rows) and 40–50 (11 rows) — zero rows above 50. See §5 for why.

**Accepted-trade probability distribution:** 37 of 38 rows (97%) fall in the 20–30% bucket; 1 row in 30–40%. This is the report's central finding — see §4.

**Value-delta distribution** (asset value imbalance, `(received − given) / total`): spread fairly evenly across 0–60%, tapering to zero above 60% — real trades in this sample aren't perfectly balanced, but none are extreme one-sided giveaways either.

**League-settings sensitivity** (all 3 leagues are dynasty; one variable, SuperFlex, differs):

| League | SuperFlex | Count | Avg predicted acceptance |
|---|---|---|---|
| Going Deep League | Yes | 21 | 0.2614 |
| Nfl Dreaming 2! | No | 14 | 0.2536 |
| Dynasty for life! | Yes | 3 | 0.2367 |

No meaningful sensitivity to SuperFlex format detected in this sample — but the sample is far too small (3 leagues) to treat this as a real finding either way; it's reported for completeness, not as a conclusion.

---

## 3. Model behavior findings

### 3.1 Are real accepted Sleeper trades scoring too low? — Yes, strikingly so, but the finding is confounded (see below)

Every one of the 38 real trades in this corpus actually happened (Sleeper only exposes `type: 'trade'` transactions that reached a terminal state), yet the deterministic model's own predicted acceptance probability for those same real trades averages just **0.2566** — and 97% of them land in the narrow 20–30% band. If the model's calibration matched real-world dynasty trading behavior, real accepted trades should skew toward the *high* end of the probability scale, not cluster near the low end. This is a genuine, real, honestly-measured pattern — not a training artifact, since nothing in this pipeline ever adjusts `calibratedB0` or any weight based on this data (§6).

**This finding should not be read as "the model is miscalibrated" without qualification.** Three structural confounds in this specific replay pipeline, not in the trade-engine itself, plausibly explain some or all of the gap:

1. **Survivorship bias, structural to Sleeper's own API.** Every trade sampled across this entire workstream (this phase's 38, and Phase 1's independent 247-trade audit) has `status: complete` — zero `pending`, zero `failed` ever observed. This strongly suggests Sleeper does not persist a `trade`-type transaction row for a proposal that was simply declined without a formal vote/veto — meaning this replay corpus can structurally never see a *rejected* real trade to compare against. A model that predicts many real trades as marginal-to-unfavorable, in a dataset that can only ever contain trades that succeeded, is not automatically wrong — it may simply never see the (unobservable) trades it would have correctly predicted as unlikely.
2. **No roster/lineup context during backtesting.** `tradeBacktestExecutor.ts` calls `computeTradeDrivers()` without a `rosterCtx` (by design, per the ADR — the normalizer only captures the two traded-asset lists, not each manager's full roster). This is very likely *why* `confidenceScore` clusters entirely in the 30–50 range (§3.2) and plausibly depresses `acceptProb` too, since lineup-impact is a real input to the live model that this replay pipeline simply doesn't have available.
3. **Present-day valuations applied to historical trades.** Every backtest values assets using *today's* FantasyCalc snapshot, not a valuation snapshot from when the historical trade actually happened. A player traded in the 2025 season may have moved significantly in value since then — this is a genuine methodological limitation of backtesting against a live, current valuation source rather than a point-in-time one.

**Conclusion:** this is a real, reportable, worth-investigating signal — but the responsible next step is expanding the sample and addressing confound #2 (adding roster context) before treating it as evidence the model itself needs recalibration. This mirrors the same "measure, don't guess, don't jump to a fix" discipline this whole workstream has followed since Phase 0.

### 3.2 Are trades clustered by fairness tier? — Yes: skewed toward "Overpay Risk," not "Fair"

47% of real trades are classified `Overpay Risk`, only 32% `Fair`, and just 8% favorable (`Slight Win`/`Strong Win` combined). Combined with §3.1, this is consistent with the same underlying explanation: the model, evaluated on real trades without roster context and using present-day valuations, tends to see more imbalance in real historical trades than the participants apparently did at the time.

### 3.3 Are certain league settings producing different model behavior? — No detectable signal, sample too small to conclude

The 3-league sample shows avg predicted acceptance within a narrow band (0.2367–0.2614) regardless of SuperFlex status. This is not evidence of *no* sensitivity — it's evidence that 3 leagues is far too small a sample to detect one either way. A future ingestion of more leagues (see §7) is needed before this question has a real answer.

### 3.4 Are there outliers worth investigating? — One: the single "Strong Win" verdict

Only 1 of 38 trades scored `Strong Win`. Isolating and manually reviewing that specific trade (which league, which real assets, which manager) is the natural next micro-investigation once a larger corpus exists — with only one example in the current sample, it's not yet possible to say whether it represents a real edge case or simply the tail of the existing distribution.

---

## 4. All 38 trades resolved to `ACCEPTED` — a data-shape observation, not a new finding

This is the same "no pending/failed trades observed" finding from `docs/SLEEPER_TRADE_INGESTION_AUDIT.md` §3, now reconfirmed against a real, deployed replay corpus rather than a one-time audit sample. It means every metric above describing "accepted trades" is, in this corpus, describing *all* trades — there is currently no real `REJECTED`/`COUNTERED`/`UNKNOWN` comparison group to contrast against. This is the single most important caveat on §3's findings and is exactly the survivorship-bias confound named in §3.1 item 1.

---

## 5. Confidence-score clustering explained (not a trade-engine bug)

`confidenceScore` output by `computeTradeDrivers()` clusters entirely in 30–50 across every one of the 38 real trades. This is a **replay-pipeline limitation, not a model miscalibration**: the deterministic engine's confidence computation weights in lineup-impact data, and `runTradeBacktest()` deliberately calls `computeTradeDrivers()` with `rosterCtx: undefined` (per the current normalizer's scope — it captures only the traded assets, never each manager's full roster). A future phase that enriches the normalizer with real roster context (available from the same `/league/{id}/rosters` endpoint already used for identity resolution) would very likely raise and diversify this distribution — but that is new normalizer work, not a finding about the trade-engine itself.

---

## 6. Isolation re-confirmed

Measured directly, immediately after running the real metrics query against staging: `TradeOfferEvent` count `0`, `TradeOutcomeEvent` count `0`, `TradeLearningStats` count `0` — unchanged from Phase 4. The metrics module performs exactly two read-only `findMany` calls (`ReplayImport`, `ReplayBacktestResult`) and nothing else; this was verified both by direct execution against staging and by the existing static isolation test (`__tests__/replay-framework/isolation.test.ts`), whose recursive source scan automatically covers this new file without modification.

---

## 7. Recommended next phase (as of Phase 5 — see §8 for what Phase 6 actually did and found)

Not this phase's decision to make, but the natural candidates surfaced by this analysis, roughly in order of leverage:

1. ~~Enrich the normalizer with real roster context~~ (§3.1 item 2, §5) — **done, Phase 6, see §8.** Confirmed the highest-leverage item to try, though the result was more nuanced than "fixes the low-acceptance finding" (it didn't — see §8.3).
2. **Ingest more leagues** — the current 3-league, 38-trade sample is real but small; the remaining 28 already-audited leagues (and the other 82 never sampled) are the natural next batch, per `docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md` §9.7/§10's still-open items.
3. **Investigate whether Sleeper exposes rejected/countered proposals through any other endpoint** — if survivorship bias (§3.1 item 1) is structural to the `transactions` endpoint specifically, a different Sleeper endpoint or a live-polling approach (out of scope for this phase and the next) might be the only way to ever observe a real rejected trade.
4. **Historical valuation snapshotting** — a genuinely larger undertaking (a point-in-time FantasyCalc value archive), lower near-term priority than items 1–2.
5. **Populate `Asset.vorpValue` for replay assets, not just `value`** (net-new finding from Phase 6, see §8.3) — required before roster context's real lineup-delta computation can actually influence `acceptProb`/verdict at all.

None of the above is authorized or begun by this report — this is analysis, not a plan of record.

---

## 8. Phase 6 — Roster context enrichment: before/after comparison

### 8.1 What was added

`lib/replay-framework/normalize/sleeperTradeNormalizer.ts` now resolves each side's **full real roster** (Sleeper's own `roster.players: string[]`, not just the two traded-asset lists) into `TradeReplayPayload.proposerRoster`/`counterpartyRoster` — additive, optional fields; rows without them (there are none left, since re-ingestion updated all 38 in place) fall back to the exact pre-Phase-6 behavior. `lib/replay-framework/backtest/tradeBacktestExecutor.ts` now builds a real `rosterCtx` (`{ yourRoster, theirRoster, rosterPositions }`) and passes it as `computeTradeDrivers()`'s 7th argument — previously always `undefined`. All 38 real replay rows were re-ingested in place (same natural keys, `providerLeagueId`+`providerTransactionId` unchanged) with real roster sizes: e.g. 39 and 34 real players resolved for one trade's two sides, 37/38 for another — genuinely large, real dynasty rosters, not stubs.

### 8.2 Before / after — the numbers

| Metric | Before (Phase 5) | After (Phase 6) | Changed? |
|---|---|---|---|
| Avg predicted acceptance | 0.2565789473684211 | 0.2565789473684211 | **No — byte-identical** |
| Min / max predicted acceptance | 0.20 / 0.31 | 0.20 / 0.31 | No |
| Fairness (verdict) distribution | Overpay Risk 18, Fair 12, Major Overpay 5, Slight Win 2, Strong Win 1 | *identical* | No |
| Value-delta distribution | (10 buckets, see Phase 5 §2) | *identical* | No |
| **Confidence distribution** | 30–40: 27, 40–50: 11 | **40–50: 27, 50–60: 11** | **Yes — every row's confidence rose by exactly 10** |
| Accepted-trade probability distribution | 37 rows at 20–30%, 1 at 30–40% | *identical* | No |

### 8.3 Why confidence moved but acceptance/fairness didn't — root-caused, not guessed

This was checked directly against real backtest rows rather than assumed. `computeTradeDrivers()`'s confidence formula (`lib/trade-engine/trade-engine.ts` line 1280) awards a flat `+10` data-completeness bonus whenever `hasLineupData || hasImpactData` is true — a bonus for *having* an input available, independent of what that input's value actually says. Roster context correctly flips `hasLineupData` to `true` (real rosters, real `lineupDelta` computed), which is exactly why confidence rose uniformly by 10 across all 38 rows.

But the branch that would let the real `lineupDelta.lineupImpactScore` actually influence the final score (line 769: `if ((hasLineupData || hasImpactData) && hasVorpData)`) requires **both** — and `hasVorpData` (line 735: `giveVorp > 0 || receiveVorp > 0`, reading `Asset.vorpValue`) is `false` for every asset this replay pipeline constructs, because neither the traded-asset resolver nor the new roster resolver ever populates `vorpValue` — only the FantasyCalc-derived `value` field. Confirmed directly: a real backtest row's `lineupImpactScore` is still exactly `0.1` after enrichment, identical to its pre-enrichment value, because the code falls through to a different (`starterRatio`-based) computation path that doesn't consume the real lineup delta at all.

**This is not a trade-engine bug, and not a bug in this phase's wiring** — `rosterCtx` is being built and passed correctly, confirmed by both the confidence shift and a dedicated unit test asserting the exact object passed to `computeTradeDrivers()`. It is a precise, now-identified limitation of this replay pipeline specifically: **populating `Asset.vorpValue` (not just `value`) for both traded and roster assets is a prerequisite for roster context to actually reach `acceptProb`/verdict**, not only `confidenceScore`. This is now the clearest, most concrete "next enrichment" item this whole investigation has produced (§7 item 5).

### 8.4 What this means for the Phase 5 "real trades score too low" finding

The roster-context hypothesis from Phase 5 §3.1 item 2 ("no roster/lineup context... plausibly depresses acceptProb too") is **not supported by this experiment** — adding real roster context changed confidence but not acceptance probability at all, for this specific 38-trade sample. This narrows, rather than confirms, the earlier speculation: whatever is driving the low acceptance-probability clustering, it is not (at least not primarily) the absence of roster/lineup context on its own — survivorship bias (§3.1 item 1) and stale present-day valuations (§3.1 item 3) remain the two live, unresolved candidate explanations. This is an honest update to a prior hypothesis based on new measurement, not a discarded finding — exactly the discipline this whole workstream has followed since Trade Learning Phase 0.

---

## 9. Phase 7 — VORP enrichment: before/after comparison

### 9.1 VORP source used

Reused the exact primitive native AllFantasy trade flows already call for VORP: `computePlayerVorp()` (`lib/vorp-engine.ts`) — a pure function, zero network/DB dependency beyond the already-fetched `fcPlayers` array this pipeline already had. **Not** the heavier `pricePlayer()`/`lib/hybrid-valuation.ts` wrapper, which does name-based historical-Excel lookups and live analytics-API calls this pipeline has no use for (it already resolves players by Sleeper ID via `findPlayerBySleeperId()`, matching `FantasyCalcPlayer` directly — no name-matching step needed). A new `lib/replay-framework/valuation/vorpResolver.ts` derives a **real** `LeagueRosterConfig` from each league's actual `roster_positions` (counting real QB/RB/WR/TE/FLEX/SUPER_FLEX slots) rather than falling back to the generic 1-QB/2-RB/2-WR/1-TE default `hybrid-valuation.ts` uses when no explicit config is given — more faithful to the real league being replayed.

### 9.2 What was enriched

`sleeperTradeNormalizer.ts` now computes `vorpValue` (via `resolvePlayerVorp()`) for every traded player asset (`assetsGiven`/`assetsReceived`) **and** every roster-context asset (`proposerRoster`/`counterpartyRoster`) — closing exactly the gap Phase 6 identified. Fallback preserved: any player that doesn't resolve against FantasyCalc gets `vorpValue: 0` (never fabricated, never throws), matching this pipeline's established convention. Draft picks are out of scope (VORP doesn't apply to picks the way it does to players; native trade flows don't compute it for picks either). All 38 real rows re-ingested in place (same natural keys).

### 9.3 Before / after — the numbers

| Metric | Before (Phase 6) | After (Phase 7) | Changed? |
|---|---|---|---|
| Avg predicted acceptance | 0.2565789473684211 | 0.2565789473684211 | **No — byte-identical, again** |
| Accepted-trade probability distribution | 37 rows at 20–30%, 1 at 30–40% | *identical* | No |
| **Fairness (verdict) distribution** | Overpay Risk 18, Fair 12, Major Overpay 5, Slight Win 2, Strong Win 1 | **Overpay Risk 22, Fair 11, Slight Win 4, Strong Win 1 — "Major Overpay" disappeared entirely** | **Yes** |
| **Confidence distribution** | 40–50: 27, 50–60: 11 (tight, uniform) | **40–50: 9, 50–60: 10, 80–90: 19** — much wider, more differentiated | **Yes** |
| `lineupImpactScore` (individual rows) | Flat `0.1` for every row | Real, varying values (`0.5`, `0.1`, …) | **Yes** |
| `vorpScore` (individual rows) | Uniform per league (`0.68`/`0.32` clusters) | Now varies per trade (`0.32`, `0.49`, `0.30`, …) | **Yes** |

### 9.4 Confirmed real, not a wiring artifact

Checked directly against real backtest rows: `lineupImpactScore` is no longer pinned at `0.1` — it now shows real computed values (e.g. `0.5`), proof the `(hasLineupData || hasImpactData) && hasVorpData` gate (`trade-engine.ts` line 769) now activates, exactly as Phase 6 predicted it would once `vorpValue` was populated. `verdict` and `confidenceScore` now vary meaningfully row-to-row rather than clustering — the model's output is genuinely richer and more differentiated per real trade than before this phase.

### 9.5 Why `acceptProb` still didn't move, even though `verdict` did

This is the most interesting finding of this phase, reported precisely rather than glossed over. Tracing `computeTradeDrivers()`: `verdict` is derived from `computeVerdict(totalScore100)`, where `totalScore100` comes from the fairness/`score` computation that **does** consume `lineupImpactScore`/`vorpScore` (the 0.40/0.25/0.20/0.15-weighted composite at line 781) — this is exactly why verdict changed. `acceptProbability`, however, comes from a **separate** call, `computeSmartAcceptProbability()` (line 1701), which takes its own distinct set of inputs (`vorpDeltaResult.vorpDeltaThem`, `lineupDelta?.deltaThem`, etc.) — not `verdict`'s `score`/`totalScore100` at all. Both paths do consume lineup/VORP-derived signals, but through genuinely different computations — and for this specific 38-trade real sample, whatever `computeSmartAcceptProbability()` computes from the real per-trade `vorpDeltaThem`/`deltaThem` values landed on population-level numbers indistinguishable from before enrichment, even though individual rows' `acceptProb` do show minor real variation now (e.g. `0.22`, `0.29`, `0.21` in one 3-row sample, vs. more clustered values before).

**Honest limitation:** the exact Phase-6 rows were overwritten during re-ingestion (idempotent update, not versioned per-row history), so an exact per-row before/after diff isn't possible — only the aggregate distributions (§9.3, captured from each phase's own metrics run) can be compared. The population average landing on the same value despite real per-row movement is most plausibly explained by increases and decreases across the 38-trade sample roughly cancelling out, not by any structural invariant confirmed in this pass.

### 9.6 Does VORP enrichment change the low-acceptance finding? — No

The central Phase 5 finding — real accepted trades cluster at a striking ~0.2566 average predicted acceptance — is **unchanged** after both roster-context (Phase 6) and VORP (Phase 7) enrichment, even though both enrichments measurably improved replay fidelity (richer, more differentiated verdicts and confidence scores; the richer scoring branch now genuinely activates). This strengthens, rather than weakens, the two remaining candidate explanations from Phase 5 §3.1: survivorship bias (Sleeper's API never exposes rejected trades) and stale present-day valuations applied to historical trades. Both roster/lineup-context hypotheses have now been thoroughly tested and are no longer live candidates for explaining the acceptance-probability clustering specifically — though they clearly do matter for the model's fairness/confidence output, which is real, useful progress on this phase's actual goal (replay fidelity, not resolving the earlier puzzle).

---

## 10. Phase 8 — Acceptance Probability Audit: the definitive root cause

§9.5's "most plausibly explained by cancelling out" language is **superseded by this section** — Phase 8 traced the exact mechanism with source-level certainty and real diagnostic data, rather than leaving it as an inference.

**Full architectural analysis:** `docs/TRADE_ENGINE_ACCEPT_PROBABILITY_ARCHITECTURE_NOTE.md`.

### 10.1 Two confirmed, independent facts

1. **`computeSmartAcceptProbability()`'s `vorpDeltaThem` parameter (and, discovered in this pass, also `behaviorScore` and `marketScore`) are never read in the function body** — confirmed by direct source inspection (each appears exactly once, in its own parameter declaration). VORP data has *no code path at all* into `acceptProbability`, regardless of its value.
2. **The lineup-delta channel (`x1`/`x2`, from `deltaThem`/`needFitPPGThem`) is real and gated only on `hasLineupData`** — independent of `hasVorpData`. A read-only diagnostic re-run of `computeTradeDrivers()` against 6 real staging replay rows found `deltaThem = 0` in 5 of 6 — the counterparty's actual best-possible starting lineup simply doesn't change for these real dynasty bench-depth trades, on either side of the deal. This is a genuine property of the real trade population, not a broken pipeline.

Both facts are now proven by dedicated, unmocked tests against the real trade-engine (`__tests__/trade-engine/accept-prob-vorp-lineup-separation.test.ts`, 3 tests): varying `vorpValue` alone leaves `acceptProbability` byte-identical while `vorpScore` changes; constructing a roster where the trade *does* raise the counterparty's best lineup produces a *different* `acceptProbability` than one where it doesn't — proving the lineup channel is functional and the flat staging result is a data property, not a pipeline defect.

### 10.2 Intended architecture or a bug?

Reasoned assessment (not certain — see the architecture note §4 for full reasoning): more likely **incomplete/vestigial wiring than deliberate design**. `vorpDeltaThem` is computed for real and even exposed on the final result object for display, which is unusual plumbing for a value nobody consumes; the same unused-parameter pattern recurs for two more composite scores (`behaviorScore`, `marketScore`), suggesting a leftover calling convention rather than three independent deliberate omissions; and no comment anywhere in the codebase documents an intentional fairness-vs-acceptance separation, unlike every other deliberate design decision in this workstream.

### 10.3 No fix implemented — recommendation only

Per this phase's explicit scope, nothing was changed. If ever addressed, the smallest safe fix would be an additive `x8`/`w8` term inside `computeSmartAcceptProbability()`, mirroring how `x7`/`w7` (`isDeadlineWindow`) already extends the formula without disturbing `x1`–`x6` — not proposed for implementation now.

### 10.4 Recommended Phase 9

Not fixing the dead parameters — expanding the real-data evidence base first: ingest a larger, more diverse sample (especially active-roster trades, not just bench-depth dynasty churn) to see whether the lineup channel's real-world influence on `acceptProbability` is larger outside this specific bench-heavy sample. Only after that would a separate, explicitly-approved, ADR-governed phase be the right place to consider folding VORP into `acceptProbability` at all.

---

## 11. Phase 9 — Corpus Expansion + Two Confirmed Replay-Pipeline Bugs: the low-acceptance clustering was substantially a pipeline artifact

Phase 8 (§10) concluded `deltaThem = 0` for 5 of 6 sampled real trades was "a genuine property of the real trade population, not a broken pipeline." **This phase found that conclusion itself was confounded by two real bugs in the replay pipeline's own glue code** (never in `computeTradeDrivers()`, which was not modified) — both were found, fixed, and the fix was verified against real staging data before treating the new numbers as authoritative.

### 11.1 Corpus expansion

5 real Sleeper leagues were added to the original 3 (found via `settings.type` reconnaissance: `0`/`1` = redraft/keeper, `2` = dynasty — chosen because keeper/redraft rosters turn over far more than dynasty depth-hoarding, making non-zero `deltaThem` more likely): `$20 Pirate League` (64 trades), `Pirate League!` (83), `Jeepers Keepers!` (20), `KGBs On The Spectrum SF League` (17), `Beta 1 Zombie League` (16, true redraft). Total corpus: **38 → 238 real trades**, ingested via the same idempotent flow as Phase 4.

### 11.2 Bug 1 — Asset-ID namespace mismatch (found first, while building this expansion's comparison tooling)

`tradeBacktestExecutor.ts`'s `toAssets()` (traded assets) and `toRosterAssets()` (roster context) assigned **disjoint synthetic ID namespaces** (`replay-N` vs. `roster-N`) to the same real player depending on which array it appeared in. `computeLineupDelta()` matches give/receive against the roster by `Asset.id` to build the "after" roster — with mismatched IDs, the traded-away player was never recognized as present in the roster (never removed) and the received player was only ever appended, never substituted in place.

**Fix:** threaded the real, stable Sleeper player ID (or a deterministic pick ID for draft picks) through as a new `providerAssetId` field, from the normalizer's `ResolvedAsset` all the way to `Asset.id` construction in the backtest executor — the same ID now used consistently everywhere the same real player appears.

**Honest re-verification after this fix alone:** re-ran the diagnostic against 6 real staging rows — `deltaThem` was **still exactly 0** for all 6. This fix was real and necessary (the "after" roster computation now performs a genuine like-for-like substitution instead of a broken add-only distortion), but did not, by itself, overturn Phase 8's finding.

### 11.3 Bug 2 — `pos` was never threaded onto traded assets (found second, while writing the fix's regression test)

`TradeReplayPayload.assetsGiven`/`assetsReceived` never carried a `pos` field at all — the normalizer resolved it (`ResolvedAsset.pos`) but dropped it when constructing the payload, and the backtest executor's `toAssets()` never set it either. `computeBestLineupPPG()` only counts a player toward the best lineup if `a.pos` is set (`lib/trade-engine/trade-engine.ts` line 379). Since `computeLineupDelta()` appends `give`/`receive` directly into the "after" roster arrays, **every incoming player was structurally invisible to the lineup calculation** — the "after" roster could only ever lose value (from the departing player) or stay flat, never gain from the player being received. This alone is sufficient to explain a persistent bias toward `deltaThem <= 0` regardless of corpus composition.

**Fix:** added `pos?: string` to `TradeReplayPayload`'s asset shapes, threaded through the normalizer's payload construction and the executor's `toAssets()`, mirroring the `providerAssetId` fix.

**Verified end-to-end against the real, unmocked engine** (`__tests__/replay-framework/tradeBacktestExecutor.idConsistency.test.ts`, 2 tests): a real substitution (an elite player replacing a bench player at the matching roster ID) now produces a real, positive `deltaThem`; a genuine like-for-like swap (identical value/position) produces exactly `0` — proving the fix reflects reality rather than introducing a new artifact in either direction.

### 11.4 Full re-ingestion with the fixed pipeline — the corrected numbers

All 8 leagues were re-ingested in place (idempotent, same natural keys) with the fully-fixed pipeline, backfilling corrected `providerAssetId`/`pos`-bearing payloads and corrected `deltaThem`/`hasLineupData` backtest output onto all 238 rows.

| Metric | Original 3 leagues (38, pre-fix, Phase 8) | Original 3 leagues (38, post-fix) | New 5 leagues (200, post-fix) | Combined (238, post-fix) |
|---|---|---|---|---|
| Avg predicted acceptance | 0.2566 | **0.3468** | 0.3740 | 0.3697 |
| `deltaThem` = 0 (bench-depth) | ~100% (5/6 sampled) | 27/38 (71%) | 121/200 (61%) | 148/238 (62%) |
| `deltaThem` ≠ 0 (starter-involved) | ~0% | 11/38 (29%) | 79/200 (40%) | 90/238 (38%) |
| Avg acceptance, starter-involved | n/a (channel inert) | 0.55 | 0.57 | **0.5696** |
| Avg acceptance, bench-depth | n/a | 0.264 | 0.245 | **0.2482** |
| Fairness: Major Overpay | 0 (Phase 7, "disappeared entirely") | 2 | 16 | 18 |

### 11.5 Answer to Phase 9's core question

**Both, but not symmetrically — the original "uniformly low, clustered ~0.26" finding was substantially a pipeline artifact, not a real property of the trade population.** Once both bugs were fixed:

- **The lineup-delta channel is real, functional, and meaningfully influences `acceptProb`** — starter-involved trades score **~2.3x higher** predicted acceptance (0.57) than bench-depth trades (0.25), a large, consistent gap across both the original dynasty-heavy corpus and the newly-added keeper/redraft leagues. This directly contradicts Phase 8's characterization of the lineup channel finding as merely confirming a flat, inert population — the channel was inert in the data Phase 8 measured because that data was itself broken (Bug 2), not because the channel doesn't respond to real signal.
- **Corpus composition still matters, but less than expected:** even in leagues deliberately selected for likely lineup turnover (keeper/redraft, not dynasty), the majority of real trades (61%) are still bench-depth (`deltaThem = 0`) — most real fantasy trades, in any format, are throwaway/depth moves, not blockbuster starter-for-starter swaps. The corpus-composition hypothesis is confirmed as a real, contributing factor, just not as the dominant single explanation Phase 9 set out to test in isolation.
- **`vorpDeltaThem`/`behaviorScore`/`marketScore` remain genuinely dead parameters** (Phase 8 §10.1 fact 1 is untouched by this phase's findings — that was a pure source-code inspection, not measurement-dependent).

### 11.6 Recommended Phase 10

Given the lineup-delta channel is now confirmed both functional and meaningful, and a genuine ~38% starter-involved / 62% bench-depth split exists in real data: the natural next step is deciding whether to fold VORP into `acceptProbability` (Phase 8 §10.3's proposed additive `x8`/`w8` term) now has a real, non-confounded empirical basis to justify or reject it — this was not true before this phase, since the measurement instrument itself was broken. This remains a model-change decision requiring its own explicit approval and ADR, not something this phase authorizes.

---

## Files changed in this session

- `lib/replay-framework/metrics/tradeReplayMetrics.ts` (Phase 5, new)
- `__tests__/replay-framework/tradeReplayMetrics.test.ts` (Phase 5, new, 9 tests)
- `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` (this document — Phase 5 new, updated with §8, §9, then §10)
- `lib/replay-framework/types.ts` (Phase 6 — additive: `TradeReplayRosterAsset`, `proposerRoster`/`counterpartyRoster` on `TradeReplayPayload`; Phase 7 — additive `vorpValue` on every asset shape)
- `lib/replay-framework/normalize/sleeperTradeNormalizer.ts` (Phase 6 — resolves full real rosters, adds position resolution; Phase 7 — computes real `vorpValue` via the VORP resolver)
- `lib/replay-framework/backtest/tradeBacktestExecutor.ts` (Phase 6 — builds and passes a real `rosterCtx`; Phase 7 — threads `vorpValue` onto every `Asset`)
- `lib/replay-framework/ingest/ingestSleeperTradesForLeague.ts` (Phase 6 — passes `league.roster_positions` through)
- `lib/replay-framework/valuation/vorpResolver.ts` (Phase 7, new — reuses `computePlayerVorp()`, derives a real `LeagueRosterConfig`)
- `__tests__/replay-framework/{sleeperTradeNormalizer,tradeBacktestExecutor,ingestSleeperTradesForLeague}.test.ts` (Phase 6 — 7 new tests; Phase 7 — 3 more added)
- `__tests__/replay-framework/vorpResolver.test.ts` (Phase 7, new, 6 tests)
- `docs/TRADE_ENGINE_ACCEPT_PROBABILITY_ARCHITECTURE_NOTE.md` (Phase 8, new — the full architectural note)
- `__tests__/trade-engine/accept-prob-vorp-lineup-separation.test.ts` (Phase 8, new, 3 tests against the real, unmocked trade-engine)
- `docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md` (updated with a pointer to this report; Phase 9 — updated again with §10.9)
- `lib/replay-framework/types.ts` (Phase 9 — additive: `providerAssetId` on `TradeReplayRosterAsset`/`TradeReplayPayload` assets; `pos` on `TradeReplayPayload`'s `assetsGiven`/`assetsReceived`; `hasLineupData`/`deltaThem` on `TradeBacktestOutput`)
- `lib/replay-framework/normalize/sleeperTradeNormalizer.ts` (Phase 9 — threads `providerAssetId` and `pos` through payload construction)
- `lib/replay-framework/backtest/tradeBacktestExecutor.ts` (Phase 9 — fixes `toAssets()`/`toRosterAssets()` to use `providerAssetId` and `pos`; persists `hasLineupData`/`deltaThem`)
- `lib/replay-framework/metrics/tradeReplayMetrics.ts` (Phase 9 — adds `providerLeagueIds` filter parameter, `deltaThemDistribution`, starter-involved/bench-depth breakdown)
- `__tests__/replay-framework/tradeReplayMetrics.test.ts` (Phase 9 — 4 new tests)
- `__tests__/replay-framework/tradeBacktestExecutor.idConsistency.test.ts` (Phase 9, new, 2 tests against the real, unmocked trade-engine, proving both bug fixes end-to-end)

No trade-engine file was modified at any phase. No calibration math, threshold, or weight was changed. Phase 9 re-ingested all 8 leagues (238 rows) into `ReplayImport`/`ReplayBacktestResult` only, via the same idempotent flow already used and approved in Phase 4/9 — `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` counts remained `0` after. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
