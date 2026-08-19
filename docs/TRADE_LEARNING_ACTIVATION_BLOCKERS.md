# Trade Learning Activation Blockers

**Status:** **RESOLVED — activation implemented (disabled by default).** No production wiring, cron entry, feature flag, or `vercel.json` change was implemented in the *original* session that produced this document. All three items below have since landed. This document is preserved as a historical record of the investigation; see the "Activation complete" update for current state.
**Branch:** `g15-event-foundation`
**Scope:** Implementation-readiness review of `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` §7 Step 0 — "wire `runWeeklyRecalibration()` into a scheduled path."
**Files touched in the original session:** one new regression test (`__tests__/trade-engine/auto-recalibration-activation-readiness.test.ts`), no other file created, modified, or deleted. No Decision OS code touched. No public API touched. No existing calibration code removed or modified.

> **Update 1 (enum bug fixed):** the primary blocker below — the `computeObservedAcceptRate()` case-mismatch bug (§4) — **was fixed** in `lib/trade-engine/auto-recalibration.ts` (commit `34a0d4fa8`), with direct unit coverage in `__tests__/trade-engine/auto-recalibration-observed-accept-rate.test.ts` and updated assertions in the original readiness test.
>
> **Update 2 (ownership resolved):** the secondary shared-field conflict (§4/§6 item 3) was resolved via `docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md` (commit `ac1507eb5`), which recommended retiring `calibrateInterceptFromOutcomes()`'s write in the *same* change that activates `runWeeklyRecalibration()`, so there is never a window with zero or two active writers.
>
> **Update 3 (activation complete — Decision OS Trade Learning Phase 1):** the ADR has been implemented exactly as written. `runFullCalibration()` (`lib/trade-engine/accept-calibration.ts`) no longer calls `calibrateInterceptFromOutcomes()` — that function remains fully intact, exported, and independently callable, simply no longer part of the default orchestration. `promoteShadowB0()` (`lib/trade-engine/auto-recalibration.ts`) is now the sole writer of `TradeLearningStats.calibratedB0`. `runWeeklyRecalibration()` is now reachable through a new, **disabled-by-default** operational flag, `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` (parsed via `isWeeklyRecalibrationEnabled()`, matching the `DECISION_OS_*_LIVE` convention), invoked via `runScheduledWeeklyRecalibration()` from a new cron route, `app/api/cron/trade-weekly-recalibration/route.ts` (auth via the standard `requireCronAuth()`, scheduled weekly in `vercel.json`, inert while the flag is off). See the "Activation Phase 1" section appended at the end of this document for the full implementation record. **This system has not been enabled in production** — the flag defaults to off and must be explicitly set by an operator.
>
> The rest of this document — the entry-point audit, the "why was this never called" history, and the originally-designed activation path — remains accurate as a historical record of the investigation that led here, and is preserved below as-written.

## TL;DR

Step 0 looked like a near-free win — flip a dead switch, no new design needed. **It is not safe to flip today.** While tracing every caller and building the minimal wiring, a real, verifiable defect surfaced in the exact function the audit recommended activating: `computeObservedAcceptRate()` (`lib/trade-engine/auto-recalibration.ts:89-97`) compares `TradeOutcomeEvent.outcome` against the lowercase strings `'accepted'`/`'completed'`, but the real Prisma `TradeOutcome` enum only ever contains `ACCEPTED | REJECTED | EXPIRED | COUNTERED | UNKNOWN` (uppercase, confirmed in `prisma/schema.prisma:14339-14345`, no `@map` remapping). **Every real outcome row fails this comparison.** A focused regression test (added this session, not removed) proves it empirically: 40 synthetic `ACCEPTED` outcomes and 40 synthetic `REJECTED` outcomes both produce an identical, wrong `observedRate: 0` from `computeShadowB0()`. Activating `runWeeklyRecalibration()` as-is would not "do nothing safely" — it would silently and repeatedly push the live `calibratedB0` (read by real trade-evaluation routes) toward its most pessimistic clamp, based on a permanently-fictional 0% acceptance signal, with no existing safeguard positioned to catch it. This is worse than the current state, not equivalent to it. Per this task's own branching instruction, the correct action is: **do not implement, document the blocker precisely.**

