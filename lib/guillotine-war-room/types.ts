/**
 * GUILLOTINE AF WAR ROOM — shared types & data-availability contract.
 *
 * CONTRACT (guillotine is its OWN format — see docs/guillotine-war-room-audit.md):
 * - `guillotineWarRoomContext.ts` is the authoritative, deterministic, serializable context.
 *   Engines are pure functions over it; the AI layer explains, never invents.
 * - SURVIVAL-FIRST: each scoring period the lowest team(s) are CHOPPED (eliminated). Every
 *   recommendation prioritizes NOT finishing last — safe floor + projected safety margin
 *   over ceiling. Conserve FAAB unless survival risk is high; eliminated-team drops can
 *   change waiver strategy.
 * - Never invent eliminated teams, scores, the elimination line, FAAB budgets, projections,
 *   or the dropped-player pool. Missing → flagged. Trades only when league rules allow.
 * - NFL pools never mix with NCAAF pools (sport carried through).
 */

export type DataState = 'available' | 'stale' | 'missing'

export interface GuillotineDataAvailability {
  config: DataState
  rosters: DataState
  /** Per-period scores (GuillotinePeriodScore). Drives standings + survival margin. */
  periodScores: DataState
  /** Danger tiers / elimination line. */
  eliminationLine: DataState
  rosterStates: DataState
  playerValues: DataState
  projections: DataState
  injuries: DataState
  news: DataState
  faab: DataState
  droppedPlayerPool: DataState
}

export interface GuillotineFreshness {
  generatedAt: string
  scoresAsOf: string | null
  injuriesAsOf: string | null
}

export interface GuillotineScoringSettings {
  sport: string
  scoringPreset: string
}

export interface GuillotineRosterSettings {
  totalStarterSlots: number
  benchSlots: number
  requiredByPosition: Record<string, number>
}

export interface GuillotineSettings {
  eliminationStartWeek: number
  eliminationEndWeek: number | null
  teamsPerChop: number
  dangerMarginPoints: number
  tiebreaker: string
  rosterReleaseTiming: string
  /** True when trades are permitted (guillotine usually disables them). */
  tradesEnabled: boolean
}

export type DangerTier = 'chop_zone' | 'danger' | 'safe' | 'unknown'

export interface GuillotineStandingRow {
  rosterId: string
  ownerName: string
  teamName: string | null
  isUserTeam: boolean
  eliminated: boolean
  choppedInPeriod: number | null
  /** Survival rank among ACTIVE teams (1 = safest by cumulative points); null when eliminated. */
  rank: number | null
  seasonPointsCumul: number
  periodPoints: number | null
  tier: DangerTier
  /** Points above the current chop zone (negative = below the line / in the chop zone). */
  pointsFromChopZone: number | null
}

export interface GuillotinePlayerFact {
  playerId: string
  playerName: string
  position: string
  team: string | null
  slotType: string
  isStarterSlot: boolean
  injuryStatus: string | null
  adp: number | null
  /** Current-period projection (floor/ceiling proxy for survival). */
  weekProjection: number | null
  seasonAvgActual: number | null
  hasNoValueSignal: boolean
}

export interface GuillotineDroppedPlayer {
  playerId: string
  playerName: string
  position: string
  team: string | null
  fromEliminatedRosterId: string | null
  availableAt: string | null
  adp: number | null
}

export interface GuillotineTeamSummary {
  rosterId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  isUserTeam: boolean
  eliminated: boolean
  faabRemaining: number | null
  players: GuillotinePlayerFact[]
}

/** The one canonical, serializable guillotine War Room context object. */
export interface GuillotineWarRoomContext {
  leagueId: string
  leagueType: 'guillotine'
  sport: string
  season: number
  currentWeek: number
  scoring: GuillotineScoringSettings
  roster: GuillotineRosterSettings
  guillotine: GuillotineSettings
  userRosterId: string | null
  isCommissioner: boolean
  /** Survival standings (active + eliminated), ranked safest-first among active. */
  standings: GuillotineStandingRow[]
  activeTeamCount: number
  eliminatedTeamCount: number
  teams: GuillotineTeamSummary[]
  droppedPlayers: GuillotineDroppedPlayer[]
  availability: GuillotineDataAvailability
  freshness: GuillotineFreshness
  missingDataFlags: string[]
  /** A best ball Guilly league: lineups set themselves (lib/guillotine/guillotineBestBall.ts). Optional for older fixtures. */
  bestBallLineups?: boolean
  featureAvailability: {
    survivalRisk: boolean
    rosterRisk: boolean
    lineupSafety: boolean
    waivers: boolean
    faabPlan: boolean
    droppedPlayers: boolean
    tradeAnalyze: boolean
    weeklyPlan: boolean
  }
}

export type GuillotineWarRoomAction =
  | 'survival-risk'
  | 'roster-risk'
  | 'lineup-safety'
  | 'waivers'
  | 'faab-plan'
  | 'dropped-players'
  | 'trade-analyze'
  | 'weekly-plan'
  | 'ask'
