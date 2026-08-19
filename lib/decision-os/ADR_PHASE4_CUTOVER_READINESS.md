# ADR Phase 4.0 — Decision OS Cutover Readiness Plan

**Date:** 2026-06-30  
**Branch:** `g15-event-foundation`  
**Status:** APPROVED — plan only; no production code changed  
**Prerequisite:** Phase 3 validation (commit `7da0c7c8c`) — all 5 conformance scripts GREEN  

---

## Purpose

This document is the governed cutover plan for the Decision OS. It defines the architecture
of each cutover stage, the per-slice readiness matrix, kill switches, telemetry gates, required
fixes, and the recommended Phase 4.1 first implementation ticket.

**No production code is cut over by this ADR.** The architecture is described here and executed
in subsequent Phase 4.x tickets, each of which must reference this document and confirm all
prerequisites are met before touching any route.

---

## Background

All four Decision OS slices are shadow-mounted and proven conformant:

| Slice | Route | Shadow Flag | Phase 3 Proof |
|-------|-------|-------------|---------------|
| Lineup | `app/api/today/lineup-actions/route.ts` | `DECISION_OS_LINEUP_SHADOW` | `LINEUP_CONFORMANCE_OK` |
| Waiver | `app/api/waiver-ai/engine/route.ts` | `DECISION_OS_WAIVER_SHADOW` | `WAIVER_CONFORMANCE_OK` |
| Trade | `app/api/redraft/trade-proposals/route.ts` | `DECISION_OS_TRADE_SHADOW` | `TRADE_CONFORMANCE_OK` |
| Commissioner | `lib/commissioner-hub/commissionerHubHealth.ts` | `DECISION_OS_COMMISSIONER_HEALTH_SHADOW` | `COMMISSIONER_CONFORMANCE_OK` |

In shadow mode the Decision OS path runs BESIDE the legacy path, compares parity (wrap-fidelity:
0 diffs), emits telemetry, and NEVER alters the response. The shadow is never skipped on errors —
it is isolated in try/catch and failures are swallowed, not propagated.

---

## Cutover Stage Model

Each slice advances through four stages independently. Stages are separated by explicit parity
gates — quantitative pass criteria measured in production telemetry before any stage advance.

```
Stage 0: Shadow        — Decision OS runs beside legacy; result logged only        ← CURRENT
Stage 1: Enriched      — Decision OS result included in response as optional field
Stage 2: Live Primary  — UI reads Decision OS first; legacy is the fallback
Stage 3: Retirement    — Legacy path removed (requires full coverage + 30-day soak)
```

Stage 0 → 1: **ADR + parity gate only** (additive response field, no UI dependency)  
Stage 1 → 2: **ADR + parity gate + UI dependency + feature flag** (user-visible change)  
Stage 2 → 3: **ADR + 30-day soak + coverage audit** (destructive, requires dedicated ticket)  

This document governs Stage 0 → Stage 1 for each slice. Stage 2+ will require separate ADRs.

---

## Kill Switch Design

Every slice has exactly two env vars:

| Env Var | Effect |
|---------|--------|
| `DECISION_OS_{SLICE}_SHADOW=true` | Enables shadow (run beside, log only) |
| `DECISION_OS_{SLICE}_LIVE=true` | (Stage 1+) Includes Decision OS output in response |

**Kill switch:** set `DECISION_OS_{SLICE}_LIVE=false` (or unset it). Takes effect on next request
with no deploy required (Vercel env var — propagates within seconds).

**Both flags together:** `SHADOW=true` + `LIVE=true` → Decision OS runs AND its output is in the
response. `SHADOW=true` + `LIVE=false` → Decision OS runs, result logged only (current behavior).
`SHADOW=false` + `LIVE=true` → Decision OS runs live only, no shadow logging (not recommended for
initial rollout; use both flags together during Stage 1).

**Scope filters** (already implemented, unchanged):
- `DECISION_OS_TEST_USERNAMES` — comma-separated Sleeper usernames to scope the shadow/live to
- `DECISION_OS_TEST_LEAGUE_IDS` — comma-separated league IDs to scope the shadow/live to

Scope filters apply to BOTH shadow and live flags. Use them for progressive rollout (10% of users
= add their usernames; 100% = remove the filter).

---

## Parity Gate

Before advancing any slice to Stage 1, the following production telemetry gate must pass:

