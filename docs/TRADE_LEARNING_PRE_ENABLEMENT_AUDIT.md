# Trade Learning — Pre-Enablement Data Readiness Audit

**Status:** Audit complete, real staging measurement done (Phase 4), **and the migration is now deployed + end-to-end validated on staging (Phase 9)**. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` **still not enabled anywhere**. No calibration math, thresholds, or recommendation logic changed.
**Branch:** `g15-event-foundation`
**Scope:** Phase 3 (§1–8, code-only) + Phase 4 (§9, real read-only staging measurement) + **Phase 9 (§10, migration deployment + real write validation)**, following Phase 1 (`0376b9ed0`), Phase 2 (`092b0a114`), Phase 8 (`7fb69eb4d`, capture implementation).
**Method:** Phase 3 made no database connection. Phase 4 ran read-only aggregates on staging. **Phase 9's task explicitly instructed deploying the migration and creating real test data on staging — both real write actions, confirmed via explicit user approval in that turn given the qualitatively different (and, for the enum addition, effectively permanent) nature of the actions versus every prior read-only phase.** All work stayed on the same confirmed staging branch (`staging-nfl-verify`, host `ep-winter-salad-ad34lce8`, project `icy-field-51189449`, branch `br-weathered-credit-addbjdlc`) — the `production` branch was never targeted.

---

## Data-readiness conclusion (headline)

**Updated by Phase 4's real measurement: staging has zero real trade-learning data across every relevant table. No-go on staging as it currently stands.** Phase 3 established that the mechanism itself is correct and fails closed on insufficient data. Phase 4 measured the actual row counts on staging and found `TradeOutcomeEvent`, `TradeOfferEvent`, `TradeLearningStats`, `LeagueTrade`, `TradeFeedback`, `af_league_trades`, and `af_league_trade_votes` are **all empty (0 rows)** — while the same branch has substantial real data elsewhere (251 real users), confirming this isn't a blank/broken database, just one where trade-learning specifically has never been populated. Enabling the flag on this staging branch today would be safe (every gate would correctly report "insufficient data" and do nothing) but would produce **zero observable signal**, indefinitely, until either real trade-evaluation traffic starts writing to these tables on this branch or a fresher branch/snapshot is used. See §9 for full detail and the exact go/no-go.

---

## 1. Real event volume — unmeasured, and why

This phase's task list asks for total outcome events, accepted/rejected/expired/countered/unknown breakdowns, per-season and per-league counts, per-segment counts, and oldest/newest timestamps. All of these require a live query against `TradeOutcomeEvent`/`TradeOfferEvent` in a real database. None of that was run this session — offered the choice at the start of this phase, the answer was local-only, consistent with how this exact question was resolved twice before (`docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md`, `PHASE2G`) for the separate Manager DNA/behavioral-events subsystem.

**What this means concretely:** every number this phase's task list asks for — total events, accepted/rejected/expired/countered/unknown counts, per-season, per-league, per-segment, oldest/newest timestamp — is **not stated in this document**, because stating a number without having queried it would be a fabrication, and this workstream's established practice throughout every prior phase (Phase 2C/2D/2F/2G/2I/2J of the Manager DNA workstream, `TRADE_LEARNING_ACTIVATION_BLOCKERS.md`'s own bug-discovery process) has been to always measure before asserting, never estimate confidently.

**What would be needed to get real numbers**, if a future turn explicitly approves it:

```sql
-- Total, by outcome type
SELECT outcome, COUNT(*) FROM "TradeOutcomeEvent" GROUP BY outcome;

-- By season
SELECT season, COUNT(*) FROM "TradeOutcomeEvent" GROUP BY season ORDER BY season;

-- By league (top leagues by volume)
SELECT "leagueId", COUNT(*) FROM "TradeOutcomeEvent" WHERE "leagueId" IS NOT NULL GROUP BY "leagueId" ORDER BY COUNT(*) DESC LIMIT 20;

-- Oldest / newest
SELECT MIN("createdAt"), MAX("createdAt") FROM "TradeOutcomeEvent";

