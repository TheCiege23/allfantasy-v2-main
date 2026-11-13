type ScoringFormat = 'PPR' | 'Half PPR' | 'Standard' | string

export type TeamPhase = 'contender' | 'competitor' | 'middle' | 'rebuild' | 'unknown'

export type ArchetypeId =
  | 'shark'
  | 'gambler'
  | 'fair_dealer'
  | 'hoarder'
  | 'rebuilder'
  | 'win_now'
  | 'passive'
  | 'unknown'

export interface EngineLeagueContext {
  leagueId: string
  leagueName: string
  sport: 'nfl'
  season: number
  numTeams: number

  scoring: {
    format: ScoringFormat
    ppr: number
    tepBonus: number
    isTEP: boolean
    isSF: boolean
    ppCarry: number
    passBonus6pt: boolean
    scoringSettings: Record<string, number>
  }

  roster: {
    positions: string[]
    starterSlots: number
    benchSlots: number
    taxiSlots: number
    irSlots: number
    idpEnabled: boolean
    idpStarterSlots: number
  }

  meta: {
    vetoRatePct: number
    tradeDeadlinePassed: boolean
    isOffseason: boolean
    weekNumber: number
  }
}

export type InjuryStatus = 'healthy' | 'questionable' | 'doubtful' | 'out' | 'ir' | 'pup' | 'unknown'
export type DepthRole = 'starter' | 'backup' | 'third_string' | 'unknown'

export interface EnginePlayerState {
  id: string
  name: string
  position: string
  team: string | null
  age: number | null
  experience: number | null

  injury: {
    status: InjuryStatus
    bodyPart: string | null
    severity: number
    gamesOut: number
  }

  usage: {
    snapPct: number | null
    targetShare: number | null
    rushShare: number | null
    role: DepthRole
  }

  value: {
    market: number
    vorp: number
    replacement: number
  }

  isDevy: boolean
  league: 'NFL' | 'NCAA' | null
  devyMeta: {
    draftProjectionScore: number | null
    projectedDraftRound: number | null
    breakoutAge: number | null
    recruitingScore: number | null
    draftEligibleYear: number | null
  } | null
}

type EngineAssetType = 'player' | 'pick' | 'faab'

export interface EngineAsset {
  id: string
  type: EngineAssetType
  value: number
  displayName: string

  player: EnginePlayerState | null

  pick: {
    round: number
    year: number
    projected: 'early' | 'mid' | 'late' | 'unknown'
    originalOwner: string | null
    classStrength: number | null
  } | null

  faab: {
    amount: number
    budgetPct: number
  } | null

  tags: string[]
}

export interface EngineManagerProfile {
  rosterId: number
  userId: string
  username: string
  displayName: string

  phase: TeamPhase
  archetype: ArchetypeId

  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  standingsRank: number

  needs: string[]
  surplus: string[]

  behavior: {
    tradeAggression: 'low' | 'medium' | 'high'
    riskTolerance: 'low' | 'medium' | 'high'
    prefersYouth: boolean
    prefersPicks: boolean
    prefersConsolidation: boolean
    avgTradesPerSeason: number
  }

  assets: EngineAsset[]
  faabRemaining: number
}

export interface EngineContext {
  league: EngineLeagueContext
  managers: Record<number, EngineManagerProfile>
  timestamp: number
}

export interface EngineOutput<T = any> {
  data: T
  capabilities: EngineCapabilities
  confidence: ConfidenceState
  meta: {
    computedAt: number
    engineVersion: string
    computeTimeMs: number
  }
}

export type ConfidenceState = 'HIGH' | 'MODERATE' | 'LEARNING' | 'INSUFFICIENT'

export interface EngineCapabilities {
  scoring: boolean
  scarcity: boolean
  contenderClassifier: boolean
  managerArchetypes: boolean
  liquidity: boolean
  acceptanceModel: boolean
  simulation: boolean
  portfolioProjection: boolean
  counterBuilder: boolean
  devyIntelligence: boolean
}

export const ENGINE_VERSION = '1.0.0'
