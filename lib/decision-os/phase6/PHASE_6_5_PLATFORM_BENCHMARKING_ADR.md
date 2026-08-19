# Phase 6.5 — Platform Benchmarking Foundation

**Status:** COMPLETE  
**Date:** 2026-06-30  
**Layer:** Decision OS Phase 6 — Decision Intelligence  
**Depends on:** Phase 5.3 (LeagueBehavioralIntelligence), Phase 5.4 (PlatformBehavioralIntelligence), Phase 6.3 (LeagueArchetypeResult)

---

## 1. Purpose

Phase 6.5 answers **"how does this league compare to others like it?"**

It provides deterministic percentile ranks for each league across key behavioral dimensions,
grouped by Phase 6.3 archetype cohorts. This enables:

- Commissioner dashboards showing "your league is in the top 20% for trade activity"
- Platform operators identifying outlier leagues (top/bottom performers)
- Phase 6.4 recommendation engine using cohort baselines to calibrate suggestions

Phase 6.5 is **pure arithmetic** — no AI, no probabilistic models, no IO. Every output
is reproducible from the same inputs.

---

## 2. Layering

```
Phase 5.3 LeagueBehavioralIntelligence[]  ─┐
Phase 6.3 LeagueArchetypeResult[]         ─┤─▶  Phase 6.5 PlatformBenchmarkResult
Phase 5.4 PlatformBehavioralIntelligence  ─┘       (percentiles, cohorts, signals)
```

Phase 6.5 defines its own input interface types, structurally compatible with Phase 5 and 6.3
outputs but not importing their internal types directly (same isolation rule as Phase 6.3).

---

## 3. Inputs

| Field | Source | Required |
|---|---|---|
| `leagueSignals[]` | Phase 5.3 `LeagueBehavioralIntelligence` | yes |
| `leagueArchetypes[]` | Phase 6.3 `LeagueArchetypeResult` + leagueId tag | yes |

Phase 5.4 `PlatformBehavioralIntelligence` is NOT passed in — the benchmarker recomputes
all platform statistics directly from `leagueSignals[]` to stay self-contained and avoid
stale intermediary aggregates.

---

## 4. Benchmarked Dimensions

Five dimensions are ranked per league. Each uses a numeric proxy to enable ordinal comparison:

| Dimension | Signal | Higher = Better |
|---|---|---|
| `engagement` | `leagueEngagementScore` (0–100) | yes |
| `retentionSafety` | Risk mapped to safety score (0–3) | yes (inverted from risk) |
| `tradeActivity` | `tradeActivity.perManagerRate` | yes |
| `waiverActivity` | `waiverActivity.perManagerRate` | yes |
| `commissionerEfficiency` | Workload mapped to efficiency score (0–3) | yes (inverted from burden) |

**Risk/workload inversion mappings** (deterministic, stable across versions):
```
retentionRisk:       'low'→3, 'medium'→2, 'high'→1, 'critical'→0
commissionerWorkload: 'light'→3, 'moderate'→2, 'heavy'→1, 'critical'→0
```

---

## 5. Percentile and Rank Computation

**Rank:** `rank(v) = count(values > v) + 1` — rank 1 is the best (highest value).  
**Percentile:** `percentile(v) = round((n - rank) / (n - 1) × 100)` — 0–100.  
Ties receive the same rank and same percentile. Edge case: `n = 1` → percentile = 50.

This formula is symmetric: the highest value always gets percentile 100, the lowest always 0.
It matches the "count-below" interpretation commonly used in sports stats.

---

## 6. Cohort Benchmarking

Each league is also ranked within its **archetype cohort** (leagues sharing the same
Phase 6.3 archetype label).

- **`MIN_COHORT_SIZE = 3`**: cohort percentile/rank set to `null` when fewer than 3 leagues
  share the same archetype — not enough data to rank meaningfully.
- **`'unknown'` archetype**: leagues classified as 'unknown' have no cohort. Their archetype
  percentile fields are always `null`.
- **Cohort stats**: computed for any archetype with ≥ 1 league. Stats for cohorts of 1 or 2
  carry the `small_cohort` warning in the `ArchetypeCohortStats`.

---

## 7. Platform Statistics

Derived directly from `leagueSignals[]`:
- `avgEngagementScore` — arithmetic mean
- `medianEngagementScore` — middle element of sorted array
- `p75EngagementScore` — element at index `round(0.75 × (n-1))`
- `p25EngagementScore` — element at index `round(0.25 × (n-1))`
- `archetypeDistribution` — count per archetype label

Top/bottom league lists:
- `topLeagues` — top 3 by engagement score
- `bottomLeagues` — bottom 3 by engagement score
- `topTradeLeagues` — top 3 by trade perManagerRate
- `topWaiverLeagues` — top 3 by waiver perManagerRate
(Tied entries are ordered by leagueId for determinism.)

---

## 8. Insufficient Data Policy

| Condition | Behavior |
|---|---|
| 0 leagues | `insufficientData = true`, all stats 0/null/empty |
| 1–2 leagues | `insufficientData = true`, per-league benchmarks computed (percentile at 50), archetype percentile null |
| ≥ 3 leagues | Normal operation |
| Archetype cohort < 3 | `archetypePercentile = null`, `archetypeRank = null` per league |

The `insufficientData` flag is at the result level. Per-league fields always carry their own
`insufficient` boolean so callers can gate downstream use.

---

## 9. Versioning

`BENCHMARK_VERSION = '6.5.0'` stamped on all outputs. Bump rules follow the same
major/minor/patch scheme as Phase 6.3 (see main ADR §8).

---

## 10. Non-Goals

- No AI calls or natural-language generation
- No new database tables or ports
- No production routes added (Phase 6.5 is pure library code)
- No mutation of input arrays
- No cross-league data exposure (outputs do not carry other leagues' raw data)
- Does not modify NFL readiness (stays at 93%) or overall platform readiness (stays at 90%)

---

## 11. Risk Controls

| Risk | Control |
|---|---|
| Misleading percentile with 1–2 leagues | `insufficientData = true` + `insufficient = true` per league |
| Division by zero in percentile formula | `n ≤ 1` guard returns 50 |
| Stale classifier logic | `BENCHMARK_VERSION` in every output |
| Cross-archetype contamination | Cohort map built from leagueId → archetype before any ranking |
| Input mutation | All input arrays traversed read-only; results built into new arrays |