| Metric | Threshold |
|--------|-----------|
| `decision.shadow_parity` events with `parity_passed=true` | ≥ 500 for Lineup/Waiver/Trade |
| `decision.shadow_parity` events with `parity_passed=true` | ≥ 100 for Commissioner |
| `parity_failed=true` events in last 7 days | 0 |
| `shadow_error` events in last 7 days | ≤ 1% of total shadow runs |

These thresholds are measured from the `[decision-os]` JSON log stream (Vercel logs / Datadog).
The parity event shape is: `{"event":"decision.shadow_parity","decision_type":"...","flags":{"parity_passed":...}}`.

Commissioner threshold is lower (100) because the Commissioner Hub is lower-traffic. The gate
applies per slice independently.

---

## Telemetry Requirements

Current telemetry is emitted via `emitShadowParity` / `emitDecisionTelemetry` to `console.debug`
with the prefix `[decision-os]`. The Phase 4.1 implementation ticket must:

1. Confirm `[decision-os]` logs are ingested into the observability pipeline (Vercel log drain / Datadog)
2. Create a dashboard or query that counts `parity_passed=true` vs `parity_failed=true` per slice
3. Create an alert for `parity_failed=true` events (immediate Slack/PagerDuty on first failure)
4. Confirm `shadow_error` rate is tracked per slice

No new telemetry schema changes are required — the existing events are sufficient. The gate is
purely a counting exercise.

---

## Slice-by-Slice Cutover Matrix

---

### Slice 4 — Commissioner (`commissioner.league.health`)

**Recommended first — Stage 0 → 1 in Phase 4.1**

**Legacy path:**  
`monitorLeagueHealth(leagueId, rosters)` in `commissionerHubHealth.ts` (line ~800). Builds
`CommissionerLeagueHealthSnapshot` with `healthScore`, `engagementScore`, `overallStatus`,
`alerts`, `recommendations`, `actions`, etc.

**Decision OS shadow path:**  
`runCommissionerHealthShadow({ userId, snapshot })` — fed the SAME deterministic snapshot the
legacy path already built. Returns `{ ran, result: { decision, parity } }`.

**Current response shape (Stage 0):**  
```ts
CommissionerLeagueHealthSnapshot & {
  decisionOsShadow?: {
    decisionId: string
    parityPassed: boolean | null
    card: CommissionerHealthCard
  }
}
```
`decisionOsShadow` is already attached to the snapshot in production when the shadow flag is set.
**The Stage 1 `DECISION_OS_COMMISSIONER_HEALTH_LIVE` env var simply promotes this optional field
to always-populated** — no new response field or shape change. The UI already has the field
available; Stage 2 will make the UI read from it.

**Stage 1 response change:**  
When `DECISION_OS_COMMISSIONER_HEALTH_LIVE=true`: populate `decisionOsShadow` unconditionally
(regardless of scope filters), using the same `runCommissionerHealthShadow` call path. The legacy
`healthScore` / `overallStatus` / etc. fields remain unchanged.

**Data prerequisites:**  
- F2.8 League Intelligence enrichment already fully sourced from existing DB data (WaiverClaim /
  AfLeagueTrade / AfRosterMoveHistory counts) — no cron dependency
- `CommissionerLeagueHealthSnapshot` must have `source === 'database'` (not `dashboard-fallback`)
- No ADP/projection cache dependency

**Test gaps:**  
None blocking. All commissioner tests (63 unit tests) are GREEN.

**Known test to fix before Stage 2 (NOT blocking Stage 1):**  
None.

**Rollback:** Set `DECISION_OS_COMMISSIONER_HEALTH_LIVE=false` → `decisionOsShadow` reverts to
shadow-only (optional, scope-gated). No deploy.

**Risk level:** LOW  
The response field already exists in the snapshot shape (`decisionOsShadow?`). Stage 1 only makes
it always-populated. The legacy assessment fields are unchanged. No UI code path changes. The
commissioner hub can still render correctly from legacy fields if the card is ignored.

**Staging proof required before Stage 1:**  
- Parity gate (see above, ≥ 100 production parity_passed events, 0 failures)
- Re-run `scripts/decision-os-commissioner-conformance.ts` on staging — confirm COMMISSIONER_CONFORMANCE_OK

**Production proof required after Stage 1:**  
- Confirm `decisionOsShadow.card` is present and populated in commissioner hub responses
- Confirm legacy `healthScore` / `overallStatus` are unchanged
- Monitor `parity_passed` rate for 7 days

---

### Slice 2 — Waiver (`manager.waiver.claim`)

**Recommended second — after prod ADP+projection caches confirmed GREEN**

