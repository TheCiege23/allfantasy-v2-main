# Phase 6 — Decision Intelligence Layer: Completion Checkpoint

**Status:** COMPLETE  
**Date:** 2026-07-01  
**Branch:** `g15-event-foundation`  
**Suite:** 449 Phase 6 tests / 1735 total Decision OS tests — all GREEN

---

## 1. What Phase 6 Is

Phase 6 is the **Decision Intelligence Layer** of the Decision OS stack. It sits above Phase 5
(Behavioral Signal Aggregation) and below the API and Widget Platform layers that will expose
intelligence externally.

Phase 6 answers three questions that Phase 5 cannot:

| Question | Phase |
|---|---|
| What behavioral patterns are emerging? | 6.1 |
| Who is this manager / what kind of league is this? | 6.2 / 6.3 |
| How does this league compare to its peers? | 6.5 |
| What should happen next? | 6.4 |
| What does this mean at the platform level? | 6.6 |

All Phase 6 components are **pure deterministic functions**: no DB, no IO, no AI, no side effects.
Every output carries a `derivation[]` chain and a `version` stamp.

---

## 2. Commit Timeline

| Sub-phase | Description | Commit | Tests |
|---|---|---|---|
| **6.3** | League Archetype Classifier | `51bea915b` | 49 |
| **6.5** | Platform Benchmarking | `6eb4875fb` | 51 |
| **6.1** | Behavioral Patterns | `b040acd16` | 60 |
| **6.2** | Manager DNA / Identity Layer | `7fba2effc` | 79 |
| **6.4** | Recommendation Engine | `968982e43` | 113 |
| **6.6** | Company Intelligence Foundation | `bd06b42b1` | 97 |
| **6.7** | Completion Checkpoint | *(this commit)* | — |

Build order rationale: 6.3 and 6.5 first (stateless classifiers with no upstream dependencies within
Phase 6); 6.1 before 6.2 (patterns feed DNA); 6.4 after 6.2/6.3 (recommendations consume identity
and archetype); 6.6 last (aggregates all above).

---

## 3. Output Inventory

### 6.1 — Behavioral Patterns (`lib/decision-os/phase6/patterns/`)

**Assembler:** `detectBehavioralPatterns(input) → BehavioralPatternResult`  
**Version:** `PATTERN_VERSION = '6.1.0'`

**12 pattern types:**

*Manager-level (attributed to a managerId):*
| Pattern | Signal |
|---|---|
| `repeated_lineup_indecision` | 3+ lineup saves in the same week |
| `waiver_aggression_streak` | 5+ waiver claims in 21 days |
| `trade_proposal_spike` | 4+ trade proposals in 14 days |
| `manager_inactivity_window` | 30+ days with no events while league is active |
| `bench_regret_repetition` | Same player flip-flopped bench↔starter 3+ times |
| `injury_response_delay` | Player benched, no waiver filed for 7 days, stays benched |
| `matchup_overreaction` | 4+ slot changes in 3+ consecutive weeks |
| `conservative_roster_pattern` | Zero slot changes in 4+ consecutive weeks |
| `trade_rejection_pattern` | 3+ trade proposals rejected in 30 days |

*League-level:*
| Pattern | Signal |
|---|---|
| `league_activity_surge` | 2× baseline in a 7-day window (28-day baseline) |
| `league_activity_dropoff` | <40% of baseline in a 14-day window |
| `commissioner_rules_churn` | 3+ rules changes in 21 days |

**Key properties:**
- Non-overlapping sliding windows for surge/dropoff
- Consecutive-week enforcement for streak patterns
- `injury_response_delay` carries `proxy_detection` warning (absence-based, not direct)
- Evidence windows carry `eventIds[]` (absence-based patterns carry empty list)

---

### 6.2 — Manager DNA / Identity Layer (`lib/decision-os/phase6/dna/`)

