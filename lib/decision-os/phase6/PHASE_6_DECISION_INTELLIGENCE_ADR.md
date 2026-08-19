# Phase 6 — Decision Intelligence Architecture

**Status:** IN PROGRESS (Phase 6.3 League Archetypes COMPLETE)  
**Date:** 2026-06-30  
**Layer:** Decision OS Phase 6 — Intelligence Learning Layer

---

## 1. Purpose

Phase 5 answers **"what is happening?"** — behavioral events flow through an intelligence pipeline
that produces Manager, League, and Platform Behavioral Intelligence.

Phase 6 answers **"why is it happening?"** and eventually **"what should we do about it?"** It is the
Intelligence Learning Layer: a deterministic, auditable set of derived classifiers, pattern
detectors, benchmarks, and recommendation engines that operate on Phase 5 outputs.

**Key distinction:** Phase 6 is NOT an AI layer. It is a governed, transparent derivation system
that produces machine-readable, human-auditable conclusions from structured behavioral signals.

---

## 2. Layering Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Phase 5 Behavioral Intelligence               │
│  Events → ManagerIntelligence / LeagueIntelligence /            │
│           PlatformIntelligence                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ consumes (read-only)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Phase 6 Decision Intelligence                  │
│                                                                  │
│  6.3 League Archetypes         ← first consumer of Phase 5.3    │
│  6.5 Platform Benchmarking     ← consumers Phase 5.4 + 6.3      │
│  6.1 Behavioral Patterns       ← consumes Phase 5.1 events      │
│  6.2 Intervention Effectiveness ← consumes 6.1 + commissioner   │
│  6.4 Recommendation Engine     ← consumes 6.3 + 6.2             │
│  6.6 Company Intelligence      ← aggregates everything          │
└───────────────────────────────┬─────────────────────────────────┘
                                │ published via
                                ▼
               Phase 5.7 Intelligence API
               (extended IntelligenceDataProvider)
