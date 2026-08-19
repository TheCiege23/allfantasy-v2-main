# Trade Engine — Why VORP/Roster Enrichment Changes Verdict/Confidence but Not `acceptProbability`

**Status:** Architectural note only. No trade-engine code changed. No calibration, scoring, or model behavior modified. Produced by Decision OS Replay Framework Phase 8, but the finding is about `lib/trade-engine/trade-engine.ts` itself, not the replay pipeline.
**Branch:** `g15-event-foundation`
**Origin:** discovered while investigating why Phase 6 (roster context) and Phase 7 (VORP enrichment) both measurably improved replay fidelity — richer `verdict`, wider `confidenceScore` distribution, real varying `lineupImpactScore` — yet left `computeTradeDrivers()`'s `acceptProbability` byte-identical across all 38 real staging trades in every phase (`docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` §8–9).

---

## 1. The one-sentence answer

`computeTradeDrivers()` computes **two structurally separate scores** — `verdict` (from a fairness/`score` composite that genuinely blends `lineupImpactScore`, `vorpScore`, `marketScore`, `behaviorScore`) and `acceptProbability` (from an independent logistic model, `computeSmartAcceptProbability()`, that takes its own raw inputs) — and the second one **does not read three of the pre-computed composite scores it's handed** (`vorpDeltaThem`, `behaviorScore`, `marketScore` are all passed as parameters and never referenced in the function body), confirmed by direct source inspection, not inferred from behavior.

## 2. Complete input → output map

| Signal | → Verdict/fairness (`score`) | → Confidence | → `acceptProbability` |
|---|---|---|---|
| `Asset.vorpValue` (give/receive) | **Yes** — `computeVorpDelta().vorpScore`, weighted 0.20–0.35 into `score` | Indirectly — `hasVorpData` is a data-completeness flag | **No** — `vorpDeltaThem` param unused in `computeSmartAcceptProbability()`'s body |
| `Asset.marketValue`/`value` (give/receive) | **Yes** — `marketScore`, weighted 0.20–0.35 into `score` | Indirectly — market-data availability | **Yes, but via a separate recomputation** — the raw `marketDeltaPct` feeds `x3` directly; the pre-computed `marketScore` parameter is itself unused |
| `rosterCtx` (rosters + `roster_positions`) | **Yes** — `lineupImpactScore`, weighted 0.25–0.47 into `score` (only in the `hasVorpData`-gated "full" mode; a separate `starterRatio` proxy is used otherwise) | **Yes** — `hasLineupData` is confidence's single largest data-completeness signal | **Yes** — `deltaThem`/`needFitPPGThem` (`x1`/`x2`), gated only on `hasLineupData` — independent of `hasVorpData` |
| `fromManager`/`toManager` (`ManagerProfile`) | **Yes** — `behaviorScore` via `computeBehaviorScore()`, weighted 0–0.15 into `score` | Indirectly — `hasBehaviorData` flag | **No** directly (the passed `behaviorScore` parameter is unused) — but a *separate* behavioral signal (`x6`, via `computeManagerAlign()` reading `toTendency`/`allTendencies`) does feed it |
| `fromTendency`/`toTendency`/`allTendencies` (`ManagerTendencyData`) | **No** — never passed to `computeFairnessScore()` at all | No | **Yes** — the richest single input (`x6`, sample-size-weighted manager/league tendency alignment) |
| `isDeadlineWindow` | No | No | **Yes** — `x7`, a flat bonus when a deadline window coincides with the opponent gaining PPG |
| `calibratedWeights` (`b0`, `w1`–`w7`) | No — verdict/fairness uses fixed internal weights, unrelated to calibration | No | **Yes** — directly scales every `x1`–`x7` term and the intercept |

## 3. Why this matters for the replay-fidelity work (Phases 6–7)

Both roster context (Phase 6) and VORP (Phase 7) enrichment genuinely improved the *verdict/confidence* path — this table shows exactly why: both `rosterCtx` and `Asset.vorpValue` are real, consumed inputs to `score`/`totalScore100`/`verdict`. But VORP has **no channel at all** into `acceptProbability` (row 1), and roster context's channel into `acceptProbability` (row 3, `deltaThem`/`needFitPPGThem`) happened to compute to exactly `0` for the majority of the 38 real staging trades sampled — not because the channel is broken, but because these are real dynasty bench-depth trades where the traded assets don't change either side's actual best-possible starting lineup. Both of these are now proven with dedicated, unmocked tests against the real engine (`__tests__/trade-engine/accept-prob-vorp-lineup-separation.test.ts`) rather than inferred from the staging measurement alone:

