/** Client-side roster row for optimizer API + UI enrichment */
export interface LineupRosterPlayer {
  id: string
  name: string
  positions: string[]
  projectedPoints: number
  team?: string
  opponent?: string
  gameTime?: string
  injuryStatus?: string
  trend?: 'up' | 'down' | 'flat'
  isVeteran?: boolean
  isRookie?: boolean
  ceilingProjection?: number
  floorProjection?: number
}

export interface MatchupHeaderModel {
  teamName: string
  teamLogoUrl?: string
  opponentName: string
  opponentLogoUrl?: string
  record: string
  rank: number
  weekLabel: string
  projectedScore: number
  winProbability: number
  tag: 'Favorite' | 'Underdog' | 'Close Matchup'
  strategyLabel: 'Play Safe' | 'Chase Upside' | 'Balanced Approach'
}

export type PlayerCardVariant = 'strong' | 'neutral' | 'risk' | 'inactive'

export interface DecisionEngineJson {
  lineupMode: string
  teamContext: {
    record: string
    rank: number
    projectedWinProbability: number
    teamDirection: string
    strategyRecommendation: string
  }
  optimizedLineup: Array<{
    slot: string
    playerName: string
    position: string
    team: string
    weeklyStartScore: number
    startConfidence: number
    ceilingScore: number
    floorScore: number
    volatilityScore: number
    reason: string[]
    usedPreferenceTieBreaker: boolean
  }>
  benchDecisions: Array<{
    playerName: string
    position: string
    benchReason: string[]
    swapPriority: number
  }>
  startSitCalls: Array<{
    slot: string
    startPlayer: string
    sitPlayer: string
    edgeType: string
    confidence: number
    explanation: string
  }>
  autoSubRules: {
    enabled: boolean
    injuryOnly: boolean
    eligibleStatuses: string[]
    notes: string[]
  }
  autoSubPreview: Array<{
    ifStarterStatus: string
    starterToReplace: string
    replacementPlayer: string
    replacementReason: string
    usedPreferenceTieBreaker: boolean
    slotCode: string
    confidence: number
    samePositionReplacement: boolean
  }>
  autoSubBlocked: Array<{
    starterName: string
    slotCode: string
    status: string
    reason: string
  }>
  preferenceProfileSummary: {
    activeTraits: string[]
    preferenceConfidence: number
    notes: string[]
  }
  alerts: string[]
}

export interface OptimizeApiResponse {
  ok?: boolean
  result?: {
    sport: string
    totalProjectedPoints: number
    starters: Array<{
      slotId: string
      slotCode: string
      slotLabel: string
      playerId: string
      playerName: string
      playerTeam?: string
      projectedPoints: number
      selectedPosition: string
    }>
    bench: Array<{
      playerId: string
      playerName: string
      projectedPoints: number
      positions: string[]
    }>
    unfilledSlots: Array<{ slotId: string; slotCode: string; slotLabel: string }>
    deterministicNotes: string[]
  }
  decisionEngine?: DecisionEngineJson | null
  decisionExplanation?: {
    summary: string
    bullets: string[]
    source: 'ai' | 'deterministic'
  } | null
}