```

Phase 6 NEVER bypasses Phase 5. Phase 6 code ALWAYS consumes Phase 5 outputs as inputs —
never raw DB rows or port functions directly (until 6.1/6.2 pattern detection requires
time-series event windows not available from Phase 5.3 aggregates).

---

## 3. Inputs from Phase 5

| Phase 5 output | Phase 6 consumers |
|---|---|
| `LeagueBehavioralIntelligence` (Phase 5.3) | 6.3, 6.5, 6.4 |
| `ManagerBehavioralIntelligence` (Phase 5.2) | 6.5, 6.4, 6.6 |
| `PlatformBehavioralIntelligence` (Phase 5.4) | 6.5, 6.6 |
| `BehavioralEvent[]` (Phase 5.1) | 6.1, 6.2 |

Phase 6 defines its own input interface types for each consumer. These are structurally
compatible with Phase 5 outputs but do not import Phase 5 internal types — keeping Phase 6
independently testable and immune to Phase 5 internal refactors.

---

## 4. Outputs from Phase 6

| Phase 6 component | Output type | Key fields |
|---|---|---|
| 6.3 League Archetypes | `LeagueArchetypeResult` | archetype label, confidence, derivation chain |
| 6.5 Platform Benchmarking | `LeagueBenchmarkResult` | percentile ranks per dimension |
| 6.1 Behavioral Patterns | `LeagueBehavioralPattern[]` | pattern type, evidence, detected-at |
| 6.2 Intervention Effectiveness | `InterventionEffectResult` | pre/post delta, attribution strength |
| 6.4 Recommendation Engine | `LeagueRecommendationBundle` | cohort-matched recommendations |
| 6.6 Company Intelligence | `CompanyIntelligenceReport` | aggregate findings, cohort stats |

All outputs carry:
- A stable `version` string for auditability
- A `derivation[]` array (full signal chain)
- An `unknown` / `insufficient_data` value when confidence is too low (never fabricated)

---

## 5. Deterministic-Only Rule

**Phase 6 MUST NOT:**
- Call Claude, GPT, or any LLM API
- Use probabilistic ML models (k-means, random forests, etc.)
- Generate natural language from internal signals
- Make claims that can't be traced to a specific signal value
- Invent scores or labels when input signals are absent

**Phase 6 MUST:**
- Derive every output from observable Phase 5 signals
- Apply transparent, auditable rules (threshold checks, comparisons, tier mappings)
- Degrade to `'unknown'` / `null` / `insufficient_data` when signals are sparse
- Produce the same output for the same input, always

The line between "deterministic intelligence" and "AI generation" is:
> If a human could trace the output back to specific input values using a clear ruleset, it is deterministic.
> If it requires inference beyond the provided signals, it is AI and is prohibited.

---

## 6. Derivation-Chain Requirement

Every Phase 6 output MUST include a `derivation` field that documents:
- Every signal evaluated (path: `"leagueEngagementTier"`, value: `"dormant"`)
- How each signal contributed or did not contribute to the output
- Which signals were missing and which were present

This is the audit trail. It enables:
- Commissioner dashboard drill-downs ("why is my league classified as churn risk?")
- Engineering regression testing (confirm derivation chain hasn't shifted)
- Future Phase 6.6 Company Intelligence rollups (aggregate by derivation pattern)

---

## 7. Unknown / Insufficient-Data Handling

**Rule:** return `'unknown'` / `null` / `'insufficient_data'` rather than fabricating from sparse signals.

Per-component thresholds:
- **6.3 Archetypes**: `completeness < 20` → `'unknown'`; no classifier scores ≥ 0.50 → `'unknown'`
- **6.5 Benchmarking**: fewer than 3 leagues in cohort → `insufficient_data`
- **6.1 Patterns**: fewer than 5 events in time window → `no_pattern`
- **6.2 Intervention**: fewer than 3 post-event data points → `inconclusive`

The `signalCoverage` field ALWAYS lists which signals were evaluable and which were missing,
so callers know what data would improve the result.

---

## 8. Versioning Strategy

Every Phase 6 classifier carries a semantic version string: `{major}.{minor}.{patch}`

- **Patch** bump: weight adjustment, new secondary signal added, threshold tuning
- **Minor** bump: new archetype label or pattern type added (backwards compatible)
- **Major** bump: archetype label renamed, removed, or classification logic fundamentally changed
  (requires a Phase 6 ADR update)

Version strings are embedded in output (`result.version`) and logged in telemetry, enabling
historical comparison after classifier updates.

Current versions:
- Phase 6.3 League Archetypes: `6.3.0`

---

## 9. Hosted API Integration Strategy

Phase 6 outputs flow through the existing Phase 5.7 Intelligence API surface:

1. **Route handlers** (`app/api/v1/intelligence/`) — unchanged; thin wrappers
2. **`IntelligenceDataProvider`** interface — extended with `getLeagueArchetype(leagueId)` etc.
3. **`realDataProvider`** — extended to call `classifyLeagueArchetype(leagueIntelligence)` after
   loading league behavioral intelligence
4. **Phase 5.6 resolvers** — extended to include archetype fields in `LeagueIntelligenceV1`
5. **Phase 5.5 contracts** — `LeagueIntelligenceV1` gains `archetype?: LeagueArchetypeV1` field

This means Phase 6 outputs reach the API without new routes. The existing
`/api/v1/intelligence/league` endpoint returns archetype data alongside the behavioral
intelligence it already returns. No breaking changes.

**Phase 6 fields in external API (planned):**
```typescript
// Addition to LeagueIntelligenceV1 (Phase 5.5 contract — additive, non-breaking)
archetype?: {
  label:      string    // 'highly_engaged', 'trade_heavy', etc.
  confidence: number    // 0–1
  reasons:    string[]  // human-readable
  version:    string    // '6.3.0'
}
```

The `derivation[]` array is INTERNAL — it does not appear in the external API.

---

## 10. Phase 6 Build Order

| # | Phase | Depends on | Key output |
|---|---|---|---|
| 6.3 | League Archetypes | Phase 5.3 | `LeagueArchetypeResult` |
| 6.5 | Platform Benchmarking | Phase 5.4 + 6.3 | `LeagueBenchmarkResult` |
| 6.1 | Behavioral Patterns | Phase 5.1 events | `LeagueBehavioralPattern[]` |
| 6.2 | Intervention Effectiveness | 6.1 patterns | `InterventionEffectResult` |
| 6.4 | Recommendation Engine | 6.3 + 6.2 | `LeagueRecommendationBundle` |
| 6.6 | Company Intelligence | All of above | `CompanyIntelligenceReport` |

**6.3 is first** because it requires only existing Phase 5.3 outputs, adds zero new ports,
is pure function (no IO), and its archetype labels unlock 6.4 and 6.5.

---

## 11. Non-Goals

Phase 6 does NOT:
- Build a widget (that is Phase 7)
- Build an SDK (Phase 8)
- Build a billing layer (Phase 9)
- Build a visual intelligence platform (Phase 10)
- Add new database tables
- Modify NFL engine readiness (stays at 93%)
- Modify Overall Platform readiness (stays at 90%)
- Make any AI/generative calls

Phase 6 reports its own readiness separately from the NFL engine.

---

## 12. Risk Controls

| Risk | Control |
|---|---|
| Incorrect archetype classification | Per-classifier confidence threshold (0.50) + explicit unknown fallback |
| Stale classifier logic | Version string in every output + regression tests per classifier |
| Internal signal leakage to API | Phase 5.6 resolver strips `derivation[]` before external response |
| Silent fabrication | `unknown` label + empty `reasons[]` when data is sparse |
| Cross-phase coupling | Phase 6 defines its own input interface types (no Phase 5 internal imports) |
| Breaking API changes | Additive-only to Phase 5.5 contracts; `archetype?` is optional |

---

## 6.3 Classifier Detail — League Archetypes

### Archetype Labels

| Label | Meaning |
|---|---|
| `highly_engaged` | Elite or active engagement, low retention risk, high participation |
| `casual_social` | Active/moderate engagement but low transaction activity |
| `commissioner_driven` | Commissioner carries the league; managers are low-initiative |
| `competitive_balanced` | Both trade AND waiver are moderate+; balanced participation |
| `high_churn_risk` | High/critical retention risk + elevated inactivity |
| `low_engagement` | Passive engagement; at risk but not yet critical |
| `trade_heavy` | Trade activity dominates over waiver; trade tier = high |
| `waiver_active` | Waiver activity dominates over trade; waiver tier = high |
| `inactive_or_stale` | Dormant engagement; effectively dead or abandoned |
| `unknown` | Insufficient data or no dominant pattern found |

### Classification Priority Order

Classifiers run in this order — first one to meet its confidence threshold wins:

1. `inactive_or_stale` — dormant tier alone (0.60) crosses threshold
2. `high_churn_risk` — critical risk + elevated inactivity
3. `highly_engaged` — elite/active + low risk + high participation
4. `competitive_balanced` — gated: both trade AND waiver moderate+
5. `trade_heavy` — gated: trade tier = high + dominates waiver
6. `waiver_active` — gated: waiver tier = high + dominates trade
7. `commissioner_driven` — gated: heavy/critical workload + not elite engagement
8. `casual_social` — gated: active/moderate + low trade + low waiver
9. `low_engagement` — passive/dormant (when not caught by above)
10. `unknown` — fallback

### Confidence Policy

- Minimum confidence threshold: **0.50** (uniform across all archetypes)
- Below threshold → `'unknown'`
- Confidence is computed as the weighted sum of matched criteria (0.0–1.0, capped at 1.0)
- Weights are documented inline in `league-archetypes.ts`

### Unknown Policy

Return `'unknown'` when:
1. `completeness < 20` (insufficient behavioral event coverage)
2. `participationDistribution.totalManagers === 0` (no manager data)
3. No classifier scores ≥ 0.50 after all nine are tried

`'unknown'` always carries:
- A reason explaining why classification failed
- `signalCoverage` showing which signals were available and which were missing
- An empty `reasons[]` array (no unsupported claims)

### Future Integration

- **Phase 6.5**: archetype label becomes the cohort key for benchmarking
  ("your league vs. other `trade_heavy` leagues")
- **Phase 6.4**: archetype + pattern data feeds recommendation engine
  ("leagues like yours that added polling saw +23% activity")
- **Phase 6.6**: archetype distribution across platform → company intelligence
  ("72% of dormant leagues have critical retention risk before going inactive")
