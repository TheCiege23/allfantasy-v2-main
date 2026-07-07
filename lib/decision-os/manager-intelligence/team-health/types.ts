/**
 * Decision OS Manager Intelligence Platform — Phase 2.
 *
 * `ManagerTeamHealthV1`: the first display-only Manager Intelligence contract
 * OUTSIDE Replay. It is a DETERMINISTIC, OBSERVATIONAL summary of a manager's
 * current roster health — NOT an AI feature, NOT a recommendation.
 *
 * Every field is a fact derived deterministically from persisted roster data
 * (RedraftRosterPlayer.slotType / injuryStatus / byeWeek + RedraftSeason.
 * currentWeek). There is NO LLM, NO "start X", NO waiver/trade suggestion — the
 * validation→recommendation boundary that governs the whole platform stays
 * intact. This contract may be safely consumed by any Manager OS surface.
 */

export const MANAGER_TEAM_HEALTH_VERSION = 'manager-team-health.v1'

/** Healthy bench depth relative to available cover — an observation, not advice. */
export type BenchAvailability = 'healthy' | 'thin' | 'critical'

/** Whether this week's projected lineup can be fully fielded from available players. */
export type RosterCompleteness = 'excellent' | 'good' | 'needs_attention'

export interface ManagerTeamHealthV1 {
  /** Contract version — provenance for any consumer. */
  version: string
  /** ISO timestamp the summary was derived. */
  derivedAt: string

  /** Total active (non-dropped) players sitting in a starting-lineup slot. */
  starterCount: number
  /** Starters who can play this week (not out/IR and not on a bye). Deduplicated. */
  availableStarterCount: number

  /** Starters flagged out / IR / inactive (definitively unavailable). */
  injuredStarterCount: number
  /** Starters flagged questionable / doubtful / GTD (uncertain). */
  questionableStarterCount: number
  /** Starters whose team is on a bye this week (byeWeek === currentWeek). */
  byeWeekStarterCount: number

  benchAvailability: BenchAvailability
  rosterCompleteness: RosterCompleteness

  /** Deterministic, observational one-liner — templated from the counts above. */
  summary: string
}

/**
 * Minimal, Prisma-decoupled shape the pure aggregator consumes. Keeping the
 * aggregator free of Prisma types makes it trivially unit-testable with plain
 * objects (no DB, no mocks).
 */
export interface TeamHealthRosterPlayerInput {
  slotType: string | null | undefined
  injuryStatus?: string | null
  byeWeek?: number | null
  /** Active roster only — dropped players are ignored by the aggregator. */
  droppedAt?: Date | string | null
}

export interface TeamHealthAggregationInput {
  players: TeamHealthRosterPlayerInput[]
  /** RedraftSeason.currentWeek; 0/null means "no active week" → no bye impact. */
  currentWeek: number | null | undefined
}
