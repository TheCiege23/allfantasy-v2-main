# Decision OS Replay Framework Phase 10 — VORP-to-Acceptance ADR & Controlled Model Proposal

**Status:** ADR / proposal only. No trade-engine code changed. No calibration math, weight, or threshold changed. No shadow calibration enabled. No writes to `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats`. All simulation described below is read-only, in-process recomputation against the real, unmodified `computeTradeDrivers()`/`getCalibratedWeights()` — the same reads any live trade-evaluation route already performs.
**Branch:** `g15-event-foundation`
**Data source:** the real, 238-trade replay corpus (8 leagues) built and corrected in Phase 9 (`docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` §11).
**Builds on:** `docs/TRADE_ENGINE_ACCEPT_PROBABILITY_ARCHITECTURE_NOTE.md` (Phase 8's architectural note — its input→output map and dead-parameter finding are reused, not redone, below).

---

## 1. Why this phase exists

Phase 8 found `computeSmartAcceptProbability()` never reads `vorpDeltaThem`, `behaviorScore`, or `marketScore`, and measured `deltaThem = 0` for 5 of 6 sampled real trades — read at the time as "the lineup channel is real but this real trade population happens to be bench-depth-heavy." Phase 9 found that second half of the reading was itself confounded by two real replay-pipeline bugs (fixed), and that once fixed, the lineup channel responds strongly to real signal: starter-involved trades (38% of the real, corrected 238-trade corpus) average **0.57** predicted acceptance vs. **0.25** for bench-depth trades. That result changes the calculus for this phase's question — it is no longer "the channel is real but the data can't test it," it's "the channel works; does adding VORP on top of it make the model better or just noisier?" This phase answers that with a read-only simulation against the corrected corpus, not a guess.

---

## 2. Audit of the current `acceptProbability` formula (post-Phase-9)

`computeSmartAcceptProbability()` (`lib/trade-engine/trade-engine.ts` line 1426) is unchanged by Phase 9 — the fixes were entirely in the replay pipeline's asset construction, not in this function. Its formula, unmodified:

```
z = b0
  + w1 * x1   (deltaThem / 3.0, clamped [-2,2])           -- real, gated on hasLineupData
  + w2 * x2   (needFitPPGThem / 2.0, clamped [-2,2])       -- real, gated on hasLineupData
  + w3 * x3   (-marketDeltaOppPct / 12, clamped [-2,2])    -- real, raw market delta (not the pre-computed marketScore)
  + w4 * x4   (deal shape: give.length - receive.length)   -- real
  + w5 * x5   (weighted volatility delta)                  -- real
  + w6 * x6   (manager/league tendency alignment)           -- real, richest single input per Phase 8
  + w7 * x7   (deadline-window bonus)                        -- real

probability = clamp(sigmoid(z), 0.02, 0.95)
  then a hard cap (<=0.20) if deltaThem <= -1.0 and marketDeltaOppPct < 15
  then a soft cap (<=0.35) if marketDeltaOppPct <= -25 and needFitPPG < 0.75
  then calibrateAcceptProbability() applies an isotonic remap (if a fitted map exists in TradeLearningStats)
```

Confirmed unread, by direct source inspection (each name appears exactly once, in its own parameter declaration): `vorpDeltaThem`, `behaviorScore`, `marketScore`. This is unchanged from Phase 8 and is not affected by anything measured this phase.

By contrast, `verdict`/`totalScore100` comes from a **separate** function, `computeFairnessScore()` (line 721), whose `score` composite genuinely blends `lineupImpactScore` (0.25–0.47 weight, mode-dependent), `vorpScore` (0.20–0.35), `marketScore` (0.20–0.35), and `behaviorScore` (0–0.15) — this is the path VORP/roster/market enrichment actually improved in Phases 6–7. `acceptProbability` and `verdict` are computed from the same underlying `give`/`receive`/`rosterCtx` but through genuinely disjoint formulas.

---

## 3. Signals affecting `acceptProb` vs. `verdict`/`confidence` (updated from Phase 8's table)

| Signal | → `verdict`/fairness `score` | → `confidenceScore` | → `acceptProbability` |
|---|---|---|---|
| `Asset.vorpValue` | Yes (`vorpScore`, 0.20–0.35 weight) | Indirect (`hasVorpData` completeness flag) | **No** — `vorpDeltaThem` param dead |
| `Asset.marketValue`/`value` | Yes (`marketScore`, 0.20–0.35 weight) | Indirect | Yes, but via raw `marketDeltaPct` recomputed independently — the passed `marketScore` param is dead |
| `rosterCtx` (rosters + `roster_positions`) | Yes (`lineupImpactScore`, 0.25–0.47 weight, "full" mode only) | Yes — largest completeness signal | Yes — `x1`/`x2` (`deltaThem`/`needFitPPGThem`), gated only on `hasLineupData`, **now confirmed (Phase 9) to carry real, substantial signal** — not the near-inert channel Phase 8's sample suggested |
| `fromManager`/`toManager` | Yes (`behaviorScore`, 0–0.15 weight) | Indirect | No directly (`behaviorScore` param dead) — but a separate `x6` (`computeManagerAlign()`) does feed it |
| `toTendency`/`allTendencies` | No — never passed to `computeFairnessScore()` | No | Yes — richest single input (`x6`) |
| `isDeadlineWindow` | No | No | Yes — `x7` |
| `calibratedWeights` | No | No | Yes — scales every term |

**What changed since Phase 8:** the `rosterCtx` row. Phase 8 characterized the lineup-delta channel's real-world contribution as negligible based on a 6-row sample that was, unknown at the time, structurally incapable of ever showing a positive `deltaThem` (Phase 9 §11.3's `pos`-threading bug). The corrected 238-row measurement shows this channel is the single largest driver of real variation in `acceptProbability` currently reaching production logic: a ~2.3x gap between starter-involved and bench-depth trades.

