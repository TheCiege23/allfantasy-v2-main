# ADR Phase 4.5 — Stage 1 Activation Readiness Checkpoint

**Date:** 2026-06-30
**Branch:** `g15-event-foundation`
**Status:** APPROVED — documentation checkpoint; no code changed
**Prerequisites:**
- Phase 4.1 Commissioner Stage 0→1 (commit `d54c43ca3`) — 608 tests GREEN
- Phase 4.2 Trade Stage 0→1 (commit `323385f7f`) — 622 tests GREEN
- Phase 4.3 Waiver Stage 0→1 (commit `debd8b2b7`) — 636 tests GREEN
- Phase 4.4 Lineup Stage 0→1 (commit `0491144b7`) — 650 tests GREEN
- All 5 conformance scripts GREEN on `ep-winter-salad` after each phase

---

## Purpose

All four Decision OS slices have completed Stage 0→1 implementation. This ADR documents the
exact state of each slice, the safe production activation plan, the telemetry requirements,
and the 7-day soak criteria before any slice may advance to Stage 2.

**No Stage 2 work is started or implied by this document.** Stage 2 (UI reads Decision OS first,
legacy as fallback) requires its own ADR per the Architecture Freeze workflow.

---

## Stage 1 Implementation Summary

Each kill switch, when set to `true`, appends an optional `decisionOs` field to the respective
route response. The legacy response fields are always present and unchanged. Failures are isolated
in try/catch and never propagate to the caller.

| Slice | Kill Switch Env Var | Added Field | Route |
|-------|---------------------|-------------|-------|
| Commissioner | `DECISION_OS_COMMISSIONER_HEALTH_LIVE` | `decisionOsShadow` on each `CommissionerLeagueHealthSnapshot` | `lib/commissioner-hub/commissionerHubHealth.ts` |
| Trade | `DECISION_OS_TRADE_LIVE` | `decisionOs` on trade proposal creation response | `app/api/redraft/trade-proposals/route.ts` |
| Waiver | `DECISION_OS_WAIVER_LIVE` | `decisionOs` on waiver engine response | `app/api/waiver-ai/engine/route.ts` |
| Lineup | `DECISION_OS_LINEUP_LIVE` | `decisionOs` on today lineup-actions response | `app/api/today/lineup-actions/route.ts` |

---

## Per-Slice Stage 1 Detail

---

### Slice 1 — Commissioner (`DECISION_OS_COMMISSIONER_HEALTH_LIVE`)

**What it adds to the response:**
```ts
// CommissionerLeagueHealthSnapshot — decisionOsShadow populated for ALL database-source leagues
decisionOsShadow: {
  decisionId: string           // stable decision ID for telemetry correlation
  parityPassed: boolean | null // parity vs legacy deterministic assessment
  card: CommissionerHealthCard // { title, subtitle, detail, score, tier, flags }
}
```
When `LIVE=false` (Stage 0): `decisionOsShadow` is set only for scope-filtered leagues.
When `LIVE=true` (Stage 1): `decisionOsShadow` is set unconditionally for ALL `source=database`
snapshots via `Promise.all`. Snapshots with `source=dashboard-fallback` are skipped (no DB-backed
world to resolve — documented behavior, not a gap).

**Rollback method:** Set `DECISION_OS_COMMISSIONER_HEALTH_LIVE=false` in Vercel. Takes effect on
next request; no deploy required.

**Telemetry required:**
- `decision.issued` events with `decision_type=commissioner.league.health`
- `decision.shadow_parity` events with `parity_passed/parity_failed`
- Zero `shadow_error` events

**Expected soak period:** 7 days minimum from first production activation.

**Failure behavior:** Each snapshot's shadow call is independently wrapped in try/catch.
A failure on one snapshot does not affect any other snapshot or the Commissioner Hub response.
The legacy `healthScore`, `overallStatus`, `actions` fields are always present.