**Assembler:** `assembleManagerDna(input) → ManagerDnaResult`  
**Version:** `MANAGER_DNA_VERSION = '6.2.0'`

**8 identity labels (priority-ordered, threshold ≥ 0.50 except trade_seeker = 0.40):**

| Priority | Label | Gate condition |
|---|---|---|
| 1 | `ghost_manager` | `manager_inactivity_window` |
| 2 | `set_and_forget` | `conservative_roster_pattern` |
| 3 | `reactive_manager` | overreaction OR bench_regret (combined score ≥ 0.50) |
| 4 | `indecisive_tinkerer` | lineup_indecision OR bench_regret |
| 5 | `serial_trader` | `trade_proposal_spike` |
| 6 | `waiver_hawk` | `waiver_aggression_streak` |
| 7 | `trade_seeker` | moderate trade rate + rejection pattern |
| 8 | `committed_grinder` | elite/active tier + no negative patterns |
| — | `unknown` | completeness < 20 or no classifier ≥ threshold |

**Five identity dimensions (beyond primary label):**
- `decisionStyle`: decisive / indecisive / reactive / methodical
- `transactionStyle`: trade_dominant / waiver_dominant / balanced / passive
- `riskTendency`: risk_taking / risk_averse / neutral
- `engagementReliability`: reliable / inconsistent / unreliable
- `traits[]`: per-pattern named traits with strength (strong/moderate/weak) and evidence strings

---

### 6.3 — League Archetype Classifier (`lib/decision-os/phase6/archetypes/`)

**Assembler:** `classifyLeagueArchetype(input) → LeagueArchetypeResult`  
**Version:** `ARCHETYPE_VERSION = '6.3.0'`

**10 archetype labels (priority-ordered, threshold ≥ 0.50):**

| Priority | Label | Dominant signal |
|---|---|---|
| 1 | `inactive_or_stale` | Dormant engagement tier alone |
| 2 | `high_churn_risk` | Critical retention + elevated inactivity |
| 3 | `highly_engaged` | Elite/active tier + low risk + high participation |
| 4 | `competitive_balanced` | Moderate+ trade AND waiver activity |
| 5 | `trade_heavy` | High trade + dominates waiver rate |
| 6 | `waiver_active` | High waiver + dominates trade rate |
| 7 | `commissioner_driven` | Heavy/critical workload, not elite engagement |
| 8 | `casual_social` | Active/moderate + low transaction both sides |
| 9 | `low_engagement` | Passive engagement, no higher threshold met |
| 10 | `unknown` | No classifier ≥ 0.50, or data too sparse |

---

### 6.5 — Platform Benchmarking (`lib/decision-os/phase6/benchmark/`)

**Assembler:** `assemblePlatformBenchmark(input) → PlatformBenchmarkResult`  
**Version:** `BENCHMARK_VERSION = '6.5.0'`

**Five benchmarked dimensions (per-league percentile rank, 0–100, 100 = best):**
- `engagement` — by `leagueEngagementScore`
- `retentionSafety` — inverted risk score (low risk = high percentile)
- `tradeActivity` — by `perManagerRate`
- `waiverActivity` — by `perManagerRate`
- `commissionerEfficiency` — inverted workload (light = high percentile)

**Rank formula:** `rank = count(above) + 1`; `percentile = round((n - rank) / (n - 1) × 100)`  
**Cohort percentiles:** per archetype, minimum cohort size = 3  
**Aggregates:** platform-wide top/bottom 3 leagues per dimension (by leagueId ASC for ties)

---

### 6.4 — Recommendation Engine (`lib/decision-os/phase6/recommendations/`)

**Assemblers:**
- `assembleManagerRecommendations(input) → RecommendationSet`
- `assembleCommissionerRecommendations(input) → RecommendationSet`
- `assemblePlatformRecommendations(input) → RecommendationSet`
- `assembleRecommendations(input) → RecommendationEngineResult` (orchestrator)

**Version:** `RECOMMENDATION_VERSION = '6.4.0'`