---

## 4. Should `vorpDeltaThem`/`behaviorScore`/`marketScore` remain unused? — evaluated per-signal, not as a block

### 4.1 `marketScore` — yes, safely dead; the raw recomputation is arguably better

`x3` already reads raw `marketDeltaPct` directly, at a different scale/shape (`/12`, no tanh compression) than `marketScore` (`0.50 + 0.15*tanh(marketDeltaPct/20)`). Folding the pre-computed `marketScore` in addition to `x3` would be closer to redundant than complementary — both derive from the identical underlying `marketDeltaPct`. **No case for change here.**

### 4.2 `behaviorScore` — yes, safely dead; `x6` is already the richer version of the same concept

`x6` (`computeManagerAlign()`) already reads `toTendency`/`allTendencies` — real per-manager/league behavioral data — and is the single richest input to `acceptProbability` per Phase 8. The passed `behaviorScore` parameter is a coarser, `ManagerProfile`-level proxy computed by `computeBehaviorScore()` for the *fairness* score, not a different signal `x6` is missing. **No case for change here.**

### 4.3 `vorpDeltaThem` — the only genuinely contested case; addressed by simulation below

Unlike the other two, `vorpDeltaThem` is not obviously redundant with an existing `x` term the way `marketScore`/`behaviorScore` are — it measures replacement-value (talent quality), not lineup slot occupancy (`deltaThem`) or market consensus (`x3`) or manager behavior (`x6`) directly. Whether it carries *independent* information from `deltaThem`, or is largely a repackaging of the same underlying "did the counterparty's roster get better" signal, is an empirical question — answered in §5.

---

## 5. Read-only simulation against the 238-row corpus

