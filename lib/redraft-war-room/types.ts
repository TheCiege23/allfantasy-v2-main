/**
 * REDRAFT AF WAR ROOM — shared types & data-availability contract.
 *
 * CONTRACT BOUNDARY (mirrors lib/league-decision-context.ts):
 * - The context object built by `redraftWarRoomContext.ts` is the AUTHORITATIVE,
 *   deterministic, serializable source of league intelligence for redraft leagues.
 * - Engines (`redraft{TeamNeeds,Waiver,Trade,Lineup}Engine.ts`) are PURE functions
 *   that consume this context. They never call OpenAI and never fabricate raw values.
 * - AI (the `ask` route) may explain/recommend over the deterministic output but is
 *   instructed not to invent stats, projections, injuries, odds, or news.
 *
 * GUARDRAILS:
 * - Redraft only — no dynasty values, no taxi/devy/C2C/future-pick logic.
 * - Season-horizon framing (this week → rest of season → playoff push), not asset accrual.
 * - NFL pools never mix with NCAAF pools (sport is carried through context).
 */

import type { CanonicalNflDataCoverage } from '@/lib/nfl-data-foundation/types'

export type DataState = 'available' | 'stale' | 'missing'

/** Per-source availability so every feature can degrade safely instead of fabricating. */
export interface RedraftDataAvailability {
  scoringRules: DataState
  rosterRules: DataState
  standings: DataState
  schedule: DataState
  playerStats: DataState
  projections: DataState
  injuries: DataState
  news: DataState
  waiverPool: DataState
  tradeValues: DataState
}

export interface RedraftFreshness {
  /** ISO timestamp the context was assembled. */
  generatedAt: string
  /** ISO timestamp of newest finalized PlayerWeeklyScore used, if any. */
  statsAsOf: string | null
  /** ISO timestamp of newest projection row used, if any. */
  projectionsAsOf: string | null
  /** ISO timestamp of newest injury report used, if any. */
  injuriesAsOf: string | null
}

/** Resolved scoring summary (deterministic, league-specific). */
export interface RedraftScoringSettings {
  /** Sport config key, e.g. NFL / NCAAF. */
  sport: string
  /** PPR | HALF_PPR | STANDARD | CUSTOM (best-effort from settings.sportConfig). */
  scoringPreset: string
  /** Points per reception derived from preset/overrides (null when unknown). */
  pointsPerReception: number | null
  superflex: boolean
  tePremium: boolean
  idp: boolean
}

export interface RedraftLineupSlot {
  slotName: string
  allowedPositions: string[]
  starterCount: number
  isFlex: boolean
  isSuperflex: boolean
}

export interface RedraftRosterSettings {
  totalStarterSlots: number
  benchSlots: number
  irSlots: number
  lineupSlots: RedraftLineupSlot[]
  /** Required starters by base position (FLEX distributed fractionally). */
  requiredByPosition: Record<string, number>
}

export interface RedraftWaiverSettings {
  type: 'faab' | 'rolling' | 'reverse' | 'unknown'
  faabBudget: number | null
}

export interface RedraftPlayerFact {
  playerId: string
  playerName: string
  position: string
  team: string | null
  slotType: string
  isStarterSlot: boolean
  injuryStatus: string | null
  byeWeek: number | null
  /** Provider projection for `currentWeek` when available, else null. */
  weekProjection: number | null
  /** AllFantasy rest-of-season projection from current week through season end, else null. */
  restOfSeasonProjection?: number | null
  floorProjection?: number | null
  ceilingProjection?: number | null
  projectionConfidenceScore?: number | null
  projectionConfidenceLevel?: 'high' | 'medium' | 'low' | 'none' | null
  projectionSource?: string | null
  projectionReasons?: string[]
  /** Season-to-date average actual fantasy points (finalized weeks) when available, else null. */
  seasonAvgActual: number | null
  /** Average overall ADP (lower = more valued) from AllFantasyAdpSnapshot, when matched. Used as a
   * rest-of-season value/ranking proxy for redraft when projections/actuals are unavailable. */
  adp: number | null
  /** True when no projection, actual, or ADP/ranking signal exists for this player. */
  hasNoValueSignal: boolean
}

export interface RedraftTeamSummary {
  rosterId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  streak: string | null
  playoffSeed: number | null
  faabBalance: number | null
  waiverPriority: number
  isEliminated: boolean
  isUserTeam: boolean
  players: RedraftPlayerFact[]
}

export interface RedraftMatchupSummary {
  matchupId: string
  week: number
  status: string
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  homeProjected: number | null
  awayProjected: number | null
  isUserMatchup: boolean
  opponentRosterId: string | null
  /**
   * An odd-team league's extra matchup that week (lib/redraft/oddTeamExtraMatchupRules.ts): "Extra
   * matchup vs <team> (<reason>) · 112.4–98.0". For the leftover team `opponentRosterId` is the chosen
   * team, whose own game supplies its score.
   */
  extraMatchup?: string | null
}

/** The one canonical, serializable redraft War Room context object. */
export interface RedraftWarRoomContext {
  leagueId: string
  leagueType: 'redraft'
  sport: string
  season: number
  currentWeek: number
  totalWeeks: number
  playoffStartWeek: number
  seasonStatus: string
  scoring: RedraftScoringSettings
  roster: RedraftRosterSettings
  waivers: RedraftWaiverSettings
  /** The viewer's own roster id (null for commissioner viewing league-wide without a team). */
  userRosterId: string | null
  /** Viewer is league commissioner (may see league-wide). */
  isCommissioner: boolean
  teams: RedraftTeamSummary[]
  upcomingMatchup: RedraftMatchupSummary | null
  recentMatchup: RedraftMatchupSummary | null
  /** Free agents available to add. Empty + waiverPool:'missing' until a provider pool exists. */
  freeAgents: RedraftPlayerFact[]
  availability: RedraftDataAvailability
  freshness: RedraftFreshness
  /** Human-readable flags describing why data is degraded (surfaced to UI + AI). */
  missingDataFlags: string[]
  /** NFL provider foundation coverage; null for non-NFL redraft contexts. */
  nflDataCoverage?: CanonicalNflDataCoverage | null
  /** Which War Room features can run with the current data. */
  featureAvailability: {
    teamNeeds: boolean
    lineup: boolean
    waivers: boolean
    tradeAnalyze: boolean
    tradeFind: boolean
  }
}

export type RedraftWarRoomAction =
  | 'state'
  | 'waivers'
  | 'trade-analyze'
  | 'trade-find'
  | 'lineup'
  | 'ask'