-- Segment volume (via the matched TradeOfferEvent)
SELECT "isSuperFlex", "leagueFormat", "scoringType", COUNT(*)
FROM "TradeOfferEvent"
WHERE id IN (SELECT "offerEventId" FROM "TradeOutcomeEvent" WHERE "offerEventId" IS NOT NULL)
GROUP BY "isSuperFlex", "leagueFormat", "scoringType";
```

These are read-only aggregate `SELECT`/`COUNT`/`GROUP BY`/`MIN`/`MAX` queries — no row-level data, no writes. This is exactly the shape of query the diagnostics endpoint's own logic already performs internally (via `computeCalibrationHealth()`), just not yet run against a real environment.

---

## 2. Gate audit — verified logic, unmeasured real satisfaction

All values below are the real, exported constants from `lib/trade-engine/auto-recalibration.ts` (re-confirmed this session, unchanged from Phase 1/2) and `lib/trade-engine/isotonic-calibrator.ts`. "Verified" means covered by a passing test that exercises the real, unmodified function at and around the boundary. "Real data status" is honestly `unmeasured` throughout, per §1.

| Gate | Constant | Value | Verified by test? | Real data status |
|---|---|---|---|---|
| Minimum shadow-B0 recalibration sample | `MIN_RECALIBRATION_SAMPLE` | 30 (raw `TradeOutcomeEvent` rows, see caveat in §3) | Yes — `auto-recalibration-sample-composition.test.ts` (below/at/above threshold) | Unmeasured |
| Minimum per-segment sample | `MIN_SEGMENT_SAMPLE` | 50 | Yes — new test this phase (`computeSegmentB0s` excludes a 49-row segment, includes a 50-row one) | Unmeasured |
| Minimum isotonic-map sample | `MIN_ISOTONIC_SAMPLE` (`isotonic-calibrator.ts`, not exported — read directly from source) | 50 | Not re-tested this phase (PAVA-fitting logic, not a simple threshold; out of this phase's scope since it's calibration math) | Unmeasured |
| Shadow maturity window | `SHADOW_MATURITY_DAYS` | 7 | Yes — Phase 2's `diagnostics.test.ts` (7 days exactly matures; less does not) and Phase 1's `promoteShadowB0` test | Not time-dependent — always "unmeasured until 7 days after first shadow computation," regardless of volume |
| Maximum promotion divergence | `MAX_SHADOW_DIVERGENCE` | 0.40 | Yes — Phase 2's `diagnostics.test.ts` (0.20 passes, 0.80 fails) and Phase 1's `promoteShadowB0` test | Unmeasured (depends on what the real observed rate turns out to be) |
| Scheduled-run cadence | `RECALIBRATION_CADENCE_DAYS` | 6.5 | Yes — Phase 1/2 tests | N/A — this is a self-throttle, not a data-volume gate |

**Every gate fails closed when data is insufficient** (returns `null` / `not promoted` / segment excluded / diagnostics reports honest zeros and nulls) — reconfirmed by this phase's new tests, not merely assumed from Phase 1/2. No gate was found to fail *open* (i.e., no scenario was found where insufficient data produces a fabricated or misleadingly-confident result) **except the one caveat below**, which is about a *reported number's meaning*, not about a gate silently passing when it shouldn't.

---

## 3. One caveat found this phase — documented, not fixed

While validating gate logic against synthetic boundary data (`auto-recalibration-sample-composition.test.ts`), a precise, pre-existing characteristic of `computeShadowB0()` surfaced:

**`ShadowB0Metrics.sampleSize` (surfaced in diagnostics as `shadow.sampleSize`) does not mean "how many labeled (ACCEPTED/REJECTED/EXPIRED) outcomes fed the observed acceptance rate."** It means "how many outcomes of *any* kind — including `COUNTERED`/`UNKNOWN`, which `computeObservedAcceptRate()` correctly excludes from the rate calculation itself — had a matched `TradeOfferEvent` with a valid predicted probability." These two counts can differ substantially. Proven by test: 5 real `ACCEPTED` rows + 35 `COUNTERED` rows (all 40 with valid matched offers) produces `observedRate: 1` (correctly based on the 5 labeled rows) but `sampleSize: 40` (all 40, not 5).

**Why this is not fixed here:** correcting `sampleSize`/`predictedMean` to only count labeled rows would change the actual log-odds correction computed by `computeShadowB0()` — `predictedMean = sumPredicted / validCount` directly feeds the B0 shift math. That is a change to calibration math, explicitly out of scope for this phase (and every phase in this workstream has required its own review before touching that computation — see the ownership ADR's own governance precedent). It is also not a "clear bug" in the sense the Phase 0 enum mismatch was (an isolated, obviously-wrong string comparison with one unambiguous fix) — it's a genuine design characteristic of how the sample is composed, and deserves its own scoped review if it's ever addressed, not a fold-in here.

**Operational implication:** when real volume is eventually measured (§1) and when the diagnostics endpoint eventually shows a non-null `shadow.sampleSize`, do not read that number as "N real accept/reject data points." Cross-reference it against `shadow.divergenceFromActive`/`shadow.isMature` and, ideally, a direct count of `ACCEPTED`/`REJECTED`/`EXPIRED` rows (from the queries in §1) to know the *actual* labeled sample size behind a given shadow value.

---

## 4. Diagnostics validation result

`buildTradeLearningDiagnostics()` and its route were re-verified this phase, in addition to Phase 2's own 13 tests:

- New file `__tests__/trade-engine/auto-recalibration-sample-composition.test.ts` (4 tests): confirms `computeShadowB0()`'s raw-row gate and the sample-composition caveat above; confirms `computeSegmentB0s()` correctly excludes a segment one row below `MIN_SEGMENT_SAMPLE` and includes one exactly at it.
- Cross-checked every boundary comparison in `buildTradeLearningDiagnostics()` (`isMature = ageDays >= SHADOW_MATURITY_DAYS`, `withinDivergenceCap = divergence <= MAX_SHADOW_DIVERGENCE`, `wouldRunIfInvokedNow = daysSinceLastRecalibration >= RECALIBRATION_CADENCE_DAYS`, or null/never-run) line-by-line against the real early-return conditions in `promoteShadowB0()` and `runWeeklyRecalibration()` (`ageDays < SHADOW_MATURITY_DAYS`, `divergence > MAX_SHADOW_DIVERGENCE`, `daysSinceRecal < RECALIBRATION_CADENCE_DAYS`) — every comparison is the exact logical inverse of the corresponding real gate, so diagnostics cannot report a state inconsistent with what the real gate would actually do. **No bug found; no code changed.**
- The one gap noted: diagnostics does not itself echo `MIN_SEGMENT_SAMPLE`/`MIN_ISOTONIC_SAMPLE` inline next to the `segments` field (an operator has to know these values from this document rather than reading them from the API response). This is a completeness gap, not an inaccuracy — not fixed here, since it isn't a bug and this phase's constraints call for documenting insufficiency rather than expanding code.

**Conclusion: diagnostics is accurate.** It faithfully reports whatever the real, unmodified gate functions would compute — including faithfully surfacing the §3 caveat's `sampleSize` value exactly as `computeShadowB0()` produces it, rather than silently correcting or hiding it.

---

## 5. What an operator should expect during the first 7 days

Unchanged from `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` — repeated here because this phase's task list asks for it directly:

- The scheduler will fire weekly regardless of the flag; only what happens *after* the "invoked" log line depends on the flag.
- With `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED=true` and unknown real volume, the most likely first-week outcome — based on how the gates are built, not on any measured number — is `shadow.pending: false` (fewer than 30 raw outcome rows) or a pending-but-immature shadow (`isMature: false`) if the 30-row gate is cleared. **Neither is a failure.**
- No `calibratedB0` movement is possible before day 7 regardless of volume — the maturity gate is time-based, not just sample-based.
- Segment-level and isotonic-map results, if any, will very likely lag behind the global shadow value, since they each independently need ≥50 samples (global shadow needs only 30).

---

## 6. Exact flag, endpoint, and rollback (unchanged, restated for this deliverable)

- **Flag:** `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` (must be the literal string `"true"`; anything else, including unset, is disabled).
- **Endpoint to monitor:** `GET /api/admin/trade-learning/diagnostics` (admin-authenticated, read-only, optional `?season=`).
- **Rollback:** unset the flag (or set to any non-`"true"` value). Takes effect on the next scheduled invocation, no deploy required. Does not revert an already-promoted `calibratedB0` — see `TRADE_LEARNING_SHADOW_ROLLOUT.md`'s rollback section for the full caveat on that.

---

## 7. Is this safe to enable in shadow mode?

**Mechanically: yes.** Every gate verified this phase and in Phase 1/2 fails closed. Enabling the flag cannot corrupt `calibratedB0`, cannot bypass the maturity window, cannot bypass the divergence cap, and cannot silently promote on thin data — worst case with zero real volume, it logs a skip reason and writes nothing.

**Operationally: not yet recommended**, for one reason only — real volume is unmeasured, so nobody can currently say whether enabling it will produce any observable behavior within a reasonable evaluation window, or sit silent for weeks. That is not a safety concern, it's a "will this experiment tell you anything" concern. The concrete next step, when a future turn explicitly approves it, is the read-only staging query in §1 — a single, bounded, previously-used-precedent action, not a new production risk.

---

## 8. Remaining blockers before production enablement (as of Phase 3 — superseded by §9's measurement)

1. ~~Real-world volume measurement~~ — **done in Phase 4, §9. Result: zero.**
2. **The `sampleSize` composition caveat (§3)** — still relevant, unchanged: should be understood by whoever reads the diagnostics endpoint's numbers once real data starts flowing, so a promoted shadow isn't over-trusted based on a `sampleSize` that includes unlabeled rows.
3. **Who flips the flag, and when** — still explicitly undecided, still out of scope for this document to recommend.
4. **Staging-first rollout** — per `TRADE_LEARNING_SHADOW_ROLLOUT.md`'s checklist; moot until §9's data gap is closed, since there is nothing to observe yet on this staging branch either way.

---

## 9. Staging data measurement (Phase 4)

**Connected to:** Neon project `icy-field-51189449` ("All Fantasy"), branch `br-weathered-credit-addbjdlc` (`staging-nfl-verify`) — confirmed via `get_connection_string` to resolve to host `ep-winter-salad-ad34lce8-pooler`, an exact match for `.env.staging`. The `production` branch (`br-withered-shadow-adur64u9`, the project's default/primary branch) was explicitly identified and never targeted — every query below passed an explicit `branchId`, never relying on a default. Read-only `SELECT`/`COUNT`/`GROUP BY`/`MIN`/`MAX` only; no row-level or user-identifying data retrieved (league IDs, user IDs, and player-level detail were never selected).

### 9.1 Raw aggregate counts (real, measured)

| Table | Row count | Notes |
|---|---|---|
| `TradeOutcomeEvent` | **0** | `MIN(createdAt)`/`MAX(createdAt)` both `null` — no rows to have a timestamp. `GROUP BY outcome` and `GROUP BY season` both returned zero groups. |
| `TradeOfferEvent` | **0** | Including `acceptProb IS NOT NULL` count — also 0. |
| `TradeLearningStats` | **0** | No row for any season — not even a stub `season: 2025` row exists. Confirms `calibratedB0` on this branch would resolve purely to the in-code `DEFAULT_B0` fallback (-1.10), since `findUnique` returns `null`. |
| `LeagueTrade` (legacy, retired path) | **0** | The old `calibrateInterceptFromOutcomes()` path would also find nothing here. |
| `TradeFeedback` (real user votes) | **0** | `calibrateFromFeedback()` — the one part of `runFullCalibration()` still live — would also have nothing to work with. |
| `LeagueTradeHistory` | **0** | |
| `af_league_trades` / `af_league_trade_votes` (modern in-app trade proposals/votes) | **0 / 0** | |
| Sanity check: `app_users` | **251** | Confirms this is a real, populated branch overall — the zero counts above are specific to trade-learning tables, not an empty/broken database. |

**Per-league, per-segment breakdowns were not run**, because there is nothing to break down — every prerequisite count is zero. Oldest/newest timestamps: both `null` (no rows exist to have one).

### 9.2 Gate pass/fail summary (against real staging data)

| Gate | Threshold | Real staging value | Pass/fail |
|---|---|---|---|
| `MIN_RECALIBRATION_SAMPLE` (global shadow) | 30 raw outcome rows | 0 | **FAIL** |
| `MIN_SEGMENT_SAMPLE` (per segment) | 50 | 0 (no segments possible) | **FAIL** |
| `MIN_ISOTONIC_SAMPLE` | 50 | 0 | **FAIL** |
| `SHADOW_MATURITY_DAYS` | 7 days since shadow computed | N/A — no shadow has ever been computed (`shadowB0ComputedAt` doesn't exist because no `TradeLearningStats` row exists) | **N/A, not reached** |
| `MAX_SHADOW_DIVERGENCE` | 0.40 | N/A — same reason | **N/A, not reached** |
| `RECALIBRATION_CADENCE_DAYS` | 6.5 days since last run | N/A — `lastRecalibrationAt` doesn't exist; a scheduled run would proceed immediately (nothing to throttle against) and then find 0 outcomes | Cadence gate itself would pass (run would proceed), but immediately hit the sample-size gate above |

**Every volume-dependent gate fails on real staging data.** This is exactly what Phase 3 predicted was the "most likely first-week outcome" if real volume turned out to be thin — Phase 4 confirms volume isn't thin, it's zero.

### 9.3 Diagnostics validation result

The diagnostics builder was not executed as a live process against staging this session (that would require wiring a one-off script's `DATABASE_URL` to the staging connection string, a separate, less-controlled risk surface than the purpose-built, branch-scoped Neon SQL tool already used for every query above). Instead, validation was done by combining the real measured counts in §9.1 with the **existing, already-passing** Phase 3 test `'handles a completely empty TradeLearningStats row (no prior run ever) with safe defaults, no crash'` (`__tests__/trade-engine/diagnostics.test.ts`), which mocks exactly the scenario now confirmed to be staging's real state: `tradeLearningStats.findUnique` returning `null` for the season.

That test already asserts, and therefore the diagnostics endpoint would report, against real staging data:
- `calibratedB0.current: -1.10` (the `DEFAULT_B0` fallback)
- `shadow.pending: false`, `shadow.shadowB0: null`
- `promotion.hasEverBeenPromoted: false`
- `scheduler.lastRecalibrationAt: null`, `scheduler.wouldRunIfInvokedNow: true`, `scheduler.skipReasonIfAny: null`
- `segments: null`, `drift: null`

For `calibrationHealth` specifically: since both `TradeOutcomeEvent` and `TradeOfferEvent` are confirmed empty on staging, `computeCalibrationHealth()`'s internal `loadPairedData()` would join zero rows, deterministically producing `totalPaired: 0`, `ece: 0`, `brierScore: 0`, an all-zero `predictionDistribution`, and no alerts — the same "nothing to report" shape already exercised by the diagnostics test suite's `computeCalibrationHealth` mock returning `null`/empty.

**Conclusion: diagnostics is confirmed accurate for the real staging dataset.** No discrepancy between the real aggregate counts and what the (already-tested) diagnostics logic would report. No bug found; no code changed.

### 9.4 Go/no-go recommendation

**No-go, on this staging branch, as it currently stands.** Not because anything is unsafe — every gate fails exactly as designed — but because enabling `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` here would produce zero observable behavior indefinitely. There is nothing to shadow-test against. Two possible paths forward, neither executed in this session (out of scope — no production rollout, no threshold changes):

1. **Wait for this branch to accumulate real data** — if `staging-nfl-verify` is kept live and real trade-evaluation traffic runs against it (via the same `logTradeOfferEvent()`/`logTradeOutcomeEvent()` calls already wired into `quick-evaluate`/`league-analyze`/`goal-proposals`/`analyze`/`trade-evaluator`/`instant/trade`), volume would eventually accrue naturally.
2. **Refresh the staging branch from a more current production snapshot**, or point a staging environment at a branch that already has this traffic — this branch was snapshotted `2026-06-26`; if production has been accumulating real `TradeOutcomeEvent` rows since then via the same live code paths, a fresher snapshot might already clear the gates. This document does not check production and does not recommend which path to take — that is an infrastructure/ops decision outside this audit's scope.

### 9.5 Risks

- **Silent-forever risk, not corruption risk.** If the flag were enabled anyway on this branch, nothing breaks — it would just log `[AutoRecal] Only 0 outcomes, need 30. Skipping shadow b0.` every week, forever, until the underlying data gap is closed. An operator unaware of §9.1 might mistake "no promotion after months" for a bug rather than "no data."
- **This measurement is a point-in-time snapshot of one specific branch**, not a statement about production or about any other environment. It should not be read as "the platform has no real trade activity" — only that this specific staging branch, as of this session, has none in these specific tables.

### 9.6 Rollback note

No change was made, so there is nothing to roll back. If a future session enables the flag on a refreshed/different staging branch and wants to revert, the existing procedure in `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` (unset the flag; no deploy required) applies unchanged.

---

## 10. Staging migration deployment and end-to-end write validation (Phase 9)

Everything in §9 above was read-only. This section is not — it deployed the Phase 8 schema migration and created real (then cleaned-up) test data on staging, per the user's explicit approval that turn.

### 10.1 Migration deployment

The Phase 8 migration (`prisma/migrations/20260705010000_add_trade_learning_live_capture/migration.sql`) was applied to staging one statement at a time via the Neon SQL tool:

1. `ALTER TYPE "TradeOfferMode" ADD VALUE IF NOT EXISTS 'LIVE_PROPOSAL';` — succeeded.
2. `ALTER TABLE "TradeOfferEvent" ADD COLUMN "afLeagueTradeId" TEXT;` — succeeded.
3. `ALTER TABLE "TradeOutcomeEvent" ADD COLUMN "afLeagueTradeId" TEXT;` — succeeded.
4. `CREATE UNIQUE INDEX "TradeOfferEvent_afLeagueTradeId_key" ...` — succeeded.
5. `CREATE UNIQUE INDEX "TradeOutcomeEvent_afLeagueTradeId_key" ...` — succeeded.

**Verified after deployment:**
- `pg_enum` confirms `TradeOfferMode` now has 6 values including `LIVE_PROPOSAL`.
- `information_schema.columns` confirms both `afLeagueTradeId` columns exist, nullable, `text`.
- `pg_indexes` confirms both unique indexes exist exactly as named in the migration.
- A row was inserted into `_prisma_migrations` (checksum computed locally via `sha256sum`, matching Prisma's own convention) so future `prisma migrate deploy`/`status` calls on this branch correctly recognize this migration as already applied, rather than flagging drift.

**Not touched:** the `production` branch, at any point.

### 10.2 End-to-end write validation — two real bugs found and fixed

A one-off script (never committed — Node/`tsx`, run locally with `DATABASE_URL` pointed explicitly at the staging connection string, with a hard-coded safety assertion refusing to proceed unless the resolved host contained `ep-winter-salad` and did not contain `ep-curly-block`) created a dedicated, clearly-labeled, fully isolated test league (`platform: 'phase9_validation'`) — never touching any existing real staging data — with 2 test users, 2 test rosters, and 5 real `AfLeagueTrade` + `AfLeagueTradeItem` rows, then called the real, unmodified `captureLiveTradeOffer()`/`captureLiveTradeOutcome()` functions against them.

**First run surfaced a real bug:** every trade after the first failed to log an offer event at all (`Unique constraint failed on the fields: (inputHash)`). Root cause: `computeInputHash()` (`lib/trade-engine/trade-event-logger.ts`) never accounted for `afLeagueTradeId` — two distinct real trades sharing identical test assets collided on the pre-existing content-hash unique constraint, and the P2002 fallback (which looks up an existing row by `afLeagueTradeId`) correctly found nothing, since no row for that trade was ever created — silently returning `null`. This is exactly the "invisible to calibration" failure mode the whole ADR was written to avoid, now found for real. **Fixed**: `computeInputHash()` now folds `afLeagueTradeId` into its payload when present (a no-op — `JSON.stringify` drops `undefined` keys — for the five existing hypothetical-evaluation callers, which never pass it).

**Same run surfaced a second real bug**, found while validating calibration ingestion: `computeShadowB0()` reported "0 outcomes" despite 4 real, correctly-linked outcome rows existing. Root cause: `captureLiveTradeOffer()`/`captureLiveTradeOutcome()` never populated `season` at all, even though `League.season` was directly available and always has a real value (`@default(2026)`, never null). Every real capture would have been permanently invisible to any season-scoped calibration query — not a validation-script artifact, a structural gap. **Fixed**: `captureLiveTradeOffer()` now passes `input.league.season`; `captureLiveTradeOutcome()` inherits `season` from its own linked offer event (avoiding an extra query) unless the caller explicitly overrides it.

**Re-run after both fixes, on freshly re-created test data**, succeeded completely:

| Scenario | Offer captured | Outcome captured | Linked correctly | Idempotent retry |
|---|---|---|---|---|
| Accepted (`processed`) | ✅ | `ACCEPTED` | ✅ `offerEventId` matches | ✅ both offer and outcome retries returned the same id, no duplicate row |
| Rejected | ✅ | `REJECTED` | ✅ | — |
| Vetoed | ✅ | `UNKNOWN` (per the approved mapping, not `REJECTED`) | ✅ | — |
| Countered | ✅ | `COUNTERED` | ✅ | — |
| Non-terminal (`awaiting_commissioner`) | ✅ (offer capture is unconditional at proposal time) | *(none — correct)* | N/A | — |

All 5 offer rows and all 4 outcome rows were confirmed present in the real staging database via direct query afterward, with `season: 2026` now correctly populated on every row (matching `League.season`'s real default).

### 10.3 Diagnostics validated against real data

`buildTradeLearningDiagnostics()` (the same function behind `GET /api/admin/trade-learning/diagnostics`) was called directly against staging with this real test data present. It correctly reported `operational.weeklyRecalibrationEnabled: false`, honest `shadow`/`promotion` nulls (no shadow computed yet — sample too small), and `calibrationHealth.totalPaired: 2` (its own independent 30-day window query correctly found 2 of the 5 real offers that had a matching accept/reject-labeled outcome). No discrepancy between the tool's output and direct database queries of the same data.

### 10.4 Calibration ingestion validated — including a real, un-fixed operational finding

`computeShadowB0()` — called directly, unmodified — correctly read the real captured data **once queried with the matching season**. Calling it with its default parameter (`season: 2025`, i.e. `computeShadowB0()` with no argument) found "0 outcomes," which is not a bug in the capture code (confirmed: the real rows genuinely have `season: 2026`, correctly populated) — it is because **`CURRENT_SEASON`/`CALIBRATION_SEASON` are hardcoded to `2025` throughout `lib/trade-engine/{accept-calibration,auto-recalibration}.ts`, while `League.season` already defaults to `2026`** (the actual current season, per this workstream's own timeline). Calling `computeShadowB0(2026)` explicitly found the real data immediately (`"Only 4 outcomes, need 30"` — correct, honest, and exactly the expected gate behavior for real staging volume this small).

**This is a real, load-bearing operational finding, not fixed here** — changing the hardcoded season constants is a threshold/configuration decision explicitly out of this phase's scope ("do not tune thresholds"). It means: **whoever eventually schedules `runWeeklyRecalibration()` must ensure it is invoked with the current real season, not relying on the function's own stale hardcoded default**, or real 2026-season data will silently never be considered. Added to the remaining blockers below.

### 10.5 Cleanup

All test data (5 `AfLeagueTrade` + items, 5 `TradeOfferEvent`, 4 `TradeOutcomeEvent`, 1 league, 2 users) was deleted after validation completed, restoring staging to the same clean, zero-row state Phase 4 measured — so a future genuine volume measurement isn't polluted by this validation's synthetic data. Confirmed via direct query: 0 leftover rows across every touched table.

---

## 11. Canonical season resolution (Phase 10) — the §10.4 finding, resolved architecturally

§10.4 above documented a real, load-bearing gap left deliberately unfixed at the time: `computeShadowB0()`/`getCalibratedWeights()`/etc. defaulted to a hardcoded `season` (`CURRENT_SEASON`/`CALIBRATION_SEASON`, both `2025`), independently duplicated across five files, while real `League.season` already defaulted to `2026`. Rather than a one-line default-value edit, this phase eliminated the concept of a hardcoded calibration season entirely, per explicit user instruction: *"this is the right point to make season ownership deterministic"* — read with an eye to the Decision OS being a long-lived platform, not a single-season project.

### 11.1 Complete inventory (before any change)

Every hardcoded season location in the trade-learning subsystem, found via exhaustive grep across `lib/trade-engine/`, `lib/trade-learning.ts`, and the diagnostics route:

| File | Location | Form |
|---|---|---|
| `lib/trade-engine/accept-calibration.ts` | `CALIBRATION_SEASON = 2025` | named constant, 5 default-param usages |
| `lib/trade-engine/auto-recalibration.ts` | `export const CURRENT_SEASON = 2025` | named constant (confirmed: zero external importers), 4 default-param usages |
| `lib/trade-engine/isotonic-calibrator.ts` | `const CURRENT_SEASON = 2025` | **separate, independently-defined constant** despite the identical name to the one above — not the same binding |
| `lib/trade-engine/diagnostics.ts` | `const DEFAULT_SEASON = 2025` | named constant, 1 default-param usage |
| `lib/trade-engine/calibration-metrics.ts` | `where: { season: 2025 }` | raw literal, no named constant, inside `computeCalibrationHealth()`'s isotonic-status lookup |
| `lib/trade-engine/drift-detection.ts` | `season: number = 2025` | raw literal default, no named constant |
| `lib/trade-engine/trade-event-logger.ts` | `season: number = 2025` | raw literal default, no named constant |
| `lib/trade-learning.ts` | `season: number = 2025` ×2, plus 4 explicit `(2025)` call-site literals inside `runBackgroundTradeAnalysis()` | mixed |
| `app/api/admin/trade-learning/diagnostics/route.ts` | `const DEFAULT_SEASON = 2025` | a **second, independent** hardcoded default, one layer above `buildTradeLearningDiagnostics()`, found during implementation — not in the original grep pass, added to this inventory for completeness |

Also confirmed via exhaustive search: **no pre-existing canonical "current platform season" resolver existed anywhere in the codebase.** Checked and ruled out: Decision OS's own `lib/decision-os/world/facts.ts` (`LeagueFacts.season` is a pure per-league pass-through of the real `League.season` field, not a platform-wide resolver — reused as the data source, not duplicated); `lib/sportConfig/` (only has `seasonWeeks`, unrelated); `lib/workers/sports-data-importer.ts` (a private, non-exported, naive `currentSeasonForSport(): number { return new Date().getFullYear() }` — not reusable, and doesn't account for the NFL season-year boundary correctly). Two other, unrelated `CURRENT_SEASON`-named constants exist in different subsystems (`lib/draft-room/rookieFilterPredicate.ts`'s `CURRENT_SEASON_YEAR`, `lib/rankings-engine/sleeper-matchup-cache.ts`'s own separate `CURRENT_SEASON = 2025`) — both are out of scope for this trade-learning-focused phase and were left untouched.

### 11.2 Canonical ownership

**`resolveCurrentTradeLearningSeason()`, exported from the new `lib/trade-engine/season-resolver.ts`, is now the single canonical season-resolution path for the entire trade-learning subsystem.** Design:

- **Primary:** `MAX(League.season)` — reuses the real, already-canonical per-league value every live trade capture writes (Phase 8/9), rather than inventing a second season concept. As real seasons roll over, new `League` rows carry the new value and this resolver picks it up automatically — zero code changes needed at rollover, which is exactly the "long-lived platform" property this phase set out to establish.
- **Fallback** (cold start with zero `League` rows, or if the query itself throws): `computeSeasonFromDate()`, a deterministic, provider-agnostic, database-free NFL-style Sept–Aug season-year computation. Fails safe, never throws — matches this workstream's established convention for every other capture/logging function.
- **Cached** 1 hour, mirroring `accept-calibration.ts`'s pre-existing `CACHE_TTL_MS` pattern. `invalidateSeasonResolverCache()` exported for tests/ops.

Every function that used to default to a hardcoded season now takes `season?: number` and resolves internally with `season ?? await resolveCurrentTradeLearningSeason()` — JS/TS forbids `await` in a default-parameter expression, so resolution happens in the function body, not the signature. An explicit argument always overrides the resolver, which is also how historical/manual season lookups work (e.g. the new integration test proves `computeShadowB0(2024)` never touches the resolver at all).

### 11.3 Files changed and hardcoded references removed

- **New:** `lib/trade-engine/season-resolver.ts` (`computeSeasonFromDate`, `resolveCurrentTradeLearningSeason`, `invalidateSeasonResolverCache`).
- `lib/trade-engine/accept-calibration.ts` — `CALIBRATION_SEASON` constant removed; `calibrateInterceptFromOutcomes`, `calibrateFromFeedback`, `getCalibratedWeights`, `calibrateAcceptProbability`, `runFullCalibration` all now `season?: number`.
- `lib/trade-engine/auto-recalibration.ts` — `CURRENT_SEASON` constant removed; `computeShadowB0`, `promoteShadowB0`, `computeSegmentB0s`, `runWeeklyRecalibration` all now `season?: number`. `runWeeklyRecalibration()` resolves once at the top and threads the single resolved value through every downstream call (promotion, shadow, segments, isotonic) — verified by a dedicated integration test asserting `league.aggregate` is called exactly once per cycle.
- `lib/trade-engine/isotonic-calibrator.ts` — its own separate `CURRENT_SEASON` constant removed; `computeAndStoreIsotonicMap` now `season?: number`.
- `lib/trade-engine/diagnostics.ts` — `DEFAULT_SEASON` constant removed; `buildTradeLearningDiagnostics` now `season?: number`; passes the resolved season through to `computeCalibrationHealth()` explicitly rather than letting it re-resolve independently.
- `lib/trade-engine/calibration-metrics.ts` — the raw `where: { season: 2025 }` literal replaced; `computeCalibrationHealth` gained an optional `season` parameter.
- `lib/trade-engine/drift-detection.ts` — `runDriftDetection` now `season?: number`.
- `lib/trade-engine/trade-event-logger.ts` — `logAcceptedTradesAsOutcomes` now `season?: number`.
- `lib/trade-learning.ts` — `aggregateTradeLearningInsights`, `getLearningContextForAI` now `season?: number`; `runBackgroundTradeAnalysis()`'s four explicit `(2025)` call-site literals replaced with one `resolveCurrentTradeLearningSeason()` call, resolved once and threaded through insights aggregation, calibration, drift detection, and outcome backfill for the whole background cycle.
- `app/api/admin/trade-learning/diagnostics/route.ts` — its own independent `DEFAULT_SEASON` fallback removed; when no `?season=` query param is given, `undefined` is passed through so `buildTradeLearningDiagnostics()` resolves the season itself, rather than the route pre-empting it with a second, competing default.

**Real-world effect, reasoned through and accepted as in-scope:** all 8 real, live production trade-evaluation routes (`quick-evaluate`, `league-analyze`, `goal-proposals`, `analyze`, `trade-value-console`, `core-engine.ts`, `trade-evaluator`, `instant/trade`) call `getCalibratedWeights()`/`calibrateAcceptProbability()` with no season argument — they now resolve through the canonical path instead of the stale `2025` default. This changes *which season's row gets read*, not any calibration formula, threshold, or recommendation logic, so it stays within this phase's scope. It has no observable effect today, since no season has any real promoted calibration data yet.

### 11.4 Regression tests added

- `__tests__/trade-engine/season-resolver.test.ts` — direct unit coverage: `computeSeasonFromDate()`'s Sept–Aug boundary (including the January-rolls-back-to-prior-year case), `resolveCurrentTradeLearningSeason()`'s primary path, caching, cache invalidation, cold-start fallback, and fail-safe behavior when the query throws.
- `__tests__/trade-engine/canonical-season-resolution-integration.test.ts` — cross-component wiring proof: `computeShadowB0()`, `getCalibratedWeights()`, `buildTradeLearningDiagnostics()`, and `runWeeklyRecalibration()` (the actual scheduler entry point) each resolve through the same real (unmocked) `resolveCurrentTradeLearningSeason()`, backed only by a mocked `prisma.league.aggregate` — and an explicit season argument is proven to bypass the resolver entirely (`computeShadowB0(2024)` never calls `league.aggregate`).
- `__tests__/admin-trade-learning-diagnostics-route.test.ts` — updated: the "defaults to season 2025" assertion (testing the route's own since-removed hardcoded default) replaced with an assertion that the route passes `undefined` through when no `?season=` is given, leaving resolution to the canonical resolver.

### 11.5 Verification

`npx tsc --noEmit` (full project, heap increased to work around the pre-existing Windows/Next.js OOM issue documented separately) completed with its existing, unrelated baseline error set unchanged — zero new errors in any file touched this phase. `npx vitest run __tests__/trade-engine/` (11 files, 78 tests), the three other trade-learning-adjacent top-level test files (29 tests), and all 9 Decision OS trade-slice test files (122 tests) — **229 tests total, all green.**

### 11.6 Remaining blockers before enabling weekly recalibration in staging

Unchanged from §10.4's original list, minus the season item it named (now resolved):

- Real, organic trade activity still needs to accumulate on staging — this phase changed *which* season gets queried, it did not create new trade volume.
- `AfLeagueTrade.status` still never transitions to `'expired'` anywhere in the codebase (a pre-existing, documented gap from Phase 8, out of scope for every phase so far).
- The flag (`TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED`) remains unset in every environment, as required.

---

## 12. Staging shadow-traffic rehearsal (Phase 11) — volume proven reachable, then cleaned up

§11.6 left "real, organic trade activity still needs to accumulate on staging" as the sole remaining blocker before enabling anything. This phase did not (and structurally cannot) create *real* organic volume — only actual users making actual trade decisions can do that. What it did instead: proved, with real writes against the real staging schema, that once that volume exists, every downstream function (capture, calibration, diagnostics) handles it correctly at the required scale — a rehearsal, not a substitute.

### 12.1 Staging state confirmed before generating anything

- **App code**: this branch's `HEAD` (`980904e8e`) has `7fb69eb4d` (Phase 8) and `8f00bdba8` (Phase 9) as ancestors — confirmed via `git merge-base --is-ancestor`. No separately-deployed staging web application URL or Vercel/Railway API access was available this session (Railway MCP returned `Unauthorized`; no Vercel CLI; no staging app URL discoverable in the repo) to independently confirm a *deployed instance* is running this exact code — every prior phase in this workstream (4, 9) validated the same way: by running the current local codebase directly against the real staging database via `DATABASE_URL` override, not by hitting a deployed staging web server. This phase followed that same, already-established methodology.
- **Migration**: `_prisma_migrations` on staging has `20260705010000_add_trade_learning_live_capture` recorded (`finished_at: 2026-07-05T16:48:44.872Z`); `pg_enum` confirms `LIVE_PROPOSAL` on `TradeOfferMode`; `information_schema.columns` confirms both `afLeagueTradeId` columns exist (nullable `text`) — all re-verified fresh this phase, matching Phase 9's original deployment record exactly.
- **Pre-generation volume**: 0 `TradeOfferEvent`, 0 `TradeOutcomeEvent`, 0 `af_league_trades`, against 56 real leagues (`MAX(season) = 2026`) — confirming zero organic volume had accumulated since Phase 9's cleanup, exactly as §11.6 anticipated.

### 12.2 Traffic plan (proposed, then approved before execution)

4 dedicated, clearly-labeled test leagues (`platform: 'phase11_shadow_traffic'`, names prefixed `PHASE11 SHADOW TRAFFIC (DELETE ME)`, never touching any of the 56 real leagues), 2 SuperFlex + 2 1QB for basic scoring diversity, 8 test managers each (32 total, emails/usernames prefixed `phase11_...@phase11.invalid`), 42 real `AfLeagueTrade` + item rows using synthetic (non-resolvable) player references — relying on the same documented flat-fallback-value convention (`LIVE_CAPTURE_FALLBACK_VALUE = 200`) the capture pipeline already uses for any unresolvable asset, since staging's real `Player` table was found to be completely empty (0 rows) this session.

**Outcome mix (42 total):** 20 `processed`→`ACCEPTED`, 12 `rejected`→`REJECTED`, 5 `countered`→`COUNTERED`, 3 `cancelled`→`UNKNOWN`, 2 `vetoed`→`UNKNOWN` — 32 labeled (ACCEPTED+REJECTED) outcomes, clearing `MIN_RECALIBRATION_SAMPLE` (30) with a small buffer, while still exercising every mapped status in the ADR's Decision 2 table except `expired` (excluded deliberately — no live code path produces it, per the already-documented gap).

Executed by calling the real, unmodified `captureLiveTradeOffer()`/`captureLiveTradeOutcome()` functions directly (the same functions Phase 9 exercised, at greater volume) rather than driving the full `tradeService.ts` orchestration layer — mirroring Phase 9's deliberate scope decision to exercise 100% of the trade-learning capture code against real infrastructure without triggering unrelated side effects (notifications, websocket broadcasts) that the full service layer would also fire.

### 12.3 Executed — real writes, real measurement

Ran via a local script (never committed), `DATABASE_URL` explicitly overridden with the same `ep-winter-salad`-required / `ep-curly-block`-forbidden safety assertion used in every prior real-write phase. Result: **all 42 trades generated with zero offer-capture failures and zero outcome-capture failures.**

**Real database counts, queried directly, immediately after generation:**

| Metric | Value |
|---|---|
| `TradeOfferEvent` (mode `LIVE_PROPOSAL`) | 42 |
| `TradeOutcomeEvent` (linked via `afLeagueTradeId`) | 42 |
| `af_league_trades` created | 42 |
| Outcome distribution | `ACCEPTED: 20`, `REJECTED: 12`, `COUNTERED: 5`, `UNKNOWN: 5` (3 cancelled + 2 vetoed, correctly merged per the ADR's Decision 2 mapping) |
| `season` on every row | `2026` (uniform — confirms the Phase 10 resolver and `League.season` inheritance both worked correctly at volume, not just for Phase 9's single test league) |

**Diagnostics/calibration validated against this real data, with no explicit season argument passed to anything** (proving the Phase 10 canonical resolver, not a hardcoded value, is what found this data):

- `computeShadowB0()` → `sampleSize: 42` (clears the 30-sample gate), `observedRate: 0.625` (20/32, correct), `computedB0: -0.5` (an intercept correction of `+0.60` from the current `-1.10`, landing exactly on `MAX_B0_SHIFT`'s clamp ceiling — expected, not a bug, given the synthetic data's artificially high accept rate relative to its uniformly-low predicted probability). `mature: false` (correct — `computeShadowB0()` is a pure read, it does not persist; nothing calls `runWeeklyRecalibration()` unless the still-disabled flag is on, which it remains).
- `buildTradeLearningDiagnostics()` → `season: 2026` (resolved automatically), `shadow.pending: false` (correct, same reason as above — no persistence happened), `scheduler.wouldRunIfInvokedNow: true`, `calibrationHealth.totalPaired: 32` (matches the labeled-outcome count exactly).
- `calibrationHealth.alerts` flagged `critical: ECE exceeds critical threshold (0.375 > 0.12)`. **This is an expected artifact of the synthetic data, not a real calibration-quality finding**: every trade used non-resolvable fake player assets, so every prediction collapsed to the same flat fallback value (`predictedMean: 0.25` for all 42), against a synthetic accept rate (0.625) chosen for sample-size testing rather than realism. A real, organic trade population — real assets, real value spread — would not be expected to reproduce this degenerate pattern. Recorded here so a future operator isn't confused by a stale alert; it does not persist (nothing was left in `TradeLearningStats`, see §12.4).

### 12.4 Cleanup — verified back to the exact pre-generation state

All 42 `TradeOutcomeEvent`, 42 `TradeOfferEvent`, 84 `AfLeagueTradeItem`, 42 `AfLeagueTrade`, 32 `Roster`, 4 `League`, and 32 `AppUser` rows were deleted immediately after measurement, by exact ID (the full manifest was captured at generation time). Verified via direct query afterward: **0 remaining rows matching any of this run's IDs**, and a fresh independent count confirms staging is back to 0 `TradeOfferEvent` / 0 `TradeOutcomeEvent` / 0 `af_league_trades` / 56 leagues (unchanged) — identical to the pre-generation state in §12.1. This was a deliberate choice, not an oversight: leaving synthetic "organic-looking" data in the real calibration pool would corrupt whatever real volume measurement happens next (§11.6's still-open item), since `computeShadowB0()` cannot distinguish synthetic test data from real trades within the same season.

### 12.5 Readiness assessment

**Pipeline readiness: proven at the required scale.** Every function on the path from a real trade action to a calibration-ready sample — `captureLiveTradeOffer()`, `captureLiveTradeOutcome()`, the ADR's status mapping, `computeShadowB0()`, `buildTradeLearningDiagnostics()`, all resolving season through the single Phase 10 canonical path — now has direct evidence of working correctly at 42 real, linked, correctly-seasoned rows, not just Phase 9's original 5. Zero failures, zero data-integrity issues, zero season mismatches.

**Data readiness: unchanged, still the sole blocker.** This phase could not and did not create real organic volume — that requires actual users making actual trade decisions on staging, which remains outside any single script's or session's control. `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`'s operational checklist item "let real, organic trade activity accumulate on staging" is still open.

### 12.6 Remaining blockers before enabling weekly recalibration in staging

- **Real, organic trade activity must still accumulate on staging** — the sole item carried forward from §11.6, unchanged by this phase (by design — synthetic rehearsal data cannot and should not substitute for it).
- `AfLeagueTrade.status` still never transitions to `'expired'` anywhere in the codebase (unchanged, pre-existing Phase 8 finding).
- The flag (`TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED`) remains unset in every environment, as required.

---

## Files changed in this session

- `docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md` (this document, updated with §9, then §10, then §11)
- `lib/trade-engine/trade-event-logger.ts` (bug fix — `computeInputHash()` now folds in `afLeagueTradeId`)
- `lib/league-trade-engine/tradeLearningCapture.ts` (bug fix — `season` now populated on both offer and outcome capture)
- `__tests__/trade-engine/trade-event-logger-live-capture-hash.test.ts` (new — regression test for the inputHash fix)
- `__tests__/trade-engine/trade-learning-capture.test.ts` (updated — regression tests for the season fix)
- `prisma/migrations/20260705010000_add_trade_learning_live_capture/` — **deployed to staging** (not production)
- `lib/trade-engine/season-resolver.ts` (new, Phase 10 — the canonical season resolver)
- `lib/trade-engine/{accept-calibration,auto-recalibration,isotonic-calibrator,diagnostics,calibration-metrics,drift-detection,trade-event-logger}.ts`, `lib/trade-learning.ts`, `app/api/admin/trade-learning/diagnostics/route.ts` (Phase 10 — hardcoded season constants/defaults removed, routed through the resolver)
- `__tests__/trade-engine/season-resolver.test.ts`, `__tests__/trade-engine/canonical-season-resolution-integration.test.ts` (new, Phase 10); `__tests__/admin-trade-learning-diagnostics-route.test.ts` (updated, Phase 10)
- `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md` (updated, Phase 10 — canonical season ownership documented, checklist item resolved; updated again Phase 11 — shadow-traffic rehearsal record)
- Phase 11 touched no application code — only this document (§12) and `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`. All Phase 11 activity was real staging writes (42 trades + fixtures, generated then fully deleted) via uncommitted local scripts, plus read-only measurement queries.
- Phase 12 touched no application code — only this document (§13) and `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`. All Phase 12 activity was read-only measurement queries against staging; no writes were made.

No calibration math, thresholds, recommendation logic, Decision OS classifiers, AI Coach, Chimmy, Manager Intelligence, or public API was touched. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset in every environment. Staging was written to in Phase 9 (migration + test data, cleaned up) and Phase 11 (42-trade shadow-traffic rehearsal, cleaned up) with explicit user approval each time; Phase 10 and Phase 12 made no database writes; production was never touched at any point in this workstream.

---

## 13. Staging shadow enablement readiness decision (Phase 12) — NO-GO

Phase 11 closed with one open item: real, organic trade activity accumulating on staging. This phase re-measured that item directly, to produce a go/no-go recommendation on enabling `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` in staging.

### 13.1 Staging state re-confirmed

- **Code**: current `HEAD` (`3f68617cc`) has `7fb69eb4d`/`8f00bdba8`/`980904e8e` as ancestors — confirmed via `git merge-base --is-ancestor`, same methodology as Phase 11 (no deployed staging web app URL or Vercel/Railway API access available to check independently).
- **Migration**: `_prisma_migrations` still shows `20260705010000_add_trade_learning_live_capture` applied (`finished_at: 2026-07-05T16:48:44.872Z`), unchanged since Phase 9/11.
- **Phase 11 leftovers**: 0 — `leagues WHERE platform = 'phase11_shadow_traffic'` returns 0 rows, confirming the Phase 11 rehearsal's cleanup held.

### 13.2 Real organic volume — measured, unchanged since before Phase 11

| Metric | Value |
|---|---|
| `TradeOfferEvent` count | **0** |
| `TradeOutcomeEvent` count | **0** |
| Outcome distribution | *(no rows — nothing to distribute)* |
| Season distribution | *(no rows)* |
| Oldest / newest event timestamp | *(null / null — no rows exist)* |
| Real leagues on staging | 56 (`MAX(season) = 2026`, unchanged) |

No real trade has produced a live-captured event on staging since Phase 9/11's synthetic data was deleted. This is expected, not a regression — nothing in this workstream deploys traffic-generating users to staging; only an actual deployed instance receiving actual user trade actions can create this data, and that has not happened yet.

### 13.3 Diagnostics — called with no explicit season argument

`computeShadowB0()` → `null` (correctly short-circuits: `[AutoRecal] Only 0 outcomes, need 30. Skipping shadow b0.`). `computeObservedAcceptRate()` → `null` (no outcomes to label). `buildTradeLearningDiagnostics()` → resolves `season: 2026` correctly via the Phase 10 canonical resolver even with zero trade-learning data present (proving the resolver's `MAX(League.season)` path is independent of trade-learning volume itself — it only needs real `League` rows, which exist) — every other field honestly reports empty (`shadow.pending: false`, `calibrationHealth.totalPaired: 0`, `alerts: []`, `promotion.hasEverBeenPromoted: false`). No fabricated or stale data anywhere in the output.

### 13.4 Gate comparison

| Gate | Threshold | Current value | Result |
|---|---|---|---|
| `MIN_RECALIBRATION_SAMPLE` | 30 | 0 | **FAIL** |
| `MIN_SEGMENT_SAMPLE` | 50 (per segment) | 0 | **FAIL** |
| `SHADOW_MATURITY_DAYS` | 7 | N/A — no shadow value has ever been computed to mature | **FAIL** (nothing to mature) |
| `MAX_SHADOW_DIVERGENCE` | 0.40 | N/A — no shadow value exists to compare against `calibratedB0` | **FAIL** (nothing to compare) |
| `RECALIBRATION_CADENCE_DAYS` | 6.5 | N/A — never run (`lastRecalibrationAt: null`) | Not a blocker by itself (`wouldRunIfInvokedNow: true`) — but running it would immediately hit the sample-size gate above and no-op |

### 13.5 Go/no-go recommendation: **NO-GO**

Enabling `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` in staging right now would have **zero effect** other than a weekly log line — the very first gate (`MIN_RECALIBRATION_SAMPLE`) fails by the full margin (0 of 30 required), and every downstream gate depends on clearing it first. Per this phase's explicit instruction, the flag was **not** enabled, and no environment-variable change was applied anywhere.

**The exact flag change, prepared for if/when real volume clears the gate (not applied):**

```
TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED=true
```

Set in the staging environment only, never production. No code deploy is required to apply it — per `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`'s existing "How to enable it" section, this is a pure environment-variable flip against already-deployed, already-inert code.

### 13.6 Remaining blocker (sole item)

- **Real, organic trade activity must accumulate on staging** — unchanged from §11.6/§12.5. This requires an actual deployed instance of this code receiving actual user trade actions; no script or measurement performed in this workstream can substitute for it, and per this phase's explicit scope, no synthetic rows were seeded as if they were real evidence. Once ≥30 real, linked `TradeOutcomeEvent` rows with a labeled (`ACCEPTED`/`REJECTED`/`EXPIRED`) outcome exist for the current season, re-run this same measurement — if the gate clears, the prepared flag change above can be applied with a fresh go/no-go check against the other four gates at that time.
