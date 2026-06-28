/**
 * Live Scoring platform engine — reusable across every league concept.
 *
 * Pure, deterministic, sport/concept-agnostic primitives that the live pipeline,
 * matchup surface, and browser all share:
 *  - `cadence`        — when/whether to poll providers (30s live, stop on final)
 *  - `projection`     — pace-based rest-of-game live projections
 *  - `winProbability` — variance-aware live win %
 *  - `rescorePlan`    — incremental "only rescore what changed" planner
 */
export * from '@/lib/live-scoring/types'
export * from '@/lib/live-scoring/cadence'
export * from '@/lib/live-scoring/projection'
export * from '@/lib/live-scoring/winProbability'
export * from '@/lib/live-scoring/rescorePlan'
export * from '@/lib/live-scoring/playerScoreReadAdapter'
export * from '@/lib/live-scoring/orchestrator'
export * from '@/lib/live-scoring/provider'
export * from '@/lib/live-scoring/workerLoop'
