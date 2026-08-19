# ADR — Phase 6.2: Manager DNA / Identity Layer

**Status:** ACCEPTED  
**Date:** 2026-06-30  
**Version:** 6.2.0

## Context

Phase 6 produces deterministic intelligence above Phase 5 behavioral signals. Phase 6.1 detects
behavioral *patterns* (sequence detection on the event stream). Phase 6.3 classifies *league*
archetypes. Phase 6.5 *benchmarks* leagues against a platform cohort.

**Phase 6.2 fills the missing identity synthesis gap:** given what we know a manager *does*, what
kind of manager *are* they? This is a stable identity layer, not a moment-in-time metric.

## Decision

Build a **pure, deterministic identity-profile assembler** that converts:
1. `ManagerPatternGroupInput[]` — behavioral patterns from Phase 6.1 output
2. `ManagerSignalInput[]` — per-manager aggregate signals (structurally compatible with Phase 5.2)
3. `ManagerLeagueContextInput?` — optional league archetype + benchmark percentile from Phase 6.3/6.5

Into per-manager `ManagerDnaProfile` objects containing:
- **`primaryIdentity`** — one of 8 mutually exclusive labels (or `'unknown'`)
- **`decisionStyle`** — how the manager makes roster decisions
- **`transactionStyle`** — whether they lean trades, waivers, both, or neither
- **`riskTendency`** — appetite for roster risk
- **`engagementReliability`** — consistency of participation
- **`traits`** — specific behavioral traits with strength and evidence

## Identity Classifier (priority-ordered pipeline)

First label whose scorer reaches its threshold wins. Mirrors the Phase 6.3 archetype approach.

| Priority | Label | Gate | Threshold | Key signals |
|---|---|---|---|---|
| 1 | `ghost_manager` | none | 0.50 | `manager_inactivity_window` (high=0.65, med=0.50, low=0.30) + dormant tier |
| 2 | `set_and_forget` | conservative pattern | 0.50 | `conservative_roster_pattern` (high=0.52 alone) + low waiver/trade rates |
| 3 | `reactive_manager` | overreaction OR bench_regret | 0.50 | combined overreaction + bench_regret scores |
| 4 | `indecisive_tinkerer` | lineup_indecision OR bench_regret | 0.50 | `repeated_lineup_indecision` (high=0.52 alone) + bench_regret bonus |
| 5 | `serial_trader` | trade_spike | 0.50 | `trade_proposal_spike` (high=0.55 alone) + rate bonus |
| 6 | `waiver_hawk` | waiver_streak | 0.50 | `waiver_aggression_streak` (high=0.55 alone) + rate bonus |
| 7 | `trade_seeker` | none | **0.40** | moderate trade rate + optional rejection evidence |
| 8 | `committed_grinder` | none | 0.50 | elite/active tier + no negative patterns |
| 9 | `unknown` | — | — | fallback; also triggered when completeness < 20 |

## Fixture design note

A fixture targeting priority N must score < threshold on priorities 1..N-1:
- To avoid `ghost_manager`: no `manager_inactivity_window`, not dormant tier
- To avoid `set_and_forget`: no `conservative_roster_pattern`
- To avoid `reactive_manager`: no `matchup_overreaction` (bench_regret alone scores ≤ 0.35 for reactive)
- To avoid `indecisive_tinkerer`: no `repeated_lineup_indecision` AND no `bench_regret_repetition`
- `trade_seeker` has lower threshold (0.40) — ensure committed_grinder fixture has trade rate ≤ 0.10

## Boundaries

**Does NOT duplicate:**
- Phase 6.1 pattern detection (sequence detection on event stream)
- Phase 6.3 league archetype aggregation
- Phase 6.5 platform benchmarking

**Phase 6.2 only synthesizes** the outputs of those phases into a stable manager identity.

## Input type independence

Phase 6.2 defines its own structural input types (`DetectedPatternInput`, `ManagerPatternGroupInput`,
etc.) that are structurally compatible with but do not import from Phase 6.1/6.3/6.5 types. This
preserves cross-phase boundary independence — each Phase 6 sub-phase defines its own interface.

## Known limitations

- `bench_regret_repetition` alone (without `matchup_overreaction` or `repeated_lineup_indecision`)
  does not trigger `reactive_manager` or `indecisive_tinkerer` by design — high standalone bench
  regret is surfaced as a trait, not a primary identity, since it does not disambiguate identity.
- `injury_response_delay` carries a proxy-detection warning inherited from Phase 6.1 — the
  corresponding trait `slow_injury_responder` is marked accordingly.
- `leagueContext` is optional — absence applies a minor completeness penalty but does not block
  profile assembly.

## Constraints

- Pure functions: no DB, no IO, no side effects, no AI
- All outputs carry `derivation[]` and `version = '6.2.0'`
- `'unknown'` when completeness < 20 or no classifier reaches threshold
- Profiles sorted by `managerId` ascending for stable ordering
- Mutual exclusion: no phase-6 constants (PATTERN_VERSION, ARCHETYPE_VERSION, BENCHMARK_VERSION)
  reused — each sub-phase stamps its own version
