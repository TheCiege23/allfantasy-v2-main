# Phase 6.1 — Behavioral Patterns ADR

**Status:** DONE  
**Date:** 2026-06-30  
**Version:** 6.1.0

---

## 1. Purpose

Detect time-series manager and league behavior patterns from the Phase 5.1 `BehavioralEvent[]` stream.
This is **sequence detection**, not aggregate scoring. Phase 6.3 owns aggregate signal scoring; Phase 6.5
owns platform-wide percentiles. Phase 6.1 owns "what is this specific entity doing over time?"

---

## 2. Inputs

Raw `BehavioralEvent[]` (the canonical discriminated union from `behavioral/events/types.ts`).
Phase 6.1 imports event types directly from the Phase 5.0 event layer — NOT from Phase 5.1 or 5.3
internal types. This keeps 6.1 independently testable.

---

## 3. Pattern Taxonomy

### Manager-level patterns (attributed to a specific `managerId`)

| Pattern | Trigger |
|---|---|
| `repeated_lineup_indecision` | 3+ `lineup_saved` for same week by same manager |
| `waiver_aggression_streak` | 5+ `waiver_claim_created` in a 21-day window |
| `trade_proposal_spike` | 4+ `trade_created` in a 14-day window |
| `manager_inactivity_window` | 30+ days with no events while league is active |
| `bench_regret_repetition` | Same player flip-flopped bench↔starter across 3+ week-pairs |
| `injury_response_delay` | Player benched, no waiver claim for 7+ days, player stays benched next week |
| `matchup_overreaction` | `slotChanges >= 4` for 3+ consecutive lineup-saved weeks |
| `conservative_roster_pattern` | `slotChanges = 0` for 4+ consecutive lineup-saved weeks |
| `trade_rejection_pattern` | Manager's proposals rejected 3+ times in a 30-day window |

### League-level patterns (attributed to the league as a whole)

| Pattern | Trigger |
|---|---|
| `league_activity_surge` | Event count in 7-day window exceeds 2× prior 28-day rate |
| `league_activity_dropoff` | Event count in 14-day window falls below 40% of prior 28-day rate |
| `commissioner_rules_churn` | 3+ `rules_changed` events in a 21-day window |

---

## 4. Confidence Tiers

`'high' | 'medium' | 'low'` — per-pattern thresholds documented inline in `patterns.ts`.
Never fabricate. If below minimum threshold, pattern is not emitted (not degraded to unknown).

---

## 5. Evidence Windows

Every `DetectedPattern` carries `evidenceWindows[]` — the specific events that constitute proof.
- `eventIds`: array of `eventId` strings (empty for absence-based patterns like inactivity)
- `startedAt / endedAt`: ISO timestamps bounding the detection window
- `summary`: one-line human-readable description

---

## 6. Deterministic-Only Rule

Phase 6.1:
- Pure function: no DB, no IO, no AI, no side effects
- Does NOT mutate input `events[]` array
- Sorts a defensive copy before processing
- Same inputs → same output, always

---

## 7. Relationship to Phase 6.3 / 6.5

Phase 6.1 does NOT duplicate:
- Phase 6.3 engagement tier, retention risk, or activity tier aggregation
- Phase 6.5 percentile ranks or cohort statistics

Phase 6.1 ADDS:
- Temporal sequences within a single league's event stream
- Per-manager attribution of behavior patterns
- Evidence-window proof for each detection

---

## 8. Non-Goals

- No natural-language generation
- No frontend output
- No live API calls
- No new database tables
- No modification to Stage 1 soak slices
