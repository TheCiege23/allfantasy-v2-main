# Trade Learning — Shadow Rollout Guide

**Audience:** whoever is considering flipping `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` on.
**Status:** the system is implemented, observable (Phase 1 + Phase 2), the live-capture schema is deployed to staging and end-to-end validated with real writes (Phase 9), season resolution is canonical (Phase 10), and the pipeline has been rehearsed at moderate volume on staging (Phase 11: 42 trades, zero failures, then cleaned up). **Phase 12 measured real staging volume directly and confirmed a NO-GO for enabling the flag right now: 0 of 30 required samples.** **Still not enabled anywhere.** The sole remaining blocker is real, organic trade volume accumulating on staging — nothing left to build or fix. This document does not recommend a rollout date — it tells you what to check before picking one.
**Related:** `docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md` (full implementation history), `docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md` (why the system is shaped this way), `docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md` (the live-capture design), `docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md` §10 (the staging deployment + validation record), §11 (Phase 10's canonical season resolution record), §12 (Phase 11's shadow-traffic rehearsal record), and §13 (Phase 12's go/no-go decision record), `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` (why this exists at all).

## Canonical season ownership (Phase 10)

Phase 9 surfaced a real, load-bearing gap: `computeShadowB0()`/`getCalibratedWeights()`/etc. all defaulted to an independent hardcoded `season` constant (`2025`, duplicated across five files), while real `League.season` already defaulted to `2026` — meaning real captured data was invisible to calibration queries run without an explicit override.

Phase 10 closed this by removing every hardcoded season constant/default in the trade-learning subsystem and replacing them with one canonical resolver: **`resolveCurrentTradeLearningSeason()`, exported from `lib/trade-engine/season-resolver.ts`.**

- **Primary source:** the freshest real season seen across `League` rows (`MAX(League.season)`). `League.season` is already the canonical per-league value every real trade capture writes (Phase 8/9's `tradeLearningCapture.ts`) — reusing it rather than inventing a second, parallel season concept.
- **Fallback (cold start only, or if the query fails):** `computeSeasonFromDate()`, a deterministic, provider-agnostic NFL-style Sept–Aug season-year computation. Never throws.
- **Cached** for 1 hour (mirrors `accept-calibration.ts`'s pre-existing cache pattern) — invalidate with `invalidateSeasonResolverCache()` in tests or ops tooling.
- **Every function** that used to default to a hardcoded season (`calibrateInterceptFromOutcomes`, `calibrateFromFeedback`, `getCalibratedWeights`, `calibrateAcceptProbability`, `runFullCalibration` in `accept-calibration.ts`; `computeShadowB0`, `promoteShadowB0`, `computeSegmentB0s`, `runWeeklyRecalibration` in `auto-recalibration.ts`; `computeAndStoreIsotonicMap` in `isotonic-calibrator.ts`; `buildTradeLearningDiagnostics` in `diagnostics.ts`; `computeCalibrationHealth` in `calibration-metrics.ts`; `runDriftDetection` in `drift-detection.ts`; `logAcceptedTradesAsOutcomes` in `trade-event-logger.ts`; `aggregateTradeLearningInsights`/`getLearningContextForAI`/`runBackgroundTradeAnalysis` in `lib/trade-learning.ts`; and the `GET /api/admin/trade-learning/diagnostics` route) now takes `season?: number` and resolves internally with `season ?? await resolveCurrentTradeLearningSeason()` when no explicit override is given. An explicit argument always wins — this is also how historical/manual season lookups work; no separate "historical" API was needed.
- **`runWeeklyRecalibration()`** — the actual weekly cron entry point — resolves the season exactly once at the top of the function and threads that single resolved value through promotion, shadow computation, segment computation, and isotonic mapping, so one scheduled run can never straddle two different season values even if the real season rolls over mid-run.

**Future rollover:** when a new real season starts, new `League` rows get created with the new `season` value and `resolveCurrentTradeLearningSeason()` picks it up automatically the next time its cache expires — no code change, no redeploy, no manually-updated constant. This is the property this phase was specifically built to establish for a long-lived platform.

---

## What this system does, in one paragraph

Once enabled, a weekly cron (`app/api/cron/trade-weekly-recalibration`) calls `runWeeklyRecalibration()`, which reads real `TradeOutcomeEvent` rows (trades that were actually accepted, rejected, or expired), compares the observed acceptance rate against what the model predicted, and computes a corrected intercept (`shadowB0`). That correction sits untouched for 7 days (a "shadow" period), and is only promoted into the live `calibratedB0` — the value every trade-evaluation route actually reads — if it still holds up (enough samples, doesn't diverge too wildly from the current value) after that wait. Nothing about trade recommendations, scoring, or any other math changes; only this one intercept number can move, slowly, and only from real data.

---

## How to enable it

1. Set `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED=true` in the target environment (staging first, strongly recommended — see checklist below).
2. That's the entire enablement step. The cron entry already exists in `vercel.json` (`0 11 * * 1`, weekly) and is already inert — setting the flag is what activates it. No deploy of new code is required to enable/disable; it's a pure environment-variable flip.
3. To disable again: unset the flag (or set it to anything other than `"true"`). The next scheduled run will no-op immediately, logging `[TradeLearningScheduler] skipped: disabled (...)`. This is the rollback procedure — see below.

---

## How to monitor it

### The diagnostics endpoint

`GET /api/admin/trade-learning/diagnostics` (admin-authenticated, read-only). Call it any time — it never triggers a run, only reports current stored state. Key fields to watch:

| Field | What it tells you |
|---|---|
| `operational.weeklyRecalibrationEnabled` | Is the flag actually on right now, in this environment. |
| `scheduler.lastRecalibrationAt` / `daysSinceLastRecalibration` | When the pipeline last actually completed a computation (not just "was invoked" — see below for that distinction). |
| `scheduler.wouldRunIfInvokedNow` / `skipReasonIfAny` | If the cron fired this second, would it proceed or skip, and why. |
| `shadow.pending` / `shadow.sampleSize` / `shadow.minRequiredSample` | Is there a shadow value waiting, and does it have enough real data behind it yet (30 minimum). |
| `shadow.ageDays` / `shadow.isMature` / `shadow.maturityThresholdDays` | How close the pending shadow is to its 7-day promotion eligibility. |
| `shadow.divergenceFromActive` / `shadow.withinDivergenceCap` | Would this shadow value actually be allowed to promote (must be within 0.40 of the current `calibratedB0`), or would it be silently rejected as too large a jump. |
| `promotion.hasEverBeenPromoted` / `lastPromotedAt` / `lastPromotedB0` | Has a real promotion ever actually happened, and when. |
| `calibratedB0.current` | The live value every trade-evaluation route is currently using. |
| `calibrationHealth.ece` / `.brierScore` / `.alerts` | Independent calibration-quality signal (reused from the pre-existing, previously-unwired `calibration-metrics.ts`) — is the model well-calibrated regardless of what the weekly job is doing. |
| `drift.overallSeverity` | Whether the separate, already-reachable drift-detection job (`runDriftDetection()`, via `/api/internal/analyze-trades`) has flagged anything. |

### Logs

Every scheduled invocation (whether the cron fires or you manually hit the route) logs:
```
[TradeLearningScheduler] invoked (flag=enabled)
```
then, if enabled, `runWeeklyRecalibration()`'s own existing logs (cadence check, shadow computation, promotion decision, segments, isotonic), followed by:
```
[TradeLearningScheduler] complete — shadowComputed=true, promoted=false, segments=0, isotonic=false
```
If disabled: `[TradeLearningScheduler] skipped: disabled (...)` and nothing further runs.

**Important distinction:** the cron *invokes* the scheduler every week regardless of the flag — that "invoked" log line will appear weekly even while disabled. What changes when you enable the flag is whether anything past that line executes.

---

## Expected behavior during the first week

- **Immediately after enabling**: the very next cron firing (or sooner, if triggered manually) will call `runWeeklyRecalibration()` for real. If this is the first time it's ever run for a season with no prior `TradeLearningStats` row, `lastRecalibrationAt` is null, so the cadence gate is skipped (nothing to compare against) and it proceeds straight to computing.
- **If fewer than 30 real `TradeOutcomeEvent` rows exist** for the season: `computeShadowB0()` returns `null`, no shadow is computed, nothing is written except possibly `lastRecalibrationAt` staying unset. The diagnostics endpoint will show `shadow.pending: false` and the log will read `[AutoRecal] Only N outcomes, need 30. Skipping shadow b0.` — this is the expected, common case immediately after enabling on a low-volume season. **This is not a failure.**
- **Once ≥30 outcomes exist**: a shadow value appears (`shadow.pending: true`, `shadow.isMature: false`, `shadow.ageDays` starting near 0).
- **Segments** (`SF`/`1QB`/`TEP`/league-format buckets) each independently need ≥50 samples — expect these to lag behind the global shadow by a wide margin, especially early on.
- **Isotonic calibration mapping** needs ≥50 samples too, and is the least likely of the three to have enough data in week one.

## Expected maturity progression

- **Day 0–6**: shadow value sits and holds; `shadow.isMature` stays `false`; nothing promotes; `calibratedB0` does not move.
- **Day 7+**: on the next scheduled invocation after the shadow turns 7 days old, `promoteShadowB0()` checks divergence. If the shadow is within 0.40 of the current `calibratedB0`, it promotes — `calibratedB0` changes, `promotion.hasEverBeenPromoted` flips to `true`, and a new shadow computation starts fresh on the same run.
- **If divergence exceeds 0.40**: promotion is silently skipped (logged as `Shadow b0 diverges … exceeds max 0.40`), the shadow is simply recomputed next time — it does not accumulate or retry more aggressively. If this keeps happening every week, that itself is a signal worth investigating (see checklist) rather than something to override.
- **Ongoing**: expect small, gradual, clamped movements (±0.60 max per computation cycle) rather than large jumps — this is by design.

## Rollback procedure

1. Unset (or set to non-`"true"`) `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED`.
2. No code deploy is required — this takes effect on the next invocation.
3. `calibratedB0` is **not** automatically reverted to its pre-enablement value by disabling the flag — whatever value was last promoted stays in place, since it's the live value every trade route reads. If a rollback of the *value itself* (not just future computation) is ever needed, that requires a manual `TradeLearningStats.calibratedB0` update — this document does not provide that procedure, since it hasn't been needed and shouldn't be improvised under pressure; if it comes up, treat it with the same care as any other production data fix.
4. Nothing else needs to change — `calibrateInterceptFromOutcomes()` remains retired regardless of this flag's state (that decision, per the ownership ADR, is independent of whether weekly recalibration is currently enabled).

## Operational checklist — before enabling anywhere

- [x] ~~Deploy the live-capture schema migration to staging~~ — **done, Phase 9**: `TradeOfferMode.LIVE_PROPOSAL` + both `afLeagueTradeId` columns/indexes are live on staging, verified against `pg_enum`/`information_schema`/`pg_indexes` directly, and recorded in `_prisma_migrations`.
- [x] ~~Prove real trades produce real, linked events~~ — **done, Phase 9**: real `AfLeagueTrade` rows, run through the real, unmodified capture functions, produced correctly-linked `TradeOfferEvent`/`TradeOutcomeEvent` rows for accepted/rejected/vetoed/countered outcomes, with working idempotency against real Postgres constraints. Two real bugs found this way were fixed (an `inputHash` collision for real trades with identical assets, and `season` never being populated) — see `docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md` §10.
- [x] ~~Resolve the season-mismatch finding~~ — **done, Phase 10**: every trade-learning function now resolves season through the single canonical `resolveCurrentTradeLearningSeason()` path (see "Canonical season ownership" above) instead of a hardcoded constant. No hardcoded season default remains anywhere in the subsystem.
- [x] ~~Prove the pipeline handles real volume, not just a handful of test trades~~ — **done, Phase 11** (`docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md` §12): 42 real, correctly-linked, correctly-seasoned `TradeOfferEvent`/`TradeOutcomeEvent` rows were generated on staging via the real capture functions, clearing `MIN_RECALIBRATION_SAMPLE` (30) with zero failures; `computeShadowB0()` and `buildTradeLearningDiagnostics()` both correctly found and processed this data with no explicit season argument. All 42 trades' worth of data was then deleted (synthetic rehearsal data must not pollute a future real-volume measurement) — staging is back to zero trade-learning rows.
- [ ] **Let real, organic trade activity accumulate on staging** — Phase 9 and Phase 11 proved the pipeline *works*, at both small and moderate scale; neither created real volume, and by design (Phase 11's data was deleted after rehearsal). The schema migration alone doesn't create trades — a deployed application instance running the Phase 8 code against real user trades does. **Phase 12 re-measured this directly: still 0 `TradeOfferEvent` / 0 `TradeOutcomeEvent` on staging as of 2026-07-06** — 0 of the 30 required samples. Re-check `GET /api/admin/trade-learning/diagnostics` (or a fresh read-only volume measurement, following the `docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md` §1 query pattern) once real volume is live. **This is the sole remaining data-readiness blocker, confirmed twice now (Phase 11 and Phase 12).**
- [ ] Check `GET /api/admin/trade-learning/diagnostics` on the target environment — confirm `shadow.sampleSize` / real `TradeOutcomeEvent` volume is nonzero (the route now resolves the correct season automatically when no `?season=` override is given), so you're not enabling something that will sit idle for weeks with zero visibility into whether it's "working" or "waiting."

## Phase 12 go/no-go decision (2026-07-06)

**NO-GO.** Measured directly against staging: `TradeOfferEvent` count = 0, `TradeOutcomeEvent` count = 0, against a required `MIN_RECALIBRATION_SAMPLE` of 30. Enabling the flag right now would produce zero observable effect beyond a weekly log line — see `docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md` §13 for the full gate-by-gate comparison (`MIN_RECALIBRATION_SAMPLE`, `MIN_SEGMENT_SAMPLE`, `SHADOW_MATURITY_DAYS`, `MAX_SHADOW_DIVERGENCE`, `RECALIBRATION_CADENCE_DAYS` — all fail or are not-yet-applicable). The flag was **not** enabled and no environment change was applied. The exact change to apply once real volume clears the gate:

```
TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED=true
```

(Staging only, never production; no code deploy required — see "How to enable it" above.)
- [ ] Enable in **staging first**, not production, and watch at least one full 7-day maturity cycle before considering production.
- [ ] After enabling, check the diagnostics endpoint and logs after the *first* scheduled firing — confirm `[TradeLearningScheduler] invoked (flag=enabled)` appears and the run completes without error (`ok: true` from the cron route).
- [ ] Watch `calibrationHealth.ece`/`.alerts` and `drift.overallSeverity` throughout the shadow period — these are independent of whether promotion has happened yet and can surface a problem before any `calibratedB0` change occurs.
- [ ] When the first promotion happens (`promotion.hasEverBeenPromoted` flips to `true`), spot-check a live trade-evaluation route's output before vs. after — confirm the change in `calibratedB0` produced a sensible, bounded shift in acceptance-probability output, not a surprising jump.
- [ ] Decide, explicitly, who owns watching this and for how long before it's considered "safe" for the next environment — this document intentionally does not make that call.