- Varying `vorpValue` alone, holding everything else fixed, leaves `acceptProbability` byte-identical while `vorpScore` changes — proving the dead-parameter finding directly.
- Constructing a counterparty roster where the traded asset *does* raise the best-possible lineup (a real, non-zero `deltaThem`) produces a *different* `acceptProbability` than a roster where it doesn't — proving the lineup channel is real and functional, and that the flat result measured in staging is a property of that specific real trade population, not a broken pipeline.

## 4. Is this intended architecture or a bug?

**Assessment, stated as a reasoned judgment, not a certainty:** this looks more like **incomplete/vestigial wiring than a deliberate design choice**, for three reasons:

1. `vorpDeltaThem` is computed for real (via `computeVorpDelta()`), threaded all the way through the call site, and even exposed on the final `TradeDriverData.vorpDelta` result for display — this is a lot of deliberate plumbing for a value nobody consumes internally. If VORP's exclusion from acceptance probability were an intentional design decision, it would be unusual to still carry the value this far.
2. It is not just VORP — `behaviorScore` and `marketScore` (two more pre-computed composite scores) are *also* passed into `computeSmartAcceptProbability()` and never read, while the function separately re-derives its own, narrower behavioral (`x6`) and market (`x3`, from raw `marketDeltaPct`) signals from scratch. This is a consistent pattern (three unused composite-score parameters, all superseded by the function's own raw-delta recomputations), which reads more like a leftover calling convention from an earlier refactor than three independent, deliberate omissions.
3. No comment, docstring, or existing document anywhere in the repository explains an intentional separation between "fairness scoring" and "acceptance likelihood" inputs — every other deliberate design choice in this codebase (e.g., the `vetoed`/`cancelled` → `UNKNOWN` mapping in the Trade Learning capture ADR, or the `conservative_roster_pattern` completeness guard) is explicitly documented at the point of decision. The absence of any such note here is itself weak evidence against intent.

**This is not certain — it is a reasoned leaning, not a proven fact**, since the original design intent cannot be verified without the author. This note documents the finding precisely and does not resolve the ambiguity by guessing.

## 5. Recommendation — do not fix yet

Per this phase's explicit scope, no fix is proposed or implemented. If a future phase decides to address this, the **smallest safe change** would be: inside `computeSmartAcceptProbability()`, fold the existing (already-computed, already-passed) `vorpDeltaThem` into a new `x8` term the same way `x1`–`x7` are already structured (clamped, weighted by a new `w8` calibrated coefficient, defaulted to a conservative value) — additive to the formula, not a replacement of any existing term, mirroring exactly how `x7`/`w7` (`isDeadlineWindow`) was evidently added at some point without disturbing `x1`–`x6`. This is *not* recommended for implementation now — it is recorded here so a future, explicitly-scoped and separately-approved phase does not have to re-derive it, exactly as this workstream's ADR-first discipline requires for any change touching calibration math.

## 6. Recommended next validation step (Phase 9)

Since this is very likely intended-vs-incomplete rather than a live-traffic-affecting bug (the flag is disabled everywhere, and this affects prediction quality, not calibration correctness), the highest-leverage next step is **not** fixing the dead parameters — it's expanding the real-data evidence base before any model change is even considered:

1. Ingest a larger, more diverse real trade sample (per the still-open item from Phases 1/5/6/7) — specifically including leagues/trades where `deltaThem` is more likely to be genuinely non-zero (active-roster trades, not just bench-depth dynasty churn), to see whether the lineup channel's real-world influence on `acceptProbability` is larger in a less bench-heavy sample.
2. If a larger sample still shows negligible lineup-driven movement in `acceptProbability`, that would be stronger evidence the model is dominated by `x6` (manager tendency alignment) for real trades — worth knowing before any recalibration work.
3. Only after both of the above: consider, as a separate, explicitly-approved, ADR-governed phase, whether folding VORP into `acceptProbability` (§5's sketch) is worth the calibration-math risk — not as a default follow-up to this note.

---

## Files changed in this session

- `docs/TRADE_ENGINE_ACCEPT_PROBABILITY_ARCHITECTURE_NOTE.md` (this document, new)
- `__tests__/trade-engine/accept-prob-vorp-lineup-separation.test.ts` (new, 3 tests, run against the real, unmocked trade-engine)
- `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` (updated with a pointer to this note)

No trade-engine file was modified. No calibration math, threshold, or weight was changed. No database (staging or production) was written to this session — one read-only diagnostic script was run against staging's existing replay corpus to confirm real `lineupDelta`/`vorpDelta` values, no writes. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
