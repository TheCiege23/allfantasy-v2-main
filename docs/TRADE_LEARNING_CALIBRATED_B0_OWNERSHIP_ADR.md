# ADR — Trade Learning: `TradeLearningStats.calibratedB0` Ownership

**Status:** Proposed. Not implemented. No source code changed in this session.
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` §7 Step 0, `docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md` (§4 "Secondary, non-blocking-but-relevant finding" and §6 item 3), commit `34a0d4fa8` (fixed the `TradeOutcome` enum case-mismatch bug that was the *primary* activation blocker).
**Constraint honored:** this document does not activate `runWeeklyRecalibration()`, add cron wiring, change any public API, touch Decision OS, or delete any trade-learning file/export. It is a design decision record only.

## Why an ADR and not a one-line fix

The enum-mismatch bug fixed in `34a0d4fa8` was a pure defect — one correct behavior, one broken implementation, no judgment call. This is different: four architecturally distinct answers all "work" in the sense that none of them crash or corrupt data, and the correct choice depends on a product decision this document cannot make unilaterally (see "Why this is not obvious" below). That is exactly the kind of change this workstream has consistently required an ADR for before touching calibration logic (precedent: `docs/adr/ADR_DECISION_OS_PHASE6_DNA_CONSERVATIVE_ROSTER_PATTERN_COMPLETENESS_GUARD.md`, written for a comparably well-understood but judgment-requiring fix). No code is changed pending review of this document.

---

## 1. Problem statement

`TradeLearningStats.calibratedB0` — the intercept term read by every live trade-acceptance-probability calculation via `getCalibratedWeights()` — has **two independent write paths** that were built at different times, serve different philosophies of "what calibration means," and have never been reconciled:

1. `calibrateInterceptFromOutcomes()` (`lib/trade-engine/accept-calibration.ts:90`) — **reachable today**, but calibrates toward a hardcoded constant, not real outcomes.
2. `promoteShadowB0()` (`lib/trade-engine/auto-recalibration.ts:225`), fed by `computeShadowB0()` — **correct** (confirmed by the enum fix in `34a0d4fa8`) but **fully orphaned**, reachable only through `runWeeklyRecalibration()`, which has zero callers anywhere in the codebase.

Today there is no actual conflict, because path 2 never runs. The conflict is entirely latent, and would activate the moment anything calls `runWeeklyRecalibration()` on a schedule — which is precisely what `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` §7 Step 0 recommends doing next. This ADR exists so that decision is made deliberately, before that activation, rather than discovered by surprise afterward.

---

## 2. Audit of both write paths

### Path A — `calibrateInterceptFromOutcomes()` (reachable, hardcoded-constant)

| | |
|---|---|
| **When it runs** | Only when `POST /api/internal/analyze-trades` is manually invoked (`x-internal-key` header check against `SESSION_SECRET`; **not present in `vercel.json`'s cron list** — confirmed, no automatic trigger exists) → `runBackgroundTradeAnalysis()` (`lib/trade-learning.ts:552`) → `runFullCalibration()` (`accept-calibration.ts:435`) → this function (`accept-calibration.ts:443`, its only caller). |
| **Input** | `LeagueTrade` rows where `analyzed: true` and `analysisResult`/`valueGiven`/`valueReceived` are populated (≥30 required, `MIN_CALIBRATION_SAMPLE`). **Does not read `TradeOutcomeEvent` at all**, despite its name. It reconstructs each trade's *predicted* acceptance probability from value differentials using its own local `reconstructAcceptProb()` (current `calibratedB0` + hardcoded `FEATURE_WEIGHTS`), averages that across all analyzed trades, then shifts `calibratedB0` so the model's own average output converges toward `const OBSERVED_ACCEPT_RATE = 0.85` (`accept-calibration.ts:8`) — a fixed assumption, not a measurement. |
| **What it writes** | `TradeLearningStats.calibratedB0`, `.calibrationSampleSize`, `.calibrationHistory` (entry tagged `source: 'outcome'` — a misleading label, since no outcome data is read). |
| **Live readers of the result** | `getCalibratedWeights()` (`accept-calibration.ts:354`), consumed by 8 real call sites: `server/api-route-modules/legacy/trade/{quick-evaluate,league-analyze,goal-proposals,analyze}/route.ts`, `lib/trade-value-console/runTradeConsoleAnalysis.ts`, `lib/trade-engine/core-engine.ts`, `app/api/trade-evaluator/route.ts`, `app/api/instant/trade/route.ts`. |
| **Should this path continue to exist?** | Not as a `calibratedB0` writer. It is not measuring anything real — "calibration toward a fixed constant we assumed" is a tuning knob, not learning. Its sibling, `calibrateFromFeedback()` (same file, also called by `runFullCalibration()`), is genuinely real (reads actual `TradeFeedback` votes) and is unaffected by anything in this ADR — only the *intercept* half is in question. |

### Path B — `promoteShadowB0()` / `computeShadowB0()` (orphaned, real-outcome)

| | |
|---|---|
| **When it runs** | Never in production today. Only reachable via `runWeeklyRecalibration()` (`auto-recalibration.ts:406`), which has exactly one reference repo-wide (its own definition) — confirmed by repo-wide grep, not inference. |
| **Input** | Real `TradeOutcomeEvent` rows (≥30, `MIN_RECALIBRATION_SAMPLE`), matched via `offerEventId` to the `TradeOfferEvent.acceptProb` originally predicted. `computeObservedAcceptRate()` (fixed in `34a0d4fa8`) now correctly labels `ACCEPTED=1`, `REJECTED`/`EXPIRED=0`, excludes `COUNTERED`/`UNKNOWN`. The shadow value is held for a 7-day maturity window (`SHADOW_MATURITY_DAYS`) and only promoted if it diverges from the currently active `calibratedB0` by ≤0.40 (`MAX_SHADOW_DIVERGENCE`). |
| **What it writes** | On promotion: the *same* `TradeLearningStats.calibratedB0` field, plus `.calibrationSampleSize` and a `.calibrationHistory` entry tagged `source: 'auto-recalibration'` (a third history-source value, not covered by `accept-calibration.ts`'s own local `CalibrationHistoryEntry.source: 'outcome' | 'feedback'` type — a minor, pre-existing type-consistency gap, noted for whoever implements this ADR's recommendation). Also clears the `shadowB0*` staging fields. |
| **Live readers of the result** | Identical to Path A — same field, same `getCalibratedWeights()`, same 8 call sites — since both paths write the one field those readers consume. |
| **Should this path continue to exist?** | Yes — this is the only mechanism in the codebase that measures real outcomes with proper statistical safety (sample gates, maturity delay, divergence cap). It is the intended long-term owner of `calibratedB0`. |

### A third, related-but-separate orphaned piece (found during this audit, not part of the conflict)

`lib/trade-engine/calibration-metrics.ts` reads `TradeLearningStats.isotonicMapJson`/`.isotonicComputedAt`/`.isotonicSampleSize` to compute reliability-curve/ECE/Brier-score health metrics — but has **zero callers anywhere in the codebase** (confirmed by grep). It doesn't write `calibratedB0` and isn't part of this ownership decision, but it's worth flagging: it's a third piece of this same subsystem built for observability and never wired to a dashboard or route. Out of scope for this ADR; noted for whoever eventually activates the full pipeline.

---

## 3. Why this is not obvious enough to fix unilaterally

Every option below is technically buildable today. None is a clear, no-tradeoff "obvious fix":

| Option | What it means | Why it's not simply "the answer" |
|---|---|---|
| **(a) Keep hardcoded-constant path only** | Never activate `runWeeklyRecalibration()`; leave `calibrateInterceptFromOutcomes()` as the permanent sole writer. | Permanently abandons real-outcome-based calibration — the entire reason this workstream exists. Not a real option, only a baseline for comparison. |
| **(b) Replace hardcoded-constant path with real-outcome path** | Stop calling `calibrateInterceptFromOutcomes()` from `runFullCalibration()`; make `promoteShadowB0()`/`computeShadowB0()` the sole writer, on a real schedule. | This is very likely the *right end state* — but implementing it requires **something** to call `computeShadowB0()`/`promoteShadowB0()` periodically, which is materially the same act as activating `runWeeklyRecalibration()`. Doing that in this task would violate the explicit "do not activate `runWeeklyRecalibration()` yet" constraint. This option is the natural companion to Step 0's eventual activation, not something to do in isolation first. |
| **(c) Allow both, with precedence rules** | e.g., real-outcome promotions always take priority over fake-constant shifts, using timestamps/provenance to arbitrate rather than simple last-write-wins. | Requires real design work (a precedence policy, likely a new provenance field) to implement correctly, and is pointless to build in detail before there's a real schedule for either path to actually collide on. Solving a race condition between two mechanisms, only one of which will ever run under the current constraints, is premature. |
| **(d) Split into separate fields** | New column (e.g. `outcomeCalibratedB0`) written only by the real path; `getCalibratedWeights()` prefers it when present/mature, falls back to legacy `calibratedB0` otherwise. | Requires a Prisma migration — a bigger, riskier change than this ticket's "design/audit phase" framing calls for, and this workstream's own precedent (Phase 2G/2H) treats schema changes as their own explicitly-scoped, separately-approved step, not something to bundle into an ownership decision. |
| **(e) Retire one path now, activate its replacement later** | Stop `calibrateInterceptFromOutcomes()` from writing `calibratedB0` *today* (function stays fully intact, exported, testable — just no longer called by `runFullCalibration()`'s default sequence), leaving the field frozen until Step 0's real activation happens in a *separate*, later, explicitly-approved step. | This is the option that comes closest to "safe and minimal" — it can't make calibration less accurate (a frozen, honest field beats one silently nudged toward a fictional target), and it doesn't require activating anything. But it is still a behavior change to a currently-reachable, if rarely-invoked, production endpoint (`/api/internal/analyze-trades`), made without confirming nobody depends on that endpoint continuing to shift `calibratedB0` for whatever reason it was originally built for. Given this workstream's consistent practice of not changing reachable calibration behavior without an explicit, reviewed decision (see the `conservative_roster_pattern` ADR precedent), this should be **decided here, then implemented as its own follow-up**, not silently folded into an audit task. |

---

## 4. Recommendation

**Option (e), executed as the first half of option (b)'s eventual end state:**

1. **Now (this ADR):** record the decision that `calibrateInterceptFromOutcomes()`'s hardcoded-constant intercept shift is **not** a legitimate long-term owner of `calibratedB0`, and that `promoteShadowB0()`'s real-outcome path **is** the intended eventual sole owner.
2. **Next, separately-scoped step (not this ADR):** when `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` §7 Step 0 is revisited and `runWeeklyRecalibration()` is actually activated (its own scheduled, flagged, reviewed change), remove `calibrateInterceptFromOutcomes()`'s call from `runFullCalibration()` in the **same** change — so the switchover from "fake path writes" to "real path writes" happens atomically, with zero window where both could plausibly fire, and zero window where neither does. `calibrateFromFeedback()` (the real, feedback-based half of `runFullCalibration()`) is unaffected and keeps running exactly as today.
3. `calibrateInterceptFromOutcomes()` itself should **not be deleted** at that point either (per this task's "do not delete trade-learning infrastructure" constraint, and the prior task's identical constraint) — it stays in the file, exported, independently testable, simply no longer invoked by `runFullCalibration()`'s default sequence. This preserves it as a fallback/reference implementation without it being a live writer.
4. At the same time, fix the minor `CalibrationHistoryEntry.source` type gap noted in §2 (three real source values — `'outcome'`, `'feedback'`, `'auto-recalibration'` — sharing one narrower two-value type today) so the eventual single-owner history is fully and honestly typed.

**Why not options (c)/(d):** both solve a race condition between two active writers. Under the recommendation above, there is only ever one active writer at any given time (by construction, not by precedence logic), which is simpler, has a smaller blast radius, and requires no schema change. If a future need arises for *both* mechanisms to run concurrently with real precedence rules (e.g., per-segment ownership), that should be its own ADR once there's a concrete reason, not spent now against a hypothetical.

---

## 5. Why this is not implemented in this session

Implementing step 2 of the recommendation above requires making `runFullCalibration()` stop writing `calibratedB0` via the fake path — safe and reversible on its own — but the recommendation explicitly ties that change to the *same* moment `runWeeklyRecalibration()` is activated, so the field is never left with zero active writers for a real, extended period. Making that change **now**, in isolation, ahead of Step 0's actual activation (which remains explicitly out of scope per this task's constraints: *"Do not activate `runWeeklyRecalibration()`. Do not add cron wiring."*) would freeze `calibratedB0` indefinitely with no committed timeline for its replacement — a real behavior change to a reachable production endpoint, made without the explicit go-ahead this workstream has consistently required before touching calibration logic. That decision belongs to whoever approves Step 0's activation, at the same time, not to this design/audit phase alone.

---

## 6. Required tests (once this recommendation is implemented)

- `runFullCalibration()` no longer changes `TradeLearningStats.calibratedB0` when only `calibrateInterceptFromOutcomes()`-eligible data exists (i.e., mock ≥30 analyzed `LeagueTrade` rows, zero `TradeOutcomeEvent` rows, assert `calibratedB0` is unchanged after the call).
- `runFullCalibration()`'s `calibrateFromFeedback()` call is unaffected — still adjusts `feedbackWeightAdj` from real `TradeFeedback` data exactly as today (regression test, not new behavior).
- `calibrateInterceptFromOutcomes()` remains independently callable and produces its existing (fake-constant-based) result when invoked directly — proving it's disconnected, not deleted.
- An end-to-end test that activating `runWeeklyRecalibration()` (whenever that follow-up work happens) is the *only* thing that changes `calibratedB0` going forward, with `calibrateInterceptFromOutcomes()` confirmed unreachable from any default orchestration path.

None of these are implemented in this session, since the recommendation isn't implemented yet.

---

## 7. Explicit non-goals of this ADR

- Does not activate `runWeeklyRecalibration()`.
- Does not add any cron entry or `vercel.json` change.
- Does not change any public API or route behavior.
- Does not touch Decision OS, AI Coach, or Chimmy.
- Does not delete `calibrateInterceptFromOutcomes()`, `runFullCalibration()`, or any other existing trade-learning export.
- Does not implement the recommendation in §4 — that is explicitly deferred to the same future change that activates Step 0.

---

## Files changed in this session

- `docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md` (this document, new)

No other file was created, modified, or deleted. No cron entry, feature flag, schema change, or `vercel.json` change was made. No Decision OS code, public API, or existing calibration logic was touched, changed, or removed.
