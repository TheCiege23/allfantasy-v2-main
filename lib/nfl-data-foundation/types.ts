export type CanonicalNflDataState = 'available' | 'stale' | 'missing'

export type CanonicalNflProviderIds = {
  allFantasyId: string
  providerPlayerId: string | null
  rollingInsightsId: string | null
  sleeperId: string | null
  fantasyCalcId: string | null
}

export type CanonicalNflPlayerStats = {
  playerId: string
  season: number
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  source: string | null
  fetchedAt: string | null
  stale: boolean
}

export type CanonicalNflProjection = {
  playerId: string
  providerPlayerId: string | null
  playerName: string
  position: string | null
  team: string | null
  week: number
  season: number
  projectedPoints: number | null
  floor: number | null
  ceiling: number | null
  restOfSeason: number | null
  /**
   * The two inputs the blended number was built from, labeled by origin: the provider's
   * weekly projection (fantasy_projections) and the AF engine's weekly number
   * (af_projection_snapshots). Null means that side genuinely had no row — never a 0.
   */
  providerWeeklyProjection?: number | null
  afWeeklyProjection?: number | null
  confidence: number
  confidenceLevel: 'high' | 'medium' | 'low' | 'none'
  unavailable: boolean
  reasonCodes: string[]
  dataSources: string[]
  staleDataWarnings: string[]
  projectionSource: string
  generatedAt: string
  expiresAt: string | null
}

export type CanonicalNflPlayer = {
  playerId: string
  playerName: string
  normalizedName: string
  position: string | null
  team: string | null
  teamId: string | null
  jerseyNumber: number | null
  status: string | null
  injuryStatus: string | null
  headshotUrl: string | null
  byeWeek: number | null
  opponent: string | null
  depthChartRank: number | null
  depthChartRole: string | null
  providerIds: CanonicalNflProviderIds
  seasonStats: CanonicalNflPlayerStats | null
  projection: CanonicalNflProjection | null
  adp: number | null
  tradeValue: number | null
  dataSources: string[]
  staleDataWarnings: string[]
}

export type CanonicalNflRosterPlayer = CanonicalNflPlayer & {
  rosterId: string
  slotType: string | null
  isLocked: boolean
  lineupWarnings: string[]
}

export type CanonicalNflDraftPoolPlayer = CanonicalNflPlayer & {
  adp: number | null
  aiAdp: number | null
  draftRank: number | null
  available: boolean
}

export type CanonicalNflWaiverPlayer = CanonicalNflPlayer & {
  rostered: false
  faabRecommendation: number | null
  addConfidence: number
  dropCandidatePlayerId: string | null
}

export type CanonicalNflTradeAsset = {
  assetType: 'player' | 'draft_pick'
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  side?: 'A' | 'B' | null
}

export type CanonicalNflTradeContext = {
  assets: Array<
    CanonicalNflTradeAsset & {
      canonicalPlayer: CanonicalNflPlayer | null
      weeklyProjectionDelta: number | null
      restOfSeasonProjection: number | null
      fantasyCalcValue: number | null
      injuryRisk: 'low' | 'medium' | 'high' | 'unknown'
      starterImpact: number | null
      benchImpact: number | null
    }
  >
  dataSources: string[]
  missingDataWarnings: string[]
}

export type CanonicalNflAiPlayerFact = {
  playerId: string
  playerName: string
  position: string | null
  team: string | null
  injuryStatus: string | null
  byeWeek: number | null
  projectedPoints: number | null
  restOfSeason: number | null
  confidence: number
  projectionSource: string | null
  tradeValue: number | null
  depthChartRole: string | null
  dataSources: string[]
  staleDataWarnings: string[]
}

export type CanonicalNflDataCoverage = {
  sport: 'NFL'
  season: number
  week: number | null
  hasPlayers: boolean
  hasTeams: boolean
  hasSchedule: boolean
  hasDepthCharts: boolean
  hasSeasonStats: boolean
  hasInjuries: boolean
  hasWeeklyProjections: boolean
  hasRosProjections: boolean
  hasTradeValues: boolean
  missingFields: string[]
  staleFields: string[]
  lastFetchedAt: Record<string, string | null>
  counts: Record<string, number>
  generatedAt: string
}

export type CanonicalNflAiContext = {
  leagueId: string
  rosterId: string | null
  week: number
  purpose: 'draft' | 'waivers' | 'trade' | 'lineup' | 'matchup' | 'commissioner' | 'general'
  players: CanonicalNflAiPlayerFact[]
  waiverOptions: CanonicalNflAiPlayerFact[]
  rosterNeeds: string[]
  coverage: CanonicalNflDataCoverage
  dataWarnings: string[]
  promptRules: string[]
}