**16 recommendation categories across three tiers:**

*Manager (6):*
| Category | Trigger |
|---|---|
| `engagement_boost` | Inactivity pattern OR unreliable/inconsistent reliability |
| `lineup_discipline` | Lineup indecision (medium+) OR bench regret (high) |
| `trade_coaching` | Trade rejection pattern (medium+) OR trade_seeker identity |
| `waiver_opportunity` | Passive transaction style + no waiver streak |
| `league_participation` | ghost_manager (HIGH) or set_and_forget (LOW) identity |
| `draft_preparation` | Conservative roster pattern OR set_and_forget identity |

*Commissioner (6):*
| Category | Trigger |
|---|---|
| `retention_intervention` | retentionRisk high/critical OR churn archetypes |
| `trade_activation` | tradeActivity benchmark < 10th pct OR tier=none/low |
| `waiver_activation` | waiverActivity benchmark < 25th pct OR tier=none/low |
| `league_event` | Engagement benchmark < 30th pct OR passive/dormant tier |
| `weekly_recap` | Passive/dormant tier OR engagement < 40th pct |
| `rivalry_engagement` | `league_activity_dropoff` pattern detected |

*Platform (4):*
| Category | Trigger |
|---|---|
| `benchmark_intervention` | highChurnRiskFraction > 0.20 |
| `product_opportunity` | lowEngagementLeagueFraction > 0.30 |
| `cohort_improvement` | inactiveLeagueFraction > 0.25 |
| `feature_adoption` | Inactive archetype fraction > 0.20 |

**Every recommendation carries:** deterministic id (`rec_${tier}_${category}_${entityId}`),
priority, severity, confidence, affectedDimensions, expectedImpact, derivation[], evidence[],
benchmarkComparison (nullable), prerequisites[], recommendedActions[], rollbackCriteria[],
completeness, uncertainty[]

**Ordering invariant:** priority DESC → severity DESC → category ASC → id ASC

---

### 6.6 — Company Intelligence Foundation (`lib/decision-os/phase6/company/`)

**Assembler:** `assembleCompanyIntelligence(input) → CompanyIntelligenceResult`  
**Version:** `COMPANY_INTELLIGENCE_VERSION = '6.6.0'`

**Nine output sections (all aggregate-only, no individual IDs):**

| Section | What it surfaces |
|---|---|
| `retentionDrivers` | Platform-wide behavioral signals that predict retention |
| `churnRiskFactors` | Platform-wide risk signals with severity and mitigation |
| `featureAdoptionOpportunities` | Adoption gaps by transaction/engagement tier counts |
| `commissionerBehaviorInsights` | Commissioner workload patterns and health correlation |
| `leagueFormatEffectiveness` | Per-archetype engagement and retention signal mapping |
| `engagementHealthSummary` | Weighted platform health score 0–100 + health tier |
| `cohortRecommendations` | Archetype-level action items for at-risk segments |
| `monetizationSignals` | Deterministically derivable upsell/expansion signals |
| `dataQualityReport` | Input completeness across 5 dimensions, 100-pt scale |

**Health score formula:**
```
score = 100
  − 30 × passiveDormantFraction
  − 35 × criticalRetentionFraction
  − 20 × inactiveArchetypeFraction
  − 10 if insufficientData
clamped to [0, 100], rounded to integer
```

---

## 4. Privacy Boundary Summary

Phase 6 enforces two distinct privacy tiers:

### Tier 1 — Manager/League intelligence (6.1, 6.2, 6.3, 6.4, 6.5)

- Outputs carry `managerId` and `leagueId` fields — these are **internal identifiers only**
- Must NOT be exposed to external consumers without authentication and access control
- Phase 6.4 recommendations are personal — treat as private user data
- No provider name leaks (Sleeper, Yahoo, ESPN) in output strings; confirmed by
  `F0-1 CLOSED` (scoring settings allow-list + `narrowScoringSettings` provider-blind strip)