---

## 1. Audit of the existing learning pipeline

### Entry points

| Entry point | Trigger | Auth | Calls |
|---|---|---|---|
| `POST /api/internal/analyze-trades` | Manual only — **not present in `vercel.json`'s `crons` array** (checked directly; zero `analyze-trades` references anywhere in `vercel.json`) | `x-internal-key` header compared to `process.env.SESSION_SECRET` — a bespoke check, not the repo's standard `requireCronAuth()` helper used by every `/api/cron/*` route | `runBackgroundTradeAnalysis()` (`lib/trade-learning.ts:552`) |

`runBackgroundTradeAnalysis()` calls, in order, all real writes:
1. `processUnanalyzedTrades()` (`lib/trade-learning.ts:206`) — re-derives FantasyCalc values for up to 100 unanalyzed `LeagueTrade` rows per run, guarded by a 5-minute Prisma-row lock (`season: 9999` sentinel row).
2. `aggregateTradeLearningInsights()` (`lib/trade-learning.ts:297`) — rebuilds `TradeLearningInsight` rows and `TradeLearningStats.positionTrends`/`totalTradesAnalyzed` from analyzed trades.
3. `runFullCalibration()` (`lib/trade-engine/accept-calibration.ts:435`) → `calibrateInterceptFromOutcomes()` + `calibrateFromFeedback()`.
4. `runDriftDetection()` (`lib/trade-engine/drift-detection.ts:609`).
5. `logAcceptedTradesAsOutcomes()` (`lib/trade-engine/trade-event-logger.ts:149`) — backfills `TradeOutcomeEvent` rows (always `outcome: 'ACCEPTED'`, correctly upper-cased by `logTradeOutcomeEvent()`) from accepted `LeagueTrade` rows.

### Unreachable functions (confirmed by exhaustive repo-wide grep, not inference)

| Function | File | Callers found |
|---|---|---|
| `runWeeklyRecalibration()` | `auto-recalibration.ts:395` | **Zero** — one match repo-wide, its own definition |
| `computeShadowB0()`, `promoteShadowB0()`, `computeSegmentB0s()` | `auto-recalibration.ts` | Only called from `runWeeklyRecalibration()`, itself uncalled — transitively dead |
| `computeAndStoreIsotonicMap()` | `isotonic-calibrator.ts:189` | Only called from `runWeeklyRecalibration()` — transitively dead |

`calibrateInterceptFromOutcomes()` has exactly one caller: `runFullCalibration()` (`accept-calibration.ts:443`) — confirmed by grep, matching the audit doc's claim exactly.

### Scheduler assumptions

- `runWeeklyRecalibration()` self-throttles via `TradeLearningStats.lastRecalibrationAt` (`daysSinceRecal < 6.5` → early return) — it is idempotent-safe to call more often than weekly; it assumes *something* calls it periodically, not an exact cron expression.
- `promoteShadowB0()` requires a shadow value to be ≥7 days old (`SHADOW_MATURITY_DAYS`) before promoting — this assumes the function is invoked again after that window has passed, not a specific schedule.
- No cron, queue, or script anywhere in the current codebase references it.

### Required inputs

- `TradeOutcomeEvent` rows (≥30 for shadow B0 per `MIN_RECALIBRATION_SAMPLE`, ≥50 per segment per `MIN_SEGMENT_SAMPLE`, ≥50 for the isotonic map per `MIN_ISOTONIC_SAMPLE`) — real rows exist today, written by `logTradeOutcomeEvent()` (live trade-flow callers) and backfilled by `logAcceptedTradesAsOutcomes()`.
- Matching `TradeOfferEvent` rows via `offerEventId`, for the `acceptProb` originally predicted.

### Required outputs / persistence behavior

