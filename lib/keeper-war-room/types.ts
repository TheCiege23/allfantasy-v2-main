/**
 * KEEPER AF WAR ROOM — shared types & data-availability contract.
 *
 * CONTRACT (keeper is its OWN format — see docs/keeper-war-room-audit.md):
 * - `keeperWarRoomContext.ts` is the authoritative, deterministic, serializable context.
 *   Engines are pure functions over it; the AI layer explains, never invents.
 * - Keeper is single-season, but every keep/cut decision weighs DRAFT-CAPITAL cost
 *   (round penalty or auction price). The core signal is VALUE SURPLUS:
 *   ADP-implied draft round vs. the player's keeper COST round (or auction value).
 * - Keeper COST is real (`KeeperEligibility` / `KeeperRecord`) — never fabricated. When no
 *   cost data exists, cost is `missing` and recommendations degrade to a limited state.
 * - No dynasty future-pick capital (keeper disables future picks). No redraft logic that
 *   ignores keeper cost.
 * - NFL pools never mix with NCAAF pools (sport carried through).
 */

export type DataState = 'available' | 'stale' | 'missing'

export interface KeeperDataAvailability {
  scoringRules: DataState
  rosterRules: DataState
  standings: DataState
  schedule: DataState
  rosters: DataState
  playerValues: DataState
  keeperRules: DataState
  /** Per-player keeper COST (eligibility/record). 'missing' → surplus/keep-cut limited. */
  keeperCosts: DataState
  eligibility: DataState
  projections: DataState
  injuries: DataState
  news: DataState
  freeAgentPool: DataState
}

export interface KeeperFreshness {
  generatedAt: string
  statsAsOf: string | null
  projectionsAsOf: string | null
  injuriesAsOf: string | null
}

export interface KeeperScoringSettings {
  sport: string
  scoringPreset: string
  pointsPerReception: number | null
  superflex: boolean
  tePremium: boolean
}

export interface KeeperRosterSettings {
  totalStarterSlots: number
  benchSlots: number
  irSlots: number
  requiredByPosition: Record<string, number>
}

export type KeeperCostSystem = 'round_based' | 'auction_value' | 'inflation' | 'free' | 'unknown'

export interface KeeperPolicy {
  maxKeepers: number
  maxYears: number
  costSystem: KeeperCostSystem
  roundPenalty: number
  auctionPctIncrease: number
  waiverAllowed: boolean
  selectionDeadline: string | null
  keeperPhaseActive: boolean
  draftRounds: number
}

export interface KeeperPlayerFact {
  playerId: string
  playerName: string
  position: string
  team: string | null
  /** roster slot category: starter | bench | ir | free_agent */
  slotType: string
  isStarterSlot: boolean
  /** True when this player is already declared/marked as a keeper. */
  isKept: boolean
  injuryStatus: string | null
  /** Average overall ADP (lower = more valued), when matched. */
  adp: number | null
  /** ADP-implied draft round = ceil(adp / teamCount); null when no ADP. */
  adpRound: number | null
  /** Keeper eligibility (null when not computed). */
  isEligible: boolean | null
  ineligibleReason: string | null
  yearsKept: number | null
  /** Keeper COST as a draft round (round/inflation systems); null when n/a or missing. */
  keeperCostRound: number | null
  /** Keeper COST as an auction value (auction system); null when n/a or missing. */
  keeperCostAuction: number | null
  /** Human-readable cost label ("Round 7", "$42", "Free"); null when missing. */
  keeperCostLabel: string | null
  /**
   * VALUE SURPLUS in rounds (round/inflation): adpRound − keeperCostRound. Positive = the
   * player is worth a higher pick than they cost to keep (good keeper). null when either
   * side is missing. For auction systems this is a value/100 proxy in `surplusAuction`.
   */
  surplusRounds: number | null
  surplusAuction: number | null
  weekProjection: number | null
  seasonAvgActual: number | null
}

export interface KeeperTeamSummary {
  rosterId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  isEliminated: boolean
  isUserTeam: boolean
  players: KeeperPlayerFact[]
}

/** The one canonical, serializable keeper War Room context object. */
export interface KeeperWarRoomContext {
  leagueId: string
  leagueType: 'keeper'
  sport: string
  season: number
  teamCount: number
  currentWeek: number
  totalWeeks: number
  seasonStatus: string
  /** True when the season is actively being played (start/sit + waivers relevant). */
  seasonActive: boolean
  scoring: KeeperScoringSettings
  roster: KeeperRosterSettings
  keeper: KeeperPolicy
  userRosterId: string | null
  isCommissioner: boolean
  teams: KeeperTeamSummary[]
  freeAgents: KeeperPlayerFact[]
  availability: KeeperDataAvailability
  freshness: KeeperFreshness
  missingDataFlags: string[]
  featureAvailability: {
    keeperRecommendations: boolean
    cutList: boolean
    rosterNeeds: boolean
    draftPlan: boolean
    tradeAnalyze: boolean
    tradeFind: boolean
    waivers: boolean
    lineup: boolean
  }
}