- `derivation[]` chains are auditable but may reference internal signal names — safe for internal
  use, must be filtered before external API exposure

### Tier 2 — Company/Licensee intelligence (6.6)

**Strict aggregate-only invariants (enforced in output types — no ID fields possible):**
- No `managerId`, `leagueId`, `teamId`, `userId` in any output type
- `platformId` is the only identifier (licensee-level, not user-level)
- All counts are platform-wide aggregates; no per-entity breakdown
- All strings are deterministic templates — no AI-generated narratives
- No provider names in any output string
- `derivation[]` contains only aggregate signal descriptions

**Privacy test coverage:** Phase 6.6 test suite includes explicit `JSON.stringify` scans for
`managerId`, `leagueId`, `teamId`, `userId`, and known provider names.

---

## 5. Commercial Use-Case Summary

| Use Case | Phase 6 component(s) | Consumer |
|---|---|---|
| **Commissioner dashboard** | 6.4 commissioner recommendations, 6.3 archetype, 6.5 benchmark | Commissioner UI (not yet built) |
| **Manager weekly brief** | 6.4 manager recommendations, 6.2 DNA, 6.1 patterns | Manager UI (not yet built) |
| **Platform operator analytics** | 6.5 benchmarks, 6.6 company intelligence | Internal dashboard / licensee portal |
| **Enterprise licensee reporting** | 6.6 company intelligence (aggregate-only, privacy-safe) | Enterprise API / white-label reports |
| **Embeddable league health widget** | 6.3 archetype, 6.5 benchmark, 6.4 commissioner recs | Widget Platform (not yet built) |
| **AI assistant grounding context** | All Phase 6 outputs (derivation chains = auditable facts) | AI routes (6.4 recs already designed for this) |
| **Cohort improvement campaigns** | 6.6 cohort recommendations, 6.4 platform recommendations | Product/growth team tooling |
| **Monetization signal detection** | 6.6 monetization signals | Revenue/product analytics |

---

## 6. Remaining Gaps Before Widget / API Productization

The following are **known gaps** that must be closed before Phase 6 outputs are exposed externally.
None block the current Decision OS architecture (they are productization concerns, not intelligence
correctness concerns).

### 6a. Data pipeline wiring
Phase 6 assemblers are pure functions receiving structured input. No live pipeline feeds Phase 5
outputs into Phase 6 automatically. **Needed:** scheduled aggregation jobs (or per-request
computation) that convert Phase 5 DB-resident signals into Phase 6 input types.

### 6b. API route exposure
No public or internal API routes expose Phase 6 outputs. Phase 5 has staging-verified intelligence
API stubs (`F5.5–F5.10`), but Phase 6 has not been wired to those routes yet.  
**Needed:** API route handlers for `/intelligence/manager/:managerId`, `/intelligence/league/:leagueId`,
`/intelligence/platform`, and `/intelligence/company`.

### 6c. Output caching
Phase 6 assemblers recompute on every call. At API scale (per-request calls for all managers in a
league), results must be cached.  
**Needed:** Redis or DB-column caching with TTL, keyed by (entity, version).

### 6d. Aggregation pipeline for Phase 6.6
Phase 6.6 takes pre-aggregated slices (no individual IDs). The aggregation step that converts
raw Phase 5 / Phase 6.1–6.4 outputs into 6.6 input slices is not yet built.  
**Needed:** a dedicated aggregation service that computes `LeagueSignalAggregateSlice`,
`ArchetypeDistributionSlice`, `RecommendationAggregateSlice`, `PatternAggregateSlice` from
existing data and feeds them to `assembleCompanyIntelligence`.

### 6e. Historical trend data
All Phase 6 outputs are **point-in-time snapshots**. No week-over-week comparison exists.  
**Needed:** a snapshot store that persists Phase 6 outputs with timestamps, enabling trend
detection ("engagement score improved +12 points since last week") and archetype migration
tracking ("this league moved from inactive_or_stale to casual_social").