All writes are upserts on the season-keyed `TradeLearningStats` row: `shadowB0`, `shadowB0SampleSize`, `shadowB0ComputedAt`, `shadowB0Metrics`, `segmentB0s`, `lastRecalibrationAt`, and — only on promotion — `calibratedB0` plus an appended `calibrationHistory` entry. `computeAndStoreIsotonicMap()` additionally writes `isotonicMapJson`/`isotonicComputedAt`/`isotonicSampleSize`, and calls `invalidateCalibrationCache()` (`accept-calibration.ts`), which clears the in-memory cache read by `getCalibratedWeights()`/`calibrateAcceptProbability()` — the same functions already consumed by live trade-evaluation routes (`app/api/trade-evaluator/route.ts`, `server/api-route-modules/legacy/trade/*`). Activating this system is designed to eventually change the *values* those routes return — that is the intended effect of closing the loop — without changing their code path or latency profile, since they already read from the same cached, season-keyed row today.

---

## 2. Why `runWeeklyRecalibration()` is never called — evidence, not speculation

Git history shows this is a **migration gap**, not an intentional disable and not obsolete code:

- Commit `719e9bcfb` ("update", a large squashed commit) added `.archive/server_jobs/modelDriftRollup.ts` — a **standalone Node script** (not a Next.js route; imports `PrismaClient` directly, defines its own `TradeOfferMode`/`TradeOutcome`-typed drift/segment-bucketing logic) that is conceptually the direct predecessor of today's `drift-detection.ts`/`auto-recalibration.ts` — same domain (`SegmentParts`, `FlatScores`, `BucketStat`, segment-key construction from SF/TEP/league-size).
- A later commit, `8c577833f` (also "update"), **deleted** that archived script entirely.
- No `vercel.json` cron entry, `server_jobs`-style scheduler, or any other trigger was ever added for the *replacement* logic (`auto-recalibration.ts`) that superseded it.
- No feature flag exists anywhere for this system (checked `.env.example` — zero trade-learning/calibration/drift entries) and no disabling comment exists in any of the four trade-engine calibration files (all four were read in full this session and in the prior audit session).

**Conclusion: this is unfinished migration work — missing production wiring / missing scheduler — not an intentional decision, not an obsolete leftover.** The old standalone job's scheduling infrastructure was retired (consistent with the codebase's move to Vercel-cron-only scheduling for everything else, per `vercel.json`'s ~30 existing `/api/cron/*` and other scheduled-route entries), and its calibration logic was clearly rewritten as the current `lib/trade-engine/` module set — but the new equivalent of "something calls this periodically" was never created for the `runWeeklyRecalibration()` half of that rewrite, only for the `runFullCalibration()`/`runDriftDetection()` half (via the still-manual `/api/internal/analyze-trades` endpoint).

---

## 3. The minimum safe activation path — designed, not implemented (see §5 for why)

Had §4 not surfaced a blocker, this is the design that satisfies every stated preference:

