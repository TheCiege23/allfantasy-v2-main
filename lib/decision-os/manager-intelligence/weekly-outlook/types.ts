/**
 * Decision OS Manager Intelligence Platform — Phase 3.
 *
 * `ManagerWeeklyOutlookV1`: the second display-only Manager Intelligence contract
 * outside Replay. It answers "what does this week look like for my team?" with
 * DETERMINISTIC, OBSERVATIONAL facts — never a start/sit, waiver, trade, or
 * matchup recommendation.
 *
 * Every field is derived from persisted deterministic data only: the current
 * `RedraftMatchup` row (week, status, home/away projected points, opponent) and
 * the reused Team Health lineup signals (RedraftRosterPlayer). NO AI, NO
 * generative/recommendation endpoint (`/api/ai-tools/matchup-prep/*`,
 * `/api/ai/matchup-preview` are explicitly NOT consumed). When projections or
 * opponent data aren't safely available, the contract says so honestly with
 * `null` / `'unknown'` / `'unavailable'` rather than fabricating a value.
 */

export const MANAGER_WEEKLY_OUTLOOK_VERSION = 'manager-weekly-outlook.v1'

export type MatchupState = 'scheduled' | 'in_progress' | 'completed' | 'unavailable'
export type ProjectedMargin = 'favored' | 'close' | 'underdog' | 'unknown'
export type LineupReadiness = 'ready' | 'needs_attention' | 'incomplete' | 'unknown'
export type SchedulePressure = 'normal' | 'high' | 'unknown'

export interface ManagerWeeklyOutlookV1 {
  version: typeof MANAGER_WEEKLY_OUTLOOK_VERSION
  derivedAt: string

  week: number | null

  matchupState: MatchupState
  opponentName: string | null

  projectedPointsFor: number | null
  projectedPointsAgainst: number | null
  projectedMargin: ProjectedMargin

  lineupReadiness: LineupReadiness
  schedulePressure: SchedulePressure

  /** Deterministic, observational one-liner — templated from the fields above. */
  summary: string
  /** Honest disclaimers about what could NOT be determined (never advice). */
  caveats: string[]
}

// ── pure aggregator inputs (Prisma-decoupled) ────────────────────────────────

export interface WeeklyOutlookMatchupInput {
  /** false → no matchup row for the week → matchupState 'unavailable'. */
  hasMatchup: boolean
  week: number | null
  /** Raw RedraftMatchup.status; classified case-insensitively. */
  status: string | null
  /** Projected points from the user's roster's perspective (null when absent). */
  userProjected: number | null
  opponentProjected: number | null
  /** null for a bye / median week (no head-to-head opponent). */
  opponentName: string | null
}

/**
 * Lineup signal, mapped by the resolver from the reused (read-only) Team Health
 * aggregate. Kept as plain primitives so the pure aggregator never imports the
 * Team Health contract.
 */
export interface WeeklyOutlookLineupInput {
  hasRoster: boolean
  starterCount: number
  injuredStarterCount: number
  questionableStarterCount: number
  byeWeekStarterCount: number
}

export interface WeeklyOutlookAggregationInput {
  currentWeek: number | null
  matchup: WeeklyOutlookMatchupInput | null
  lineup: WeeklyOutlookLineupInput
}
