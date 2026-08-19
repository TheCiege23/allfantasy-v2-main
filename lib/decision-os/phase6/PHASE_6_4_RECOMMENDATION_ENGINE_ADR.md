# ADR — Phase 6.4: Deterministic Recommendation Engine

**Status:** ACCEPTED  
**Date:** 2026-07-01  
**Version:** 6.4.0

## Context

Phase 6 produces layered intelligence above the Phase 5 behavioral signal stack. Phases 6.1–6.3 and 6.5
answer **"what is happening?"** and **"who are these managers/leagues?"**

Phase 6.4 answers **"what should happen next?"** — producing prioritized, explainable, deterministic
recommendations for three consumer audiences:

- **Managers** — personal action items based on behavioral patterns and identity
- **Commissioners** — league health interventions based on archetypes and benchmark position
- **Platform** — product/feature/engagement opportunities based on platform-wide benchmarks

## Decision

Build three pure, deterministic recommendation assemblers:

1. `assembleManagerRecommendations(input: ManagerRecommendationInput): RecommendationSet`
2. `assembleCommissionerRecommendations(input: CommissionerRecommendationInput): RecommendationSet`
3. `assemblePlatformRecommendations(input: PlatformRecommendationInput): RecommendationSet`

Plus a unified orchestrator:

4. `assembleRecommendations(input: RecommendationEngineInput): RecommendationEngineResult`

## Recommendation schema

Every recommendation carries:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Deterministic: `rec_${tier}_${category}_${entityId}` |
| `tier` | `'manager' \| 'commissioner' \| 'platform'` | Audience |
| `category` | `RecommendationCategory` | Action family |
| `entityId` | `string` | managerId, leagueId, or platformId |
| `priority` | `critical \| high \| medium \| low` | Urgency tier |
| `severity` | `urgent \| elevated \| standard \| advisory` | Intensity |
| `confidence` | `high \| medium \| low` | Evidence quality |
| `affectedDimensions` | `string[]` | Which intelligence dimensions this addresses |
| `expectedImpact` | `string` | Plain-language outcome description |
| `derivation` | `string[]` | Full derivation chain — which signals, which thresholds |
| `evidence` | `string[]` | Specific evidence items supporting the recommendation |
| `benchmarkComparison` | `string \| null` | Platform benchmark context if available |
| `prerequisites` | `string[]` | What must be true for this rec to be actionable |
| `recommendedActions` | `RecommendedAction[]` | Ordered, specific action items |
| `rollbackCriteria` | `string[]` | When to dismiss or archive this recommendation |
| `completeness` | `number (0–100)` | Input data quality for this recommendation |
| `uncertainty` | `string[]` | Caveats that reduce confidence |

## Recommendation categories

**Manager (6 categories):**
1. `engagement_boost` — fired on inactivity patterns or unreliable engagement
2. `lineup_discipline` — fired on repeated indecision or bench regret
3. `trade_coaching` — fired on rejection patterns
4. `waiver_opportunity` — fired when transaction style is passive
5. `league_participation` — fired on ghost/set-and-forget identity
6. `draft_preparation` — fired on conservative roster pattern

**Commissioner (6 categories):**
1. `retention_intervention` — fired on high/critical retention risk or churn archetypes
2. `trade_activation` — fired on low trade benchmark percentile
3. `waiver_activation` — fired on low waiver benchmark percentile
4. `league_event` — fired on low engagement percentile
5. `weekly_recap` — fired on passive/dormant engagement
6. `rivalry_engagement` — fired on activity dropoff patterns

**Platform (4 categories):**
1. `benchmark_intervention` — fired when high-churn-risk league fraction is elevated
2. `product_opportunity` — fired when low-engagement league fraction is elevated
3. `cohort_improvement` — fired when inactive league fraction is elevated
4. `feature_adoption` — fired when inactive/stale archetypes dominate distribution

## Priority and severity thresholds

```
Manager engagement_boost:
  CRITICAL  if inactivity_window (high) OR identity=ghost_manager
  HIGH      if inactivity_window (medium/low) OR reliability=unreliable
  MEDIUM    if reliability=inconsistent only

Commissioner retention_intervention:
  CRITICAL  if retentionRisk=critical OR archetype=inactive_or_stale
  HIGH      if retentionRisk=high OR archetype=high_churn_risk
  MEDIUM    if retentionRisk=medium

Commissioner trade_activation:
  HIGH      if benchmark.tradeActivity.percentile < 10 OR tier=none
  MEDIUM    if benchmark.tradeActivity.percentile < 25 OR tier=low

Platform benchmark_intervention:
  CRITICAL  if highChurnRiskFraction > 0.40
  HIGH      if highChurnRiskFraction > 0.20
```

## Ordering invariant

Recommendations within a `RecommendationSet` are sorted by:
1. `priority` DESC (critical=4, high=3, medium=2, low=1)
2. `severity` DESC (urgent=4, elevated=3, standard=2, advisory=1)
3. `category` ASC (alphabetical, tiebreak for determinism)
4. `id` ASC (final tiebreak)

## Deterministic ID format

```
rec_<tier>_<category>_<entityId>
```

Non-alphanumeric characters in entityId are replaced with `_`. No crypto or hashing required — the
combination of (tier, category, entityId) is unique per entity because each category fires at most
once per entity.

## Input type independence

Phase 6.4 defines its own 6.4-local structural input types. No imports from Phase 6.1, 6.2, 6.3, or
6.5 type files. Inputs are minimal slices structurally compatible with upstream outputs.

## What does NOT qualify as a recommendation

- Observations without actionable next steps (those belong in derivation/evidence)
- Recommendations that require AI reasoning or LLM text generation
- Recommendations that require DB reads or writes
- Recommendations produced by rules that could contradict each other for the same signal

## Boundaries

**Does NOT duplicate:**
- Phase 6.1 pattern detection
- Phase 6.2 identity assembly
- Phase 6.3 league archetype classification
- Phase 6.5 benchmark ranking

**Phase 6.4 only derives** action items from those outputs. No new intelligence computation.

## Constraints

- Pure functions: no DB, no IO, no side effects, no AI
- Every output carries `derivation[]` and `version = '6.4.0'`  
- `RECOMMENDATION_VERSION = '6.4.0'`
- Empty recommendations list (not an error) when data is healthy and no thresholds are met