### 6f. Privacy access control layer (Tier 1 endpoints)
Manager DNA and behavioral patterns (6.1, 6.2) carry `managerId`. Before external API exposure:  
**Needed:** authentication + authorization middleware that verifies the requesting user can see
the `managerId` requested (commissioner for their league, or self-access).

### 6g. Multi-tenant isolation
For enterprise licensing, each licensee's data and 6.6 outputs must be strictly isolated.  
**Needed:** tenant boundary enforcement in the data pipeline and API layer; per-licensee
`platformId` validation.

### 6h. Widget Platform
The commercial vision includes embeddable widgets (league health card, manager DNA card, benchmark
visualization). Phase 6 is the data layer for these widgets, but no widget code exists.  
**Needed:** Widget Platform (likely a separate phase/project) consuming Phase 6 API outputs.

### 6i. API consumer version contract
`*_VERSION` constants exist on all outputs (`6.1.0`, `6.2.0`, etc.) but no consumer version
negotiation or backward-compatibility strategy is defined.  
**Needed:** API versioning policy, deprecation plan, and breaking-change communication strategy
before any external consumer depends on these outputs.

---

## 7. Full Suite Confirmation

**Date:** 2026-07-01  
**Command:** `npx vitest run __tests__/decision-os`

```
Test Files  63 passed (63)
Tests       1735 passed (1735)
Duration    ~90s
```

**Phase 6 tests only:**  
`npx vitest run __tests__/decision-os/phase6`

```
Test Files  6 passed (6)
Tests       449 passed (449)
Duration    ~7s
```

**Per-sub-phase test counts:**

| Sub-phase | Test file | Tests |
|---|---|---|
| 6.1 Behavioral Patterns | `behavioral-patterns.test.ts` | 60 |
| 6.2 Manager DNA | `manager-dna.test.ts` | 79 |
| 6.3 League Archetypes | `league-archetypes.test.ts` | 49 |
| 6.4 Recommendation Engine | `recommendation-engine.test.ts` | 113 |
| 6.5 Platform Benchmarking | `platform-benchmark.test.ts` | 51 |
| 6.6 Company Intelligence | `company-intelligence.test.ts` | 97 |
| **Total Phase 6** | | **449** |

No regressions in the broader Decision OS suite (Phase 1–5 tests + integration contract tests).

---

## 8. Architecture Freeze Status

The Architecture Freeze declared on 2026-06-29 (`lib/decision-os/ARCHITECTURE_FREEZE.md`) remains
in effect. Phase 6 additions were built **above** the frozen Phase 1–5 components without
modifying any frozen internals.

Any change to Phase 1–5 internals requires an explicit ADR before proceeding.

---

## 9. Next Phase

With Phase 6 complete, the Intelligence Platform stack stands at:

```
[COMPLETE]  Phase 1–2: Canonical World substrate
[COMPLETE]  Phase 3: Slice migration (lineup/waiver/trade/commissioner)
[COMPLETE]  Phase 4: Shadow/live cutover infrastructure
[COMPLETE]  Phase 5: Behavioral Signal Aggregation (5.1–5.10)
[COMPLETE]  Phase 6: Decision Intelligence Layer (6.1–6.6)
[NEXT]      Phase 7: API productization (wire Phase 6 to intelligence routes)
[FUTURE]    Phase 8: Widget Platform (embeddable components)
[FUTURE]    Phase 9: Enterprise licensing tier + multi-tenancy
```

**Recommended next step:** Phase 7.1 — wire `assembleManagerRecommendations` and
`assembleCompanyIntelligence` to the Phase 5.5 intelligence API routes (already stubbed),
starting with the Commissioner health endpoint (Stage 1 soak already live at
`DECISION_OS_COMMISSIONER_HEALTH_LIVE=true`). This closes gap 6b above and validates the
end-to-end intelligence pipeline from DB to API consumer.