**Method:** for each of the 238 real replay rows, the real, unmodified `computeTradeDrivers()` was recomputed in-process (same real `give`/`receive`/`rosterCtx` Assets, same real `calibratedWeights` read via `getCalibratedWeights()`) to get the real, pre-calibration `acceptProbability` and the real `vorpDelta.vorpDeltaThem`/`lineupDelta.deltaThem`. A hypothetical `x8 = clamp(vorpDeltaThem / 3.0, -2, 2)` was defined — mirroring `x1`'s own `/3.0` scaling, justified because `vorpDeltaThem` is already expressed in the same weekly-PPG-like units as `deltaThem` (`VORP_SEASON_SCALE = 850`, "converts vorpValue back to weekly PPG VORP," per the existing source comment). Since `probability = sigmoid(z)`, `logit(p)` recovers `z` exactly for any row not truncated by a cap, letting `p' = sigmoid(logit(p) + w8 * x8)` be computed for several candidate `w8` values without needing to reimplement or modify the real formula.

**Disclosed limitation:** 4 of 238 rows hit the hard probability cap (`deltaThem <= -1.0 and marketDeltaOppPct < 15`) and were excluded from the logit-shift analysis (their returned probability no longer equals `sigmoid(z)`, so recovering `z` via `logit()` would be wrong for those rows specifically). The soft cap cannot be detected from outside the function (`needFitPPG` isn't exposed on the public result type) — a residual, disclosed approximation affecting an unknown but likely small subset of the corpus.

### 5.1 Double-counting check — the central empirical finding

**Pearson correlation(`deltaThem`, `vorpDeltaThem`) across all 238 real rows: 0.7397.**

This is a strong positive correlation. It means a substantial majority of `vorpDeltaThem`'s variation is already captured by `deltaThem` (which already drives `x1`) — `r² ≈ 0.547`, i.e., roughly 55% of `vorpDeltaThem`'s variance is explainable by `deltaThem` alone. The remaining ~45% is independent variation (talent-quality differences not reflected in lineup-slot PPG — e.g., a bench upgrade at a deep position vs. a thin one), which is real but a minority share of the signal.

### 5.2 Simulated `acceptProbability`, before vs. after, at four candidate `w8` weights

(234 uncapped rows; "before" values differ slightly from Phase 9's reported 0.3697/0.5696/0.2482 because those excluded the 4 capped rows from this specific comparison set — the delta from excluding 4 rows is immaterial, ~0.006.)

| `w8` | Avg acceptProb (all) | Avg acceptProb (starter-involved) | Avg acceptProb (bench-depth) | Mean \|shift\| per row | Max single-row shift |
|---|---|---|---|---|---|
| 0 (real, baseline) | 0.3753 | 0.5940 | 0.2482 | — | — |
| 0.25 | 0.3812 | 0.6321 | 0.2353 | 0.0411 | 0.1243 |
| 0.50 | 0.3877 | 0.6626 | 0.2279 | 0.0763 | 0.2448 |
| 0.85 (= `w6`'s value) | 0.3957 | 0.6909 | 0.2241 | 0.1145 | 0.4010 |
| 1.25 (= `w1`'s value) | 0.4018 | 0.7066 | 0.2247 | 0.1442 | 0.5508 |

**Reading these numbers:** every candidate weight widens the starter-involved/bench-depth gap that already exists in the real (unmodified) model — at `w8 = 1.25`, starter-involved acceptance would rise to a striking 0.71 average, a >0.11 absolute jump from the real 0.594. Because of §5.1's 0.74 correlation, most of this movement is amplifying a signal `x1` already provides, not adding new information — the ~45% independent-variance share is real, but a naive `w8` sized to match the other weights (`w1`=1.25, `w6`=0.85) would let that correlated majority dominate the shift, i.e., a real double-counting effect, quantified rather than assumed.

---

## 6. Risks

**Overfitting to completed trades.** All 238 real trades in this corpus reached `status: complete` (Phase 1's finding, reconfirmed at every phase) — there is no real `REJECTED`/`COUNTERED` comparison group. Any weight chosen by fitting to "what acceptProb should have been" on this corpus would be fitting to a population that, by construction, only contains trades both sides already agreed to — the same survivorship-bias caveat from Phase 5 §3.1, unresolved and unaddressed by this phase.

**Survivorship bias compounds with double-counting.** If a future calibration pass tried to *learn* `w8` from this corpus (e.g., via `calibrateFromFeedback()`), it would be learning to predict "did trades that already happened, happen" using a feature (`vorpDeltaThem`) that's 74%-correlated with a feature already in the model (`deltaThem`) — a textbook setup for an unstable, overfit coefficient, not a genuine improvement.

**Stale historical valuation.** Every backtest values assets using today's FantasyCalc snapshot, not a point-in-time valuation from when the trade occurred (Phase 5 §3.1 item 3, unresolved). `vorpValue` is derived from the same present-day snapshot — adding a VORP-based term does not fix this, and could make a stale-valuation artifact *more* influential on `acceptProbability` than it already is on `verdict`.

**Double-counting lineup impact, quantified.** §5.1's 0.74 correlation and §5.2's amplified starter/bench gap are direct, measured evidence of this risk — not a theoretical concern. Any `w8` large enough to matter (per the "smallest safe additive term" sketch in Phase 8 §5) would need to be small enough to only capture the ~45% independent-variance share, which is a much narrower, more conservative choice than mirroring `w1`/`w6`'s magnitude.

**Calibration-feedback asymmetry.** `getCalibratedWeights()` only applies live feedback adjustment (`feedbackAdj`) to `w1`, `w2`, `w3`, `w6` — `w4`, `w5`, `w7` (and any future `w8`) are not currently eligible for that adjustment loop at all (`lib/trade-engine/accept-calibration.ts` lines 382–388). A new `w8` would need this question answered explicitly (should it be feedback-adjustable like `w1`/`w2`/`w3`/`w6`, or fixed like `w4`/`w5`/`w7`?) as part of any real implementation — not decided by this phase.

---

## 7. Recommendation

**Defer any model change until a larger, more diverse corpus exists — do not add a VORP term now.**

Reasoning, weighing all four options against the evidence above:

- **Keep current formula** — closest to correct for `marketScore`/`behaviorScore` (§4.1, §4.2: genuinely, safely redundant with richer existing terms — no case to add them).
- **Add VORP term** — not recommended yet. §5.1's 0.74 correlation is real evidence of a meaningful double-counting risk, not merely a theoretical one; §5.2 shows any calibration-comparable weight would substantially re-emphasize a signal `x1` already provides. The ~45% independent-variance share is a genuine, non-trivial argument *for* eventually adding a term, but sizing it correctly requires more than a single corpus snapshot with unresolved survivorship bias.
- **Add behavior/market terms** — not recommended (§4.1, §4.2).
- **Defer until larger corpus** — **recommended**. The corpus itself just changed size (3→8 leagues) and quality (two real bugs fixed) in the immediately preceding phase; the 0.74 correlation and the amplification pattern in §5.2 are the first real measurement of this specific question, not a converged, stable estimate. A future phase should re-run this exact simulation methodology (§5) against a further-expanded corpus, ideally with more redraft-format leagues (higher real lineup turnover, per Phase 9 §11.1's leagues) before treating either the correlation or the candidate-weight table as settled enough to justify a calibration-math change.

If a future phase does proceed, the smallest defensible next step (not authorized by this phase) would be a `w8` sized well below `w1`'s magnitude — informed by the ~45% independent-variance share, not the full correlation-inclusive signal — and evaluated with a partial-correlation or residual-based analysis (regressing `vorpDeltaThem` on `deltaThem` and using the residual, rather than raw `vorpDeltaThem`, as `x8`) to more precisely isolate VORP's non-redundant contribution. That refinement is recorded here as a idea, not implemented.

---

## 8. Recommended Phase 11

1. **Do not implement §7's deferred model change** without a new, separately-approved, ADR-governed phase.
2. **Continue corpus expansion**, prioritizing genuinely redraft-format leagues (Phase 9 found even keeper/redraft leagues are 61% bench-depth — true redraft leagues, which reset rosters yearly, may show a different, more informative split).
3. **If pursued later:** implement the residual-based `x8` sketch (§7) as its own explicitly-scoped phase, with a fresh simulation re-run first to confirm the correlation/amplification pattern found here still holds on the larger corpus.
4. **Independently of any model decision:** the calibration-feedback-eligibility question for a hypothetical `w8` (§6, last risk) should be resolved in that same future ADR, not assumed either way.

---

## Files changed in this session

- `docs/DECISION_OS_VORP_ACCEPTANCE_ADR.md` (this document, new)

No trade-engine file was modified. No calibration math, threshold, or weight was changed. No shadow calibration was enabled. No database (staging or production) was written to — one read-only simulation script was run against staging's existing, already-corrected (Phase 9) replay corpus, performing only `ReplayImport.findMany`, `getCalibratedWeights()` (a read), and in-process recomputation via the real, unmodified `computeTradeDrivers()`; `TradeOfferEvent`/`TradeOutcomeEvent`/`TradeLearningStats` counts were reconfirmed at 0 immediately after. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