**Legacy path:**  
`runWaiverAIService(input)` in `app/api/waiver-ai/engine/route.ts`. Returns `WaiverAIServiceOutput`
with `deterministic.suggestions`, `explanation`, etc.

**Decision OS shadow path:**  
`runWaiverShadowForEngine({ userId, leagueId, engineInput, legacyAnalysis })` — fed the legacy
engine's suggestions as the wrap-fidelity memo. Returns `{ ran, result }`.

**Stage 1 response change:**  
When `DECISION_OS_WAIVER_SHADOW=true` AND `DECISION_OS_WAIVER_LIVE=true`: add a `decisionOs` field
to the existing response:

```ts
{
  success: true,
  analysis: WaiverAIServiceOutput,     // UNCHANGED
  tokenSpend: ...,                     // UNCHANGED
  decisionOs?: {                       // NEW in Stage 1
    decisionId: string
    card: WaiverCard
    confidence: number
    legal: boolean
  }
}
```

The waiver AI response shape gets `decisionOs` appended. Client-side code can read it
opportunistically; existing clients that don't know about `decisionOs` are unaffected.

**Data prerequisites:**  
- `DECISION_OS_WAIVER_SHADOW=true` must already be running in production for the parity gate
- ADP + projection caches should be warm for higher-confidence waiver recommendations (not
  required for correctness — waiver parity doesn't depend on enrichment quality; it proves the
  wrapper is faithful)
- `leagueId` must be provided in the waiver request (not all callers send it)

**Test gaps:**  
None blocking. Waiver tests are GREEN.

**Rollback:** Set `DECISION_OS_WAIVER_LIVE=false` → `decisionOs` field absent from response.
No deploy required.

**Risk level:** LOW-MEDIUM  
Adding a new optional response field is safe. The waiver AI is a paid/token-gated feature;
the Decision OS does NOT replace the AI analysis (it wraps the deterministic layer). The `analysis`
field is unchanged.

**Staging proof required before Stage 1:**  
- Parity gate (≥ 500 production parity_passed events, 0 failures in 7 days)
- Re-run `scripts/decision-os-waiver-conformance.ts` — confirm WAIVER_CONFORMANCE_OK

**Production proof required after Stage 1:**  
- Confirm `decisionOs.card` present in responses when both flags set
- Confirm `analysis` unchanged
- Monitor parity rate

---

### Slice 3 — Trade (`manager.trade.evaluate`)

**Recommended third — same timing as Waiver, after prod ADP+projection GREEN**

**Legacy path:**  
`captureRedraftTradeValueSnapshot(...)` persists a `TradeValueSnapshot`. The proposal creation
response includes the `snapshotRow` payload. The trade analysis UI reads from the snapshot.

**Decision OS shadow path:**  
`runTradeShadowForProposal({ ... })` in `app/api/redraft/trade-proposals/route.ts`. Runs beside
proposal creation; canonical `TradeWorld` shadow also runs (E.4). Parity: 0 diffs on wrap-fidelity.

**Stage 1 response change:**  
When `DECISION_OS_TRADE_SHADOW=true` AND `DECISION_OS_TRADE_LIVE=true`: add `decisionOs` to the
trade proposal response:

```ts
{
  // existing proposal creation response fields — UNCHANGED
  id: string
  status: string
  // ... all existing fields ...
  decisionOs?: {                       // NEW in Stage 1
    decisionId: string
    card: TradeCard
    completeness: number
    uncertaintySources: string[]
  }
}
```

**Data prerequisites:**  
- ADP and projection caches warm in production — trade evaluation quality degrades significantly
  without them (0 ADP matches on staging; prod crons should produce populated caches)
- Confirm `adp_resolved > 0` in production `decision.shadow_parity` telemetry before advancing
- `TradeValueSnapshot` must exist (the shadow already guards this: `if (!snapshotRow) skip`)

**Test gaps:**  
None blocking. Trade tests are GREEN (32 tests including canonical shadow E.4).

**Enrichment-gated note:**  
Trade parity at Stage 0 is already 0 diffs (wrap-fidelity). Stage 1 quality improves when ADP
and projections are populated. The parity gate should NOT be advanced until `adp_resolved > 0`
appears in production telemetry — not because parity would fail, but because the Decision OS
trade card would be low-information without ADP data.

**Rollback:** Set `DECISION_OS_TRADE_LIVE=false` → `decisionOs` absent from response. No deploy.

