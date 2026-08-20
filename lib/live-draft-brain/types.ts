import type { DraftBrainSportId } from './sport-universe'

/** Commissioner + product draft formats (not Prisma enum — logical labels). */
export type DraftFormatKind =
  | 'SNAKE'
  | 'LINEAR'
  | 'AUCTION'
  | 'SALARY_CAP'
  | 'KEEPER'
  | 'DYNASTY_STARTUP'
  | 'ROOKIE'
  | 'SUPPLEMENTAL'
  | 'DISPERSAL'
  | 'DEVY'
  | 'C2C'
  | 'IDP'
  | 'BEST_BALL'
  | 'TOURNAMENT'
  | 'GUILLOTINE'
  | 'CUSTOM'

export type LiveDraftAssistantMode =
  | 'bpa'
  | 'needs'
  | 'balanced'
  | 'upside'
  | 'safe'
  | 'win_now'
  | 'future_value'
  | 'positional_run_defense'
  | 'trade_up'
  | 'trade_down'
  | 'zero_rb'
  | 'hero_rb'
  | 'stars_and_scrubs'
  | 'balanced_build'

export type WaitOrTake = 'take_now' | 'safe_to_wait' | 'unlikely_to_return'

export interface PickScoreBreakdown {
  pickScore: number
  adpValueScore: number
  teamNeedScore: number
  tierCliffScore: number
  positionalScarcityScore: number
  rosterConstructionScore: number
  formatFitScore: number
  projectionValueScore: number
  ceilingScore: number
  floorScore: number
  newsImpactScore: number
  correlationScore: number
  reachScore: number
  valueFallScore: number
  replacementDropoffScore: number
  draftRiskScore: number
  buildCoherenceScore: number
  futureFlexibilityScore: number
}

export interface RankedPickCandidate {
  playerName: string
  position: string
  team?: string | null
  pickScore: number
  breakdown: PickScoreBreakdown
  pickReasons: string[]
  riskNotes: string[]
  waitOrTakeNow: WaitOrTake
}

export interface BoardTierSummary {
  tierLabel: string
  playersRemainingInTier: number
  nextTierDropRisk: 'low' | 'medium' | 'high'
  notes: string[]
}

export interface LiveDraftBrainContext {
  sport: DraftBrainSportId
  draftFormat: DraftFormatKind
  scoringFormatId?: string
  leagueType?: 'redraft' | 'keeper' | 'dynasty' | 'best_ball' | 'other'
  isSuperflex?: boolean
  isTePremium?: boolean
  isIdp?: boolean
  rosterSize?: number
  startupVsRookie?: 'startup' | 'rookie' | 'supplemental' | 'dispersal' | 'na'
  round: number
  pick: number
  totalTeams: number
  overallPick: number
}

/** Metadata for filtering external/site rows to comparable draft contexts only. */
export interface AdpSourceMeta {
  sport: string
  formatKey?: string
  matchesContext: boolean
}

/**
 * Inputs for Combined AI ADP: E×0.55 + S×0.35 + context×0.10 (default weights).
 * Set `matchesContext: false` on a source to exclude it from the blend.
 */
export interface CombinedAdpInputs {
  externalAdp: number | null
  siteAdp: number | null
  /** Third term (ADP-scale overall pick #). Omitted → derived from context + player when possible. */
  contextAdjustmentAdp?: number
  /** @deprecated use contextAdjustmentAdp */
  formatAdjustment?: number

  brainContext?: LiveDraftBrainContext
  playerMeta?: {
    position: string
    isRookie?: boolean
    age?: number | null
  }
  externalSource?: AdpSourceMeta
  siteSource?: AdpSourceMeta & { sampleSize?: number; coverageConfidence?: number }
  trendDeltaSlots?: number | null
  siteTrendMomentum?: number
  scarcitySurge?: number
  auctionInflationScore?: number
}

export interface ManagerTendencyHint {
  managerId: string
  displayName?: string
  /** 0–1 weights: value vs upside vs youth */
  valueLean?: number
  upsideLean?: number
  youthLean?: number
}

export interface LiveDraftBrainTeamState {
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null; playerName?: string }>
  rosterSlots: string[]
  /** Optional projections keyed by player key */
  projectionByKey?: Record<string, number>
  ceilingByKey?: Record<string, number>
  floorByKey?: Record<string, number>
}

export interface LiveDraftBrainPoolPlayer {
  name: string
  position: string
  team?: string | null
  adp?: number | null
  byeWeek?: number | null
  isRookie?: boolean
  /** When known (dynasty / rookie drafts) */
  age?: number | null
  /** Real projected fantasy points from the pool row, when present (Draft VORP slice). */
  projectedPoints?: number | null
}

export interface LiveDraftBrainInput {
  context: LiveDraftBrainContext
  mode: LiveDraftAssistantMode
  available: LiveDraftBrainPoolPlayer[]
  myTeam: LiveDraftBrainTeamState
  combinedAdpByPlayerKey?: Record<string, CombinedAdpInputs>
  /** Site + external blended (optional shortcut) */
  blendedAdpByKey?: Record<string, number>
  aiAdpByKey?: Record<string, number>
  byeByKey?: Record<string, number>
  isDynasty?: boolean
  /** Recent picks overall draft order (for runs / prediction) */
  recentPicks?: Array<{ playerName: string; position: string; teamId: string; overallPick: number }>
  /** Per-team roster snapshots for next-pick prediction */
  teamRostersByTeamId?: Record<string, LiveDraftBrainTeamState['teamRoster']>
  managerHintsByTeamId?: Record<string, ManagerTendencyHint>
  /** Auction: budgets */
  auctionBudgetByTeamId?: Record<string, number>
  /** Ordered list of team ids for next picks (handles traded picks) */
  upcomingTeamOrder?: string[]
}