**Production monitoring checklist:**
- [ ] `decisionOsShadow.card` non-null in at least one league response per commissioner load
- [ ] `decisionOsShadow.parityPassed = true` in telemetry
- [ ] Legacy `healthScore` and `overallStatus` unchanged across 100 sampled requests
- [ ] No increase in Commissioner Hub p99 latency above pre-Stage-1 baseline
- [ ] Zero `shadow_error` events in first 24 hours

---

### Slice 2 — Trade (`DECISION_OS_TRADE_LIVE`)

**What it adds to the response:**
```ts
// Trade proposal creation POST /api/redraft/trade-proposals
decisionOs: {
  decisionId: string             // stable ID for telemetry
  card: TradeCard                // { title, subtitle, detail, grade, fairnessScore, legal, proposalId }
  completeness: number           // 0–100; how complete the trade evaluation data was
  uncertaintySources: string[]   // which data sources were null/degraded
}
```
`decisionOs` is absent when no `TradeValueSnapshot` exists (the snapshot is a prerequisite for
meaningful trade evaluation — gated by `if (!snapshotRow) skip` before the LIVE path).

Legacy response fields (`proposal`, `valueSnapshot`) are always present.

**Rollback method:** Set `DECISION_OS_TRADE_LIVE=false`. No deploy.

**Telemetry required:**
- `decision.issued` with `decision_type=manager.trade.evaluate`
- `decision.shadow_parity` with `parity_passed=true`
- `adp_resolved > 0` in parity telemetry (indicates ADP cache is warm — affects card quality)
- `canonical_shadow_ran` in the canonical E.4 shadow attempt (confirmation canonical path is active)

**Expected soak period:** 7 days from first activation. ADP cache should be warm before
activating (verify `AdpDataRecord` rows newer than 7 days in production).

**Failure behavior:** The LIVE block is wrapped in try/catch. A Decision OS failure returns
the trade proposal normally — `proposal` and `valueSnapshot` always present. `decisionOs` is
absent on failure (the spread omits it when null). The trade creation itself is unaffected.

**Production monitoring checklist:**
- [ ] `decisionOs.card` present in trade proposal creation responses (when snapshot exists)
- [ ] `decisionOs.completeness > 0` (confirms ADP/projection data is flowing)
- [ ] `proposal.id`, `proposal.status`, `valueSnapshot` unchanged across 50 sampled trades
- [ ] No increase in trade proposal creation latency above baseline
- [ ] Zero `shadow_error` events in first 24 hours
- [ ] `uncertaintySources` array is reasonable (not all sources reporting null)

---

### Slice 3 — Waiver (`DECISION_OS_WAIVER_LIVE`)

**What it adds to the response:**
```ts
// Waiver AI engine POST /api/waiver-ai/engine
decisionOs: {
  decisionId: string   // stable ID for telemetry
  card: WaiverCard     // { title, subtitle, detail, confidence, legal, topClaim }
  confidence: number   // 0–100; reflects data completeness + top claim composite score
  legal: boolean       // false if top claim is blocked by a rule verdict
}
```
`decisionOs` is absent when no `leagueId` is provided in the request body.

Legacy response fields (`success`, `analysis`, `tokenSpend`) are always present.

**Rollback method:** Set `DECISION_OS_WAIVER_LIVE=false`. No deploy.

**Telemetry required:**
- `decision.issued` with `decision_type=manager.waiver.claim`
- `decision.shadow_parity` with `parity_passed=true` and `wrap_fidelity=true`
- `legal=true/false` distribution in issued decisions

**Expected soak period:** 7 days from first activation.

**Failure behavior:** LIVE block wrapped in try/catch. Failure leaves `analysis` and `tokenSpend`
unchanged — the waiver AI result is always returned. `decisionOs` absent on failure.
Token refund logic is unaffected (it gates on the outer try/catch, not the Decision OS block).