**Risk level:** LOW-MEDIUM  
Trade proposal creation is a write operation. The Decision OS path is read-only (evaluate only —
it never creates, accepts, rejects, or counters). The proposal creation itself is unaffected.
The `decisionOs` field is additive to the response.

**Staging proof required before Stage 1:**  
- Parity gate (≥ 500 production parity_passed events, 0 failures)
- `adp_resolved > 0` observed in prod telemetry
- Re-run `scripts/decision-os-trade-conformance.ts` — confirm TRADE_CONFORMANCE_OK

**Production proof required after Stage 1:**  
- Confirm `decisionOs.card` present in proposal creation responses
- Confirm proposal creation behavior unchanged (id, status, snapshot unchanged)
- Monitor canonical shadow `completeness` improvement as ADP/projections populate

---

### Slice 1 — Lineup (`manager.lineup.set`)

**Recommended last — after fixing the route test and confirming canonical_world path in prod**

**Legacy path:**  
`computeLineupActionsForUser(userId)` + `attachChimmyAdviceToLineupSummary` in
`app/api/today/lineup-actions/route.ts`. Returns `LineupActionSummaryPayload` with per-league
lineup actions.

**Decision OS shadow path:**  
`runLineupShadowForSummary(userId, summary, { maxLeagues: 1 })` — runs one league per request
(cost-bounded). Uses `redraft_native` loader first, `canonical_world` bridge as fallback.

**Stage 1 response change:**  
When `DECISION_OS_LINEUP_SHADOW=true` AND `DECISION_OS_LINEUP_LIVE=true`: add `decisionOs` to the
per-league response or the top-level payload:

```ts
{
  // existing lineup-actions response — UNCHANGED
  leagues: LineupActionSummaryPayload['leagues'],
  intelligence: { ... },
  // ...
  decisionOs?: {                       // NEW in Stage 1
    leagueId: string
    decisionId: string
    card: LineupTodayCard
    source: LineupInputSource         // 'redraft_native' | 'canonical_world' | ...
  }
}
```

Note: only one league is shadowed per request (`maxLeagues: 1`). Stage 1 will carry the Decision
OS result for that one league. To scale, `maxLeagues` should be increased gradually.

**Data prerequisites:**  
- `DECISION_OS_LINEUP_SHADOW=true` in production, parity gate met
- Projection enrichment (F2.5) warm in production for lineup confidence scoring
- `canonical_world` path exercised in prod telemetry (imported league users) — not required for
  native redraft users but needed before Stage 2 applies to imported leagues

**Test gaps (must fix before Stage 1):**  
- ~~`lineup-shadow-route.test.ts` — 2 pre-existing failures~~ **FIXED in this commit** (GAP-P3-4)

**Known architecture gap:**  
`maxLeagues: 1` means only one league per user per request gets a Decision OS card. Stage 2 must
increase this. The cap exists to bound DB query overhead during shadow validation; it can be
lifted when the shadow has proven stable.

**Rollback:** Set `DECISION_OS_LINEUP_LIVE=false`. No deploy.

**Risk level:** MEDIUM  
The lineup route is the highest-traffic of the four (called on every Today page load). The shadow
cap (`maxLeagues: 1`) bounds the overhead. Stage 1 adds a non-critical optional field; the Today
card UI renders correctly if `decisionOs` is absent or null.

**Staging proof required before Stage 1:**  
- All 5 lineup-shadow-route.test.ts tests GREEN (done in this commit)
- Parity gate (≥ 500 production parity_passed events, 0 failures)
- `source=canonical_world` path confirmed in prod telemetry for at least one imported league user
- Re-run `scripts/decision-os-lineup-conformance.ts` — confirm LINEUP_CONFORMANCE_OK

**Production proof required after Stage 1:**  
- Confirm `decisionOs.card` present in responses for scoped users
- Confirm legacy lineup actions unchanged
- Today card UI renders without errors when `decisionOs` is null

---

## Required Fixes Before First Cutover (Phase 4.1)

| Fix | Slice | Status | Notes |
|-----|-------|--------|-------|
| Fix `lineup-shadow-route.test.ts` assertions | Lineup | **DONE** (this commit) | 2 tests now match actual route signature |
| Confirm `[decision-os]` logs ingested in prod | All | TODO — Phase 4.1 prerequisite | Needed for parity gate |
| Create parity dashboard/query | All | TODO — Phase 4.1 prerequisite | Count events per slice |
| Create `parity_failed` alert | All | TODO — Phase 4.1 prerequisite | Slack/PagerDuty |
| Verify prod ADP cron GREEN | Trade/Waiver | TODO — operational check | `AdpDataRecord` must have rows newer than 7 days |
| Verify prod projection cron GREEN | Trade/Lineup | TODO — operational check | `FantasyProjection` must have current-week rows |

