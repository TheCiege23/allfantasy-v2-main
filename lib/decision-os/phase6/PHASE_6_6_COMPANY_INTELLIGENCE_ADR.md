# ADR — Phase 6.4: Company Intelligence Foundation

**Status:** ACCEPTED  
**Date:** 2026-07-01  
**Version:** 6.6.0

## Context

Phase 6 produces a layered intelligence stack. Phases 6.1–6.5 operate at the manager and
league level. Phase 6.6 aggregates those outputs upward to produce **platform/licensee-level
intelligence** — insights consumable by product teams, platform operators, and enterprise
licensees without exposing individual user behavior.

Phase 6.6 answers:
- "What is driving (or hurting) retention across the platform?"
- "Where are the largest engagement improvement opportunities?"
- "Which league formats perform best?"
- "What commissioner behaviors correlate with healthy leagues?"
- "What monetization signals are deterministically derivable from platform-wide patterns?"

## Decision

Build one pure assembler:

```
assembleCompanyIntelligence(input: CompanyIntelligenceInput): CompanyIntelligenceResult
```

Producing nine output sections, all deterministic:

| Section | Source signals |
|---|---|
| `retentionDrivers` | Archetype distribution + engagement tier counts |
| `churnRiskFactors` | Retention risk counts + engagement tiers + inactive manager avg |
| `featureAdoptionOpportunities` | Transaction tier counts + workload counts |
| `commissionerBehaviorInsights` | Workload counts + league pattern aggregate |
| `leagueFormatEffectiveness` | Archetype distribution (labeled signal map) |
| `engagementHealthSummary` | Multi-source weighted deduction formula |
| `cohortRecommendations` | Archetype distribution (at-risk archetypes only) |
| `monetizationSignals` | Archetype distribution + engagement health |
| `dataQualityReport` | Input slice presence + completeness |

## Privacy invariants (hard rules — never violate)

1. **No individual identifiers.** Output types contain no `managerId`, `leagueId`, `teamId`,
   `userId`, or any per-entity identifier. `platformId` is the only ID (licensee-level).
2. **Aggregate-only counts.** All numbers are counts or fractions across the platform.
3. **No provider names.** Output strings never mention provider names or internal backend fields.
4. **No raw user behavior.** No per-manager event data flows into outputs.
5. **No AI-generated narratives.** All output strings are deterministic template strings.

## Input slices (6.6-local — no cross-sub-phase type imports)

All input types are 6.6-local structural slices compatible with upstream outputs:

- `PlatformBenchmarkSummarySlice` — platform-wide dimension stats (from 6.5)
- `ArchetypeDistributionSlice` — league archetype counts (from 6.3)
- `RecommendationAggregateSlice` — recommendation counts by category/tier/priority (from 6.4)
- `LeagueSignalAggregateSlice` — engagement/retention tier counts across leagues (from 5.3)
- `PatternAggregateSlice` — behavioral pattern occurrence counts (from 6.1, no IDs)

## Engagement Health Score formula

```
score = 100
  - 30 × passiveDormantFraction         (max −30)
  - 35 × criticalRetentionFraction      (max −35)
  - 20 × inactiveArchetypeFraction      (max −20)
  - 10 if insufficientData              (max −10)
clamped to [0, 100], integer
```

Health tiers: excellent ≥ 80 | good ≥ 65 | moderate ≥ 50 | poor ≥ 35 | critical < 35

## Data quality completeness formula

| Input | Full | Partial | Absent |
|---|---|---|---|
| benchmark | 25 (sufficient) or 15 (insufficient) | — | 0 |
| archetypeDistribution | 20 (≥5) / 12 (≥2) / 6 (≥1) | — | 0 |
| recommendationAggregate | 20 (recs>0) or 10 (present, 0 recs) | — | 0 |
| leagueSignals | 20 (≥5) / 12 (≥2) / 6 (≥1) | — | 0 |
| patternAggregate | 15 | — | 0 |

Maximum: 100.

## Ordering conventions

- `retentionDrivers`: strength DESC (strong → moderate → weak)
- `churnRiskFactors`: riskLevel DESC (critical → high → medium → low)
- `featureAdoptionOpportunities`: adoptionGap DESC (large → moderate → small)
- `commissionerBehaviorInsights`: insertion order (negative first, then positive)
- `leagueFormatEffectiveness`: leagueCount DESC
- `cohortRecommendations`: priority DESC → targetLeagueCount DESC
- `monetizationSignals`: potential DESC (high → moderate → low)

## Thresholds

```
Retention driver strength:
  strong   ≥ 0.35
  moderate ≥ 0.15
  weak     ≥ 0.05
  (below 0.05 = not surfaced)

Churn risk level:
  critical > 0.40
  high     > 0.25
  medium   > 0.10
  low      > 0.05
  (at or below 0.05 = not surfaced)

Feature adoption gap:
  large    > 0.40
  moderate > 0.20
  small    > 0.05
  (at or below 0.05 = not surfaced)

Commissioner prevalence:
  widespread ≥ 0.40
  common     ≥ 0.20
  occasional ≥ 0.08
  rare       ≥ 0.02
  (below 0.02 = not surfaced)

Monetization potential:
  high     ≥ 0.40
  moderate ≥ 0.20
  (below 0.20 = not surfaced for premium_tier_opportunity)
  high     ≥ 0.30 for commissioner_tools_expansion
  moderate ≥ 0.15
  (below 0.15 = not surfaced)
```

## Boundaries

**Does NOT duplicate:**
- Phase 6.1 pattern detection
- Phase 6.3 archetype classification
- Phase 6.4 individual recommendation generation
- Phase 6.5 per-league percentile ranking

**Phase 6.6 only aggregates** those outputs into licensee-visible intelligence. No new
intelligence computation — only aggregation, fractionalization, and threshold-based labeling.

## Constraints

- `COMPANY_INTELLIGENCE_VERSION = '6.6.0'`
- Pure functions: no DB, no IO, no side effects, no AI
- Every output section carries `derivation[]` and `completeness`
- Empty sections (not an error) when signals below threshold
- Health summary always produced (even if all inputs absent — returns score=50, tier=moderate, completeness=0)