**Production monitoring checklist:**
- [ ] `decisionOs.card` present in waiver engine responses (when leagueId provided)
- [ ] `decisionOs.confidence` is in `[0, 100]`
- [ ] `analysis.deterministic.suggestions` unchanged across 50 sampled waiver requests
- [ ] `tokenSpend` field unchanged
- [ ] No increase in waiver AI p99 latency above baseline
- [ ] Zero `shadow_error` events in first 24 hours

---

### Slice 4 — Lineup (`DECISION_OS_LINEUP_LIVE`)

**What it adds to the response:**
```ts
// Today lineup-actions GET /api/today/lineup-actions
decisionOs: {
  decisionId: string        // stable ID for telemetry
  card: LineupTodayCard     // { title, why, cta, confidenceLabel, severity, count, actions, empty }
  confidence: number        // 0–100; from the decision object
  leagueId: string          // which league the card is for (first in summary, maxLeagues: 1)
}
```
`decisionOs` is absent when the user has no leagues in the summary or when the shadow runner
fails to resolve inputs for the first league.

Both `redraft_native` (AF native leagues) and `canonical_world` (imported Sleeper leagues) paths
are supported transparently via `runLineupShadowForSummary`. The `source` tag is provenance-only
and does not alter the decision.

Legacy response fields (`withChimmy`, `intelligence`) are always present.

**Rollback method:** Set `DECISION_OS_LINEUP_LIVE=false`. No deploy.

**Telemetry required:**
- `decision.issued` with `decision_type=manager.lineup.set`
- `decision.shadow_parity` with `parity_passed=true`
- `source=redraft_native` or `source=canonical_world` in shadow parity event (confirms both paths active)
- `decision.validator_parity` events (canonical vs primary validator — healthy when `validator_parity_shared_agreement=true`)

**Expected soak period:** 7 days from first activation. Highest-traffic slice — monitor latency
carefully in the first hour.

**Failure behavior:** LIVE block wrapped in try/catch. Failure leaves the Today response unchanged
(`withChimmy`, `intelligence` always present). The lineup card UI renders correctly when `decisionOs`
is null. The `computeLineupActionsForUser` and `attachChimmyAdviceToLineupSummary` calls are
upstream of the Decision OS block and unaffected.

**Production monitoring checklist:**
- [ ] `decisionOs.card` present in today lineup responses (when user has leagues)
- [ ] `decisionOs.leagueId` matches a real league from the user's summary
- [ ] `decision.shadow_parity` events show `source=redraft_native` for native users
- [ ] `decision.shadow_parity` events show `source=canonical_world` for imported-league users
- [ ] Today page p99 latency unchanged (maxLeagues=1 bounds overhead)
- [ ] Zero `shadow_error` events in first 24 hours
- [ ] Legacy lineup actions (`withChimmy.leagues`) unchanged across 100 sampled requests

---

## Recommended Activation Order

Activate slices in this sequence, completing the 7-day soak on each before activating the next:

### 1. Commissioner (first, lowest risk)