---

## Recommended Phase 4.1 First Implementation Ticket

**Target:** Commissioner Slice — Stage 0 → Stage 1

**What it changes:**
1. Add `DECISION_OS_COMMISSIONER_HEALTH_LIVE` env var support to `commissionerHubHealth.ts`
2. When `LIVE=true`: populate `decisionOsShadow` unconditionally (regardless of scope filters)
3. Add a source-contract test asserting the `LIVE` flag behavior
4. Run commissioner conformance on staging: confirm COMMISSIONER_CONFORMANCE_OK
5. Set `DECISION_OS_COMMISSIONER_HEALTH_LIVE=true` in Vercel preview environment first, then production

**Why Commissioner first:**
- F2.8 League Intelligence is fully sourced from existing activity tables — no cron cache dependency
- `decisionOsShadow` already exists in the response shape (zero UI change needed for Stage 1)
- Commissioner Hub is lower traffic than Today/Waiver/Trade — fewer users affected during rollout
- Commissioner health is read-only display — no mutation risk
- Shadow parity has been 0 diffs across all staging conformance runs

**What it does NOT do:**
- Does not change the legacy `healthScore`, `overallStatus`, `actions` fields
- Does not change the Commissioner Hub UI (Stage 2)
- Does not retire `monitorLeagueHealth` (Stage 3)
- Does not touch any other slice

---

## Rollback Plan

All rollbacks are env var changes — no redeploy required.

| Action | Time to effect | Notes |
|--------|----------------|-------|
| Set `DECISION_OS_{SLICE}_LIVE=false` | < 30s (Vercel env propagation) | Removes `decisionOs` field from response |
| Set `DECISION_OS_{SLICE}_SHADOW=false` | < 30s | Stops shadow from running entirely |
| Both flags off | < 30s | Route behaves identically to pre-Decision-OS state |

No database state is written by any Decision OS path. There is no rollback complexity for data.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Shadow slows route response time | Low | Medium | Shadow is fire-and-forget in try/catch; `maxLeagues: 1` on lineup; measure p99 latency after Stage 1 |
| Parity failure in production | Low | Low (shadow only) | Parity gate; `parity_failed` alert fires before Stage 2 |
| ADP/projection cache warm-up lag | Medium | Low (degrades to honest null) | Stage 1 cutover does not require enrichment; monitor `adp_resolved` telemetry |
| `canonical_world` bridge miss for imported leagues | Low | Low (honest degrade) | `source=canonical_world_unavailable` logged; lineup skips gracefully |
| Injury ID namespace gap (F2.3 API-Sports ≠ canonical IDs) | Confirmed | Low (honest null) | Documented in Phase 3 GAP-P3-3; fix is a future ticket (ID cross-reference table) |
| Commissioner `dashboard-fallback` path skipped | Confirmed | Info | Shadow skips when `source === 'dashboard-fallback'`; documented in shadow.ts |

---

## Architecture Freeze Compliance

This ADR is additive and requires NO frozen-invariant redesign:
- All changes are read-only response enrichment (adding optional `decisionOs` fields)
- No Canonical World writes
- No provider branches in fact assembly
- No DCO contract changes
- Kill switch (env var) is the defined rollback — no schema needed
- Each stage advance requires its own ADR per the ADR-first workflow

The cutover itself (promoting shadow to live) is the explicit "frozen surface" operation listed in
`ARCHITECTURE_FREEZE.md`:
> "Promoting any shadow path to a live cutover (cutover is its own governed phase)."
This ADR is that governed phase document for Stage 0 → Stage 1.

---

## Success Criteria

**Phase 4.0 complete when:**
- [x] This ADR written and committed  
- [x] `lineup-shadow-route.test.ts` 2 pre-existing failures fixed  
- [ ] `[decision-os]` log ingestion confirmed in production observability  
- [ ] Parity dashboards created (one per slice)  
- [ ] `parity_failed` alert live in prod  

**Phase 4.1 complete when:**
- [ ] Commissioner Stage 1 deployed to production  
- [ ] `decisionOsShadow` populated unconditionally for all database-source snapshots  
- [ ] 7-day prod soak with 0 `parity_failed` events  
- [ ] Phase 4.2 ticket opened for Commissioner Stage 2 (UI reads Decision OS card)