- **New, dedicated cron route** `app/api/cron/trade-weekly-recalibration/route.ts`, using the repo's existing `requireCronAuth()` helper (`app/api/cron/_auth.ts`) — the same pattern as every other `/api/cron/*` route — rather than reusing the bespoke `x-internal-key` check on `/api/internal/analyze-trades`.
- **A new, disabled-by-default env flag**, following the exact naming/parsing convention Decision OS already uses for its own kill switches (`DECISION_OS_LINEUP_LIVE`, `..._WAIVER_LIVE`, `..._TRADE_LIVE`, `..._COMMISSIONER_HEALTH_LIVE`, all read as `String(env[...] ?? '').trim().toLowerCase() === 'true'`, default off): e.g. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED`.
- **A tiny, pure, testable gate function** (mirroring `shouldRunLineupLive(env)`'s shape) that no-ops cleanly when the flag is off, and calls the existing, unmodified `runWeeklyRecalibration()` when on.
- **Deliberately not touching** `runBackgroundTradeAnalysis()`, `runFullCalibration()`, `calibrateInterceptFromOutcomes()`, or `/api/internal/analyze-trades` — those remain fully intact and callable exactly as today, satisfying "do not remove existing calibration code" and "no existing request path changes behavior."
- **A new, additive `vercel.json` cron entry** on a weekly cadence (matching the function's own internal 6.5-day guard) — inert by default because the flag gates the actual work, so adding the schedule carries negligible cost even before the flag is ever turned on.

This design was fully specified and would have taken only three small, additive files plus one `vercel.json` line. It was **not implemented**, because of §4.

---

## 4. Safety verification — FAILED on one check

Going through the task's exact safety checklist:

| Check | Result |
|---|---|
| Changes public APIs? | No — new route would be an internal, cron-only, auth-gated endpoint; zero existing routes touched. |
| Changes request latency? | No — nothing in any user-facing request path is touched; the new route is invoked only by a scheduler. |
| Modifies Decision OS contracts? | No — `lib/decision-os/` is untouched; this subsystem has zero awareness of or import from Decision OS, confirmed in the prior audit and reconfirmed this session. |
| Bypasses existing maturity gates? | No — `runWeeklyRecalibration()` would be called completely unmodified; its 7-day shadow-maturity gate is 100% intact. |
| Bypasses drift detection? | No — `runDriftDetection()` is untouched; **however, this check does not provide the safety net its name implies (see below)**. |
| Bypasses shadow safeguards? | No — the shadow-B0 hold/promote logic is called unmodified. |
| **Produces correct output from real data?** | **FAILED.** See below. |

### The failure

`computeShadowB0()` (`auto-recalibration.ts:107`) calls `computeObservedAcceptRate(outcomes)` (line 89-97):

```ts
function computeObservedAcceptRate(
  outcomes: Array<{ outcome: string }>,
): number | null {
  if (outcomes.length === 0) return null
  const accepted = outcomes.filter(o =>
    o.outcome === 'accepted' || o.outcome === 'completed',
  ).length
  return accepted / outcomes.length
}
```

The real `TradeOutcomeEvent.outcome` column is typed `TradeOutcome`, a Prisma enum with exactly these values (`prisma/schema.prisma:14339-14345`):

```prisma
enum TradeOutcome {
  ACCEPTED
  REJECTED
  EXPIRED
  COUNTERED
  UNKNOWN
}
```

There is no `@map` remapping, and there is no `COMPLETED` value at all. Every real row's `outcome` field is one of the five uppercase strings above. `o.outcome === 'accepted'` and `o.outcome === 'completed'` can **never** be true for real data. Compare `isotonic-calibrator.ts:209`, which performs the equivalent check correctly: `o.outcome === 'ACCEPTED'` (uppercase) — proving this is a genuine defect in `auto-recalibration.ts` specifically, not a documented convention or an intentional simplification.

**Proven empirically, not just by reading code** — new test `__tests__/trade-engine/auto-recalibration-activation-readiness.test.ts` (added this session, 2 tests, both passing against the real, unmodified `computeShadowB0()` export):

- 40 synthetic `TradeOutcomeEvent` rows with `outcome: 'ACCEPTED'` (i.e., **100% real acceptance**) → `computeShadowB0()` returns `observedRate: 0`.
- 40 synthetic rows with `outcome: 'REJECTED'` (i.e., **0% real acceptance**) → `computeShadowB0()` returns the identical `observedRate: 0`.

The function cannot currently distinguish "everyone accepted every trade" from "everyone rejected every trade." Both report a 0% observed acceptance rate.

### Why this specifically makes activation unsafe (not merely "still imperfect")

Once ≥30 real `TradeOutcomeEvent` rows exist for a season (a threshold real production data will eventually cross, especially once the audit's other findings — matchup-prediction persistence, recommendation-outcome linkage — increase real trade volume over time), `computeShadowB0()` will compute a log-odds correction against a permanently-fictional `observedRate ≈ 0`, producing the maximum negative correction (clamped to `-MAX_B0_SHIFT = -0.60`). After the 7-day maturity window, `promoteShadowB0()` would push the live `calibratedB0` toward its most pessimistic floor (`DEFAULT_B0 - 0.60 = -1.70`) — read by `getCalibratedWeights()`, consumed by real trade-evaluation routes — making every future acceptance-probability prediction systematically and increasingly too pessimistic, for real users, silently.

**`runDriftDetection()` would not catch this.** Its calibration and segment-drift checks (`drift-detection.ts:96`, `const OBSERVED_ACCEPT_RATE = 0.85`) also measure against a hardcoded constant rather than real `TradeOutcomeEvent` data (this was already flagged in the audit's §5.1 as a separate issue) — so there is no existing alerting path that would notice the shadow-B0 mechanism silently corrupting itself. The one nominal safety net that exists today (drift detection) is blind to exactly this failure mode.

This is not "the system is inactive, so turning it on is low-risk either way." Turning it on **today** would introduce a new, real, silent failure mode into a value that live trade-evaluation routes already read and act on. That is a strictly worse outcome than the current state (fully idle), which is why this audit concludes **do not implement**.

### Secondary, non-blocking-but-relevant finding

Independent of the above: `calibrateInterceptFromOutcomes()` (the reachable, hardcoded-constant path) and `promoteShadowB0()` (the orphaned, real-outcome path) both write the same field, `TradeLearningStats.calibratedB0`, with no coordination between them. Today this is inert because neither runs on a schedule. If the enum-comparison bug above were fixed and this system activated without also resolving this, whichever mechanism ran most recently in a given season would silently overwrite the other's calibration — worth flagging for whoever picks up the eventual fix, but not itself a reason to block a hypothetical future activation once the primary bug is fixed and this is explicitly addressed.

---

## 5. Verification performed this session

- New regression test added: `__tests__/trade-engine/auto-recalibration-activation-readiness.test.ts` — **2/2 passing**, exercising the real, unmodified `computeShadowB0()` export against mocked Prisma data.
- Existing trade-engine-adjacent suites re-run to confirm no incidental changes: `__tests__/league-trade-engine-validation.test.ts` and `__tests__/trade-league-analyze-api.test.ts` — **19/19 passing**, unchanged.
- `tsc --noEmit` re-run and filtered to trade-engine/trade-learning/the new test file: **zero errors** (the pre-existing, unrelated repo-wide baseline error count — documented elsewhere in this workstream — is untouched by this session, since no implementation file was modified).

---

## 6. What must happen before Step 0 can be safely implemented

1. **Fix `computeObservedAcceptRate()`'s enum comparison** (`auto-recalibration.ts:89-97`) to match the real `TradeOutcome` enum values (`'ACCEPTED'`, not `'accepted'`/`'completed'`) — a small, focused, test-covered fix, deliberately **not** bundled into this ticket, since this task's scope is activation-readiness, not calibration-math changes, and any change to this function should ship with its own dedicated tests and review rather than ride along inside a "just wire it up" ticket.
2. **Add real unit test coverage for the rest of `auto-recalibration.ts` and `isotonic-calibrator.ts`** before activation — currently zero test coverage exists for any function in `lib/trade-engine/{accept-calibration,auto-recalibration,isotonic-calibrator,drift-detection}.ts` (confirmed by search prior to this session's one new file). The bug found here was invisible to `tsc` and to every existing test suite; only a targeted, real-data-shaped test caught it.
3. **Resolve the `calibratedB0` shared-field conflict** between `calibrateInterceptFromOutcomes()` (reachable, fake-constant-based) and `promoteShadowB0()` (currently orphaned, real-outcome-based) — a design decision, not a bug fix, likely deserving its own short ADR given this workstream's established governance discipline for touching calibration logic.
4. Only after 1–3: re-attempt the activation path designed in §3 of this document, with the same safety checklist re-run and passing in full.

---

## Files changed in the original session

- `__tests__/trade-engine/auto-recalibration-activation-readiness.test.ts` (new — proves the blocker empirically)
- `docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md` (this document, new)

No other file was created, modified, or deleted in that session. Not committed at that point, since the activation path was not yet proven safe.

---

## Activation Phase 1 — implementation record

Per `docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md`, implemented exactly as approved:

### Ownership transition
- `lib/trade-engine/accept-calibration.ts`: `runFullCalibration()` no longer calls `calibrateInterceptFromOutcomes()`. It now calls a small internal `readCurrentB0Unchanged()` helper that reads (but does not modify) the current `calibratedB0`, so `runFullCalibration()`'s return shape is unchanged (`intercept.adjusted` is now always `false` for this retired path; `calibrateFromFeedback()`'s half is untouched).
- `calibrateInterceptFromOutcomes()` itself was **not deleted** — it remains exported and independently callable/testable, exactly as the ADR required.
- `CalibrationHistoryEntry.source`'s type was widened from `'outcome' | 'feedback'` to `'outcome' | 'feedback' | 'auto-recalibration'`, matching the third value `promoteShadowB0()` already wrote at runtime (a pre-existing, now-fixed type-accuracy gap the ADR flagged).
- `promoteShadowB0()` (`lib/trade-engine/auto-recalibration.ts`) is now the **sole** writer of `TradeLearningStats.calibratedB0`.

### Operational activation (disabled by default)
- New env flag: **`TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED`** — parsed by `isWeeklyRecalibrationEnabled(env)` in `lib/trade-engine/auto-recalibration.ts`, matching the exact `DECISION_OS_*_LIVE` convention (`String(env[...] ?? '').trim().toLowerCase() === 'true'`). **Unset/anything other than `"true"` means disabled.** Not set in any environment as part of this change — must be explicitly enabled by an operator.
- New gate function `runScheduledWeeklyRecalibration(env, season?)` — no-ops with zero Prisma calls when the flag is off; calls the real, unmodified `runWeeklyRecalibration()` when on.
- New cron route `app/api/cron/trade-weekly-recalibration/route.ts` — uses the repo's standard `requireCronAuth()` (same pattern as every other `/api/cron/*` route), calls `runScheduledWeeklyRecalibration()`.
- New `vercel.json` cron entry, weekly cadence (`0 11 * * 1`) — inert while the flag is off, since the route no-ops immediately.

### What is NOT changed
Recommendation generation, acceptance scoring math, `FEATURE_WEIGHTS`, the sigmoid/logit formulas, isotonic calibration logic, drift detection, Manager Intelligence, Decision OS classifiers, AI Coach, Chimmy, and every public API are untouched. `calibrateFromFeedback()` — the real, `TradeFeedback`-driven half of `runFullCalibration()` — is unaffected and verified unchanged by regression test.

### Tests added
- `__tests__/trade-engine/accept-calibration-intercept-retirement.test.ts` (4 tests) — proves `runFullCalibration()` no longer writes `calibratedB0` even under the old trigger condition, proves `calibrateInterceptFromOutcomes()` remains directly callable and fully functional in isolation, and proves `calibrateFromFeedback()`'s behavior and write path are unchanged.
- `__tests__/trade-engine/auto-recalibration-weekly-schedule.test.ts` (7 tests) — proves the flag parses correctly (off by default, on only for `"true"`), proves `runScheduledWeeklyRecalibration()` makes zero Prisma calls when disabled, proves it calls through to the real pipeline when enabled, and proves `promoteShadowB0()` is the one path that still writes `calibratedB0`.
- Full focused suite after this change: **44/44 passing** (`__tests__/trade-engine/`, `__tests__/league-trade-engine-validation.test.ts`, `__tests__/trade-league-analyze-api.test.ts`), plus **71/71 passing** on every Decision OS trade-slice test file, confirming zero cross-contamination.
- `npm run typecheck`: 158 total errors repo-wide, identical to the pre-change baseline, zero touching any trade-engine/trade-learning/cron file.

### Remaining before this can be enabled in production (as of Phase 1)
1. **Real-world volume check** — `MIN_RECALIBRATION_SAMPLE` (30 outcomes) and `MIN_SEGMENT_SAMPLE`/`MIN_ISOTONIC_SAMPLE` (50 each) gates mean the flag can be flipped on with zero practical effect until enough real `TradeOutcomeEvent` rows accumulate; nobody has measured current real volume against these thresholds (carried over from `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md`'s own open items).
2. **Observation window before first promotion** — even once enabled, `promoteShadowB0()`'s 7-day maturity gate means the first real promotion cannot happen faster than a week after the flag goes on; operators should expect a quiet period before any `calibratedB0` movement is visible.
3. **Decide who flips the flag, and when** — this document does not recommend a production rollout date; that is explicitly out of scope for this activation-implementation task.
4. ~~`calibration-metrics.ts`'s orphaned health dashboard remains unwired~~ — **resolved in Phase 2** (see below): it is now reused (not duplicated) by the new diagnostics endpoint.

**Items 1–3 above remain open after Phase 2** — this phase adds observability, not volume or a rollout date. See `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` for the full operational checklist.

## Files changed in the activation (Phase 1) session

- `lib/trade-engine/accept-calibration.ts` (modified — retired the hardcoded-constant write, widened `CalibrationHistoryEntry.source`)
- `lib/trade-engine/auto-recalibration.ts` (modified — added `isWeeklyRecalibrationEnabled()`/`runScheduledWeeklyRecalibration()`)
- `app/api/cron/trade-weekly-recalibration/route.ts` (new)
- `vercel.json` (modified — added the weekly cron entry)
- `__tests__/trade-engine/accept-calibration-intercept-retirement.test.ts` (new)
- `__tests__/trade-engine/auto-recalibration-weekly-schedule.test.ts` (new)
- `docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md` (this document, updated)

No Decision OS code, AI Coach, Chimmy, Manager Intelligence, recommendation math, or public API was touched. `runWeeklyRecalibration()` and `calibrateInterceptFromOutcomes()` were not deleted. The system is implemented but **disabled by default** — `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` is not set in any environment as part of this change.

---

## Activation Phase 2 — shadow rollout observability

Per the user's own framing: the architecture (Phase 1) being complete doesn't mean it's ready to flip on — an operator should be able to observe and reason about the system first. This phase adds monitoring; it changes no calibration math, no weights, and does not enable anything.

### 1. Audit of the existing calibration-metrics subsystem

`lib/trade-engine/calibration-metrics.ts` turned out to be **far more complete than the Phase 1 footnote suggested**: it's a fully-built dashboard-metrics engine — `computeCalibrationHealth()` (reliability curve, ECE, Brier score, prediction distribution, isotonic status), `computeSegmentDrift()`, `computeFeatureDrift()` (PSI/z-drift per feature), `computeRankingQuality()` (AUC, top-K hit rates, lift chart), `computeNarrativeIntegrity()`, `computeSummaryCards()`, `computeDrilldown()`, and `computeFullDashboard()` orchestrating all of them — with **zero callers anywhere in the codebase**, confirmed by repo-wide grep. None of it was rebuilt; `computeCalibrationHealth()` specifically (the calibration-quality subset directly relevant to weekly recalibration — ECE/Brier/reliability/isotonic) is now reused as-is by the new diagnostics endpoint below. `computeNarrativeIntegrity()`/`computeRankingQuality()`/`computeFeatureDrift()`/`computeSegmentDrift()` are AI-narrative-QA and ranking-quality concerns outside this phase's scope (trade-learning weekly recalibration specifically) and remain unwired — noted, not touched.

### 2. Diagnostics endpoint

**`GET /api/admin/trade-learning/diagnostics`** (`app/api/admin/trade-learning/diagnostics/route.ts`) — read-only, admin-authenticated via `requireAdminOrBearer()` (`lib/adminAuth.ts`, the same pattern already used by `/api/admin/metrics` and 20 other admin routes — admin session cookie, app session with an allow-listed admin email, or a bearer/admin-secret token for non-interactive checks). Only exports `GET`; no write handler exists. Accepts an optional `?season=` query param (defaults to 2025).

Backed by a new pure assembly function, `buildTradeLearningDiagnostics()` (`lib/trade-engine/diagnostics.ts`), which reads `TradeLearningStats` and derives:
- **`operational`**: is `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` currently set to `"true"`.
- **`calibratedB0`**: current value, its documented sole owner (`promoteShadowB0()`, per the ownership ADR), and when `calibrateFromFeedback()` last touched the row.
- **`shadow`**: pending shadow value, age in days, whether it has cleared the 7-day maturity gate, divergence from the active `calibratedB0`, whether that divergence is within the 0.40 cap, and sample size vs. the 30-row minimum — all four numbers/thresholds reused directly from `auto-recalibration.ts`'s own now-exported constants (`SHADOW_MATURITY_DAYS`, `MAX_SHADOW_DIVERGENCE`, `MIN_RECALIBRATION_SAMPLE`), never duplicated as separate literals.
- **`promotion`**: whether any `calibrationHistory` entry has ever been tagged `source: 'auto-recalibration'`, and its timestamp/value if so.
- **`scheduler`**: `lastRecalibrationAt`, days elapsed since, and a live, deterministic answer to "would a scheduled run proceed past the cadence gate right now, and if not, why" — computed the same way `runWeeklyRecalibration()`'s own internal cadence check works, reusing the same exported `RECALIBRATION_CADENCE_DAYS` constant, without re-invoking any write logic.
- **`segments`** and **`recentHistory`**: reused directly from stored `TradeLearningStats.segmentB0s`/`.calibrationHistory`.
- **`drift`**: a summary of the stored `driftReport` (written by the separate, already-reachable `runDriftDetection()` path) — overall severity, alert count, last-computed timestamp.
- **`calibrationHealth`**: the reused `computeCalibrationHealth()` output (ECE, Brier score, reliability curve, isotonic status) over a rolling 30-day window.

This endpoint performs **zero writes** — it only reads `TradeLearningStats` and calls the already-read-only `computeCalibrationHealth()`.

### 3. Structured logging

`runScheduledWeeklyRecalibration()` (`auto-recalibration.ts`) now logs, per invocation:
- `[TradeLearningScheduler] invoked (flag=enabled|disabled)` — every call, immediately.
- `[TradeLearningScheduler] skipped: <reason>` — when the flag is off (zero Prisma calls follow).
- `[TradeLearningScheduler] complete — shadowComputed=…, promoted=…, segments=…, isotonic=…` — after a real run, summarizing the outcome in one line.

`runWeeklyRecalibration()`'s own pre-existing logs (cadence-skip reason, shadow-computed values, promotion outcome, per-segment results, isotonic ECE before/after) are unchanged and complement the above — no new per-record log lines were added, keeping volume to a handful of lines per invocation.

### 4. Constants exported (no values changed)

`auto-recalibration.ts` now exports `DEFAULT_B0`, `MIN_RECALIBRATION_SAMPLE`, `MIN_SEGMENT_SAMPLE`, `MAX_B0_SHIFT`, `SHADOW_MATURITY_DAYS`, `MAX_SHADOW_DIVERGENCE`, `CURRENT_SEASON`, and a newly-named `RECALIBRATION_CADENCE_DAYS` (`= 6.5`, the same literal `runWeeklyRecalibration()`'s cadence check already used, now single-sourced so the diagnostics endpoint can never drift out of sync with the real check).

### Tests added
- `__tests__/trade-engine/diagnostics.test.ts` (9 tests) — flag reporting, safe defaults on an empty stats row, shadow maturity/divergence derivation, scheduler cadence derivation, promotion detection, and fail-safe behavior when the reused health computation throws.
- `__tests__/admin-trade-learning-diagnostics-route.test.ts` (4 tests) — admin-gate enforcement, default/explicit season parameter handling, and confirmation that only `GET` is exported (no write handlers).

### Verification
- `__tests__/trade-engine/` + the above two new files: **59/59 passing**.
- Every Decision OS trade-slice test file: **71/71 passing**, unchanged.
- `npm run typecheck`: 158 total errors repo-wide, identical to the Phase 1 baseline, zero new errors in any touched file.

### Remaining before production enablement (unchanged by this phase — this phase adds visibility, not readiness)
1. Real-world `TradeOutcomeEvent` volume vs. the 30/50-row sample gates — still unmeasured.
2. The 7-day maturity window still means no visible `calibratedB0` movement in the first week after enabling.
3. Nobody has decided who flips the flag or when — see `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`'s operational checklist for what to check before that decision.

## Files changed in the observability (Phase 2) session

- `lib/trade-engine/auto-recalibration.ts` (modified — exported existing constants, added `RECALIBRATION_CADENCE_DAYS`, added scheduler-level structured logging)
- `lib/trade-engine/diagnostics.ts` (new — `buildTradeLearningDiagnostics()`)
- `app/api/admin/trade-learning/diagnostics/route.ts` (new — the read-only diagnostics endpoint)
- `__tests__/trade-engine/diagnostics.test.ts` (new)
- `__tests__/admin-trade-learning-diagnostics-route.test.ts` (new)
- `docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md` (this document, updated)
- `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` (new — operator-facing rollout guide)

No calibration math, weights, Bayesian formulas, recommendation algorithms, Decision OS classifiers, AI Coach, Chimmy, Manager Intelligence, or public API was touched. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset in every environment.