**Why first:**
- F2.8 League Intelligence is fully sourced from existing DB tables — no cron cache dependency
- `decisionOsShadow` already existed in the response shape at Stage 0 (the field isn't new to the type)
- Commissioner Hub is the lowest-traffic surface
- Assessment is read-only — no mutation risk
- Shadow has been 0 diffs on every conformance run

**Activation:** Set `DECISION_OS_COMMISSIONER_HEALTH_LIVE=true` in Vercel → Deploy
(env var change, no code deploy needed).

**Gate to next slice:** 7-day soak with `parity_failed=0` AND `decisionOsShadow.card` non-null
confirmed in production responses.

---

### 2. Trade (second, after ADP cache confirmed warm)

**Why second:**
- Lower frequency than Waiver and Lineup (only fires on proposal creation, not every page load)
- ADP enrichment quality directly visible in `decisionOs.completeness`; high completeness confirms
  enrichment pipeline is healthy before enabling Waiver (same cron dependency)
- Canonical shadow E.4 also validates the canonical TradeWorld path in production

**Pre-activation gate:**
- Confirm `AdpDataRecord` rows exist in production with `updatedAt` within last 7 days
- Confirm `FantasyProjection` has current-week rows in production
- Both are readable from Vercel logs / production DB health checks

**Activation:** Set `DECISION_OS_TRADE_LIVE=true`.

**Gate to next slice:** 7-day soak, `completeness > 40` on average (confirms ADP is flowing).

---

### 3. Waiver (third, after Trade soak confirms enrichment pipeline)

**Why third:**
- Same ADP/projection cron dependency as Trade; Trade soak already validates the pipeline
- Token-gated feature (higher-sensitivity — failures must be 0 before enabling)
- `decisionOs.confidence` and `decisionOs.legal` are the two most decision-relevant outputs;
  a 7-day Trade soak gives confidence these are stable before exposing them in Waiver

**Activation:** Set `DECISION_OS_WAIVER_LIVE=true`.

**Gate to next slice:** 7-day soak, `confidence` in `[0, 100]`, `legal` field present in all responses.

---

### 4. Lineup (last, highest traffic)

**Why last:**
- Highest-traffic route (fires on every Today page load) — smallest blast radius by activating last
- `maxLeagues: 1` cap means only one league per user gets a card; observe latency before increasing
- `canonical_world` bridge path must be confirmed active in production before Stage 2 can be
  considered for imported-league users

**Activation:** Set `DECISION_OS_LINEUP_LIVE=true`.

**Observation window:** Monitor p99 latency for 2 hours post-activation before declaring stable.

---

## Production Activation Checklist

### Pre-activation (all slices, one-time)

- [ ] Confirm `[decision-os]` JSON logs are ingested in observability (Vercel log drain / Datadog)
- [ ] Create parity query: `count(parity_passed=true) + count(parity_failed=true)` per `decision_type`
- [ ] Create `parity_failed` alert — fires on ANY `parity_failed=true` event (immediate Slack/PD)
- [ ] Create `shadow_error` rate alert — fires if rate exceeds 1% in a rolling 1-hour window
- [ ] Verify prod ADP cron is GREEN: `AdpDataRecord` rows with `updatedAt` within 7 days exist
- [ ] Verify prod projection cron is GREEN: `FantasyProjection` current-week rows exist

### Per-slice activation (repeat for each slice in order)

- [ ] Confirm parity gate met in production shadow telemetry (see thresholds in Phase 4.0 ADR)
- [ ] Re-run conformance script on staging immediately before activation:
  - Commissioner: `node --require scripts/_audit-preload.cjs --import tsx scripts/decision-os-commissioner-conformance.ts`
  - Trade: `npx tsx scripts/decision-os-trade-conformance.ts`
  - Waiver: `npx tsx scripts/decision-os-waiver-conformance.ts`
  - Lineup: `node --require scripts/_audit-preload.cjs --import tsx scripts/decision-os-lineup-conformance.ts`
- [ ] Set `DECISION_OS_{SLICE}_LIVE=true` in Vercel (preview environment first, 30-min soak, then production)
- [ ] Confirm `decisionOs` field present in one sampled production response within 5 minutes
- [ ] Confirm legacy fields unchanged in the same sampled response
- [ ] Monitor `parity_failed` alert for 24 hours post-activation

---

## Telemetry Dashboard Requirements

Two dashboards required (can be Vercel log queries or Datadog):

### Dashboard 1 — Parity Health (per slice)

| Panel | Query | Alert threshold |
|-------|-------|-----------------|
| Parity passed | `count(event=decision.shadow_parity AND parity_passed=true)` per `decision_type` | — |
| Parity failed | `count(event=decision.shadow_parity AND parity_failed=true)` per `decision_type` | Any > 0 → alert |
| Shadow error rate | `count(ran=false AND reason=shadow_error) / count(event=decision.shadow_parity)` | > 1% → alert |
| Decision issued | `count(event=decision.issued)` per `decision_type` | — |

### Dashboard 2 — Stage 1 Enrichment Quality (post-activation)

| Panel | Query | Notes |
|-------|-------|-------|
| Commissioner `decisionOsShadow` populated rate | count responses with `decisionOsShadow != null` / total commissioner hub loads | Target 100% for `source=database` |
| Trade `decisionOs.completeness` distribution | histogram of `completeness` in issued trade decisions | Target p50 > 40 when ADP warm |
| Waiver `decisionOs.confidence` distribution | histogram of `confidence` | Target p50 > 50 |
| Lineup `decisionOs` present rate | count responses with `decisionOs` present / total today loads | Reflects `source != unavailable` rate |
| Lineup source distribution | count `source=redraft_native` vs `source=canonical_world` | Confirms both paths active |

---

## 7-Day Soak Criteria

A slice passes the 7-day soak when ALL of the following hold over the full 7-day window:

| Criterion | Threshold | Measured how |
|-----------|-----------|--------------|
| `parity_failed` events | **0** | Dashboard 1 / Vercel log query |
| `shadow_error` rate | **≤ 1%** of shadow runs | Dashboard 1 |
| `decisionOs` present rate | **≥ 95%** of eligible requests | Dashboard 2 (eligible = requests where the Decision OS would run) |
| Route p99 latency | **≤ pre-Stage-1 baseline** (per Vercel analytics) | Vercel analytics / Datadog APM |
| Legacy fields | **100% unchanged** in sampled spot checks (10 per day) | Manual or automated response diff |

A single `parity_failed=true` event restarts the 7-day clock. A parity failure also triggers
mandatory investigation before the clock restarts: identify the root cause, confirm it is fixed,
re-run the conformance script on staging.

---

## Failure Behavior Reference

All four slices share the same failure contract:

```
LIVE path failure → try/catch swallows the error → decisionOs absent from response
Legacy path → completely unaffected (runs before the Decision OS block)
Shadow telemetry → emits shadow_error event (not parity_failed — these are distinct)
User impact → zero (decisionOs is an optional enrichment field)
```

The Decision OS NEVER:
- Mutates the legacy response fields
- Throws an uncaught error to the route handler
- Writes to any database table
- Executes any real action (no lineup set, no waiver claim, no trade execution)

---

## Architecture Freeze Compliance

This document is additive (documentation + checkpoint only):
- No frozen-invariant redesign
- No Canonical World writes
- No provider branches introduced
- No DCO contract changes
- No Stage 2 advancement (Stage 2 requires its own ADR + parity gate + UI dependency audit)
- Kill switches are the defined rollback mechanism — no schema, no migration, no deploy

---

## Success Criteria

**Phase 4.5 complete when:**
- [x] This ADR written and committed
- [x] All four Stage 1 kill switches implemented and tested (650/650 tests GREEN)
- [x] All five conformance scripts GREEN on ep-winter-salad after each phase
- [ ] Parity dashboards created in production observability
- [ ] `parity_failed` alert live
- [ ] Pre-activation checklist items completed (log ingestion, ADP/projection cron health)

**Ready to activate Commissioner when:**
- [ ] Parity gate met (≥ 100 `parity_passed` events, 0 `parity_failed` in prod)
- [ ] Observability pipeline confirmed

**Ready to activate Trade when:**
- [ ] Commissioner 7-day soak passed
- [ ] `AdpDataRecord` rows < 7 days old in production confirmed
- [ ] Parity gate met (≥ 500 events)

**Ready to activate Waiver when:**
- [ ] Trade 7-day soak passed
- [ ] Parity gate met (≥ 500 events)

**Ready to activate Lineup when:**
- [ ] Waiver 7-day soak passed
- [ ] `canonical_world` path confirmed in prod telemetry
- [ ] Parity gate met (≥ 500 events)
