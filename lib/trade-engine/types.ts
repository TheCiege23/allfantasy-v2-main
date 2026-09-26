// lib/trade-engine/types.ts

export type Sport = 'nfl' | 'nba'

export type AssetType = 'PLAYER' | 'PICK' | 'FAAB'
export type PickProjected = 'early' | 'mid' | 'late' | 'unknown'
export type RosterSlot = 'Starter' | 'Bench' | 'IR' | 'Taxi'

// NEW (non-breaking)
export type SurplusGrade = 'core' | 'soft_surplus' | 'hard_surplus'

export type Asset = {
  id: string
  /** Provider player ID from the actual roster; distinct from the engine's name-based ID. */
  rosterPlayerId?: string
  type: AssetType
  value: number

  marketValue?: number
  impactValue?: number
  vorpValue?: number
  volatility?: number

  // PLAYER
  name?: string
  pos?: string
  team?: string
  slot?: RosterSlot
  isIdp?: boolean
  idpPos?: 'LB' | 'DL' | 'DB' | 'EDGE' | 'IDP'
  age?: number

  // PICK
  pickSeason?: number
  round?: 1 | 2 | 3 | 4
  projected?: PickProjected
  displayName?: string
  ownerRosterId?: number

  // FAAB
  faabAmount?: number

  // Derived
  isCornerstone?: boolean
  cornerstoneReason?: string

  // NEW (optional, non-breaking): allows UI/Chat to display core/surplus
  surplusGrade?: SurplusGrade
  surplusReason?: string

  // Futures
  futuresMultiplier?: number

  // Devy
  isDevy?: boolean
  draftProjectionScore?: number
  projectedDraftRound?: number
  breakoutAge?: number
  injurySeverityScore?: number
  volatilityScore?: number
  devyAdp?: number
  draftEligibleYear?: number

  // C2C (Merged Devy) asset subtype for trade economy
  c2cAssetType?: 'PRO_PLAYER' | 'COLLEGE_PLAYER' | 'ROOKIE_PICK' | 'COLLEGE_PICK' | 'FUTURE_ROOKIE_PICK' | 'FUTURE_COLLEGE_PICK' | 'PROMOTION_RIGHT' | 'STARTUP_PICK'

  // Tags
  tags?: string[]
}

export type LeagueContext = {
  leagueId?: string
  leagueName: string
  scoringType: 'PPR' | 'Half PPR' | 'Standard' | string
  numTeams: number
  isTEP: boolean
  tepBonus: number
  isSF: boolean
  rosterPositions: string[]
  starterSlots: number
  benchSlots: number
  taxiSlots: number

  scoringSettings?: Record<string, number>
  leagueVetoRatePct?: number
}

export type ManagerRoster = {
  rosterId: number
  userId: string
  username: string
  displayName: string
  avatar?: string
  record: string
  pointsFor: number
  players: Array<{
    id: string
    name: string
    pos: string
    team?: string
    slot: RosterSlot
    isIdp?: boolean
    age?: number
  }>
  faab?: number
  picks?: Array<{ season: string; displayName: string }>
}

export type ContenderTier = 'champion' | 'contender' | 'middle' | 'rebuild'
export type TradeAggression = 'low' | 'medium' | 'high'
export type RiskTolerance = 'low' | 'medium' | 'high'
export type ReputationTag = 'Shark' | 'Gambler' | 'Fair Dealer' | 'Taco'

export type ManagerProfile = {
  rosterId: number
  userId: string
  username?: string
  displayName: string
  avatar?: string
  record?: { wins: number; losses: number; ties?: number }
  pointsFor?: number

  // Status
  isChampion: boolean
  isTopTwo?: boolean
  standingsRank?: number
  contenderTier: ContenderTier
  starterStrengthIndex?: number

  // Needs/Surplus
  needs: string[]
  surplus: string[]

  // Trading behavior
  tradeAggression: TradeAggression
  riskTolerance?: RiskTolerance
  prefersYouth?: boolean
  prefersPicks?: boolean
  prefersConsolidation?: boolean
  reputationTag?: ReputationTag

  // Assets
  assets?: Asset[]
  faabRemaining?: number
}

export type Constraints = {
  maxAssetsPerSide: number
  baseFairnessMin: number
  baseFairnessMax: number

  // Cornerstone premiums
  cornerstonePremiumMin: number
  cornerstonePremiumMax: number

  // Parity
  championRetailMinPremium: number
  championRetailMaxPremium: number
  parityGuardrailEnabled?: boolean
  championPremiumMultiplier?: number
  topTeamPremiumMultiplier?: number
  maxStarterStrengthIncrease?: number

  // FAAB
  allowFaab: boolean
  faabMaxPercentOfTotal: number

  // Filler
  noFillerMinValue: number

  // Picks
  allowPicks?: boolean
  pickAsAnchorDisallowed?: boolean

  // Legacy
  banOneForOneCornerstoneForNon?: boolean
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxAssetsPerSide: 3,
  baseFairnessMin: 0.92,
  baseFairnessMax: 1.08,
  cornerstonePremiumMin: 1.10,
  cornerstonePremiumMax: 1.25,
  championRetailMinPremium: 1.08,
  championRetailMaxPremium: 1.20,
  parityGuardrailEnabled: true,
  championPremiumMultiplier: 1.12,
  topTeamPremiumMultiplier: 1.08,
  maxStarterStrengthIncrease: 1500,
  allowFaab: true,
  faabMaxPercentOfTotal: 0.15,
  noFillerMinValue: 1000,
  allowPicks: true,
  pickAsAnchorDisallowed: false,
  banOneForOneCornerstoneForNon: true,
}

export type AcceptanceLabel = 'Strong' | 'Aggressive' | 'Speculative' | 'Long Shot'
export type VetoLikelihood = 'Low' | 'Medium' | 'High'

export type TradeCandidate = {
  id: string
  offerId?: string
  fromRosterId: number
  toRosterId: number
  fromManagerName?: string
  toManagerName?: string

  give: Asset[]
  receive: Asset[]

  giveTotal: number
  receiveTotal: number
  valueRatio: number

  fairnessScore: number
  acceptanceLabel: AcceptanceLabel
  acceptanceRate?: string

  vetoLikelihood: VetoLikelihood

  // Flags
  cornerstoneRulesSatisfied?: boolean
  parityRulesSatisfied?: boolean
  parityFlags: string[]
  riskFlags: string[]

  explanation: {
    whyTheyAccept: string[]
    whyYouAccept: string[]
  }

  // AI assist (ON by default)
  ai: {
    targetWhy?: string[]
    messageTemplate?: string
    riskNarrative?: string[]
    timingNarrative?: string[]
    restructureHints?: string[]
  }

  // UI
  displayEmoji?: string
  priorityPill?: string
}

export type LeagueIntelSnapshot = {
  league: LeagueContext
  constraints: Constraints
  assetsByRosterId: Record<number, Asset[]>
  profilesByRosterId: Record<number, ManagerProfile>
  tradeBlockIndex: Set<string>
  idpConfig: {
    enabled: boolean
    startersRequired: number
    poolEstimate: number
    scoringWeight: number
  }
  pickFutures: {
    enabled: boolean
    daysToDraft: number
  }
}

// Legacy compatibility
export type LeagueSettings = LeagueContext & {
  sport?: Sport
  idpEnabled?: boolean
  idpScoringType?: 'tackle_heavy' | 'big_play' | 'balanced'
  idpStarterSlots?: number
  startingQB?: number
  startingRB?: number
  startingWR?: number
  startingTE?: number
  startingFlex?: number
  ppr?: number
}

export type ManagerTendencyData = {
  managerId: string
  managerName: string
  sampleSize: number
  starterPremium: number
  positionBias: {
    QB: number
    RB: number
    WR: number
    TE: number
    PICK: number
  }
  riskTolerance: number
  consolidationBias: number
  overpayThreshold: number
  fairnessTolerance: number
  computedAt: number
}

export type LeagueIntelligence = {
  settings?: LeagueSettings
  leagueSettings?: Partial<LeagueSettings>
  assetsByRosterId: Record<number, Asset[]>
  managerProfiles: Record<number, ManagerProfile>
  managerTendencies?: Record<number, ManagerTendencyData>
  pickProjections?: Record<string, PickProjected>
  thresholds?: Thresholds
  constraints?: Constraints
  leagueTradeFrequency?: 'low' | 'medium' | 'high'
  mostActiveTraders?: string[]
}

export type Thresholds = {
  QB_CORNERSTONE_SF: number
  QB_CORNERSTONE_1QB: number
  TE_CORNERSTONE_TEP: number
  TE_CORNERSTONE_STD: number
  SKILL_CORNERSTONE: number
  EARLY_1ST_CORNERSTONE: boolean
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  QB_CORNERSTONE_SF: 7500,
  QB_CORNERSTONE_1QB: 9500,
  TE_CORNERSTONE_TEP: 6500,
  TE_CORNERSTONE_STD: 8000,
  SKILL_CORNERSTONE: 9000,
  EARLY_1ST_CORNERSTONE: true,
}

export type TradeEngineOutput = {
  validTrades: TradeCandidate[]
  rejectedTrades: Array<{
    give: Asset[]
    receive: Asset[]
    reasons: string[]
  }>
  stats: {
    candidatesGenerated: number
    candidatesRejected: number
    candidatesValid: number
  }
}

export type HardRuleResult = {
  ok: boolean
  reasons: string[]
}

export type NegotiationTheme = 'NEED_FIT' | 'MARKET' | 'MANAGER_BIAS' | 'LINEUP_UPGRADE' | 'RISK_SWAP'
export type SweetenerType = 'PICK' | 'PLAYER' | 'FAAB'
export type SweetenerTarget = 'SMALL' | 'MEDIUM' | 'LARGE'

export type NegotiationToolkit = {
  acceptProb: number
  approximate?: boolean
  leverage: {
    theme: NegotiationTheme
    why: string
  }
  dmMessages: {
    opener: string
    rationale: string
    fallback: string
  }
  counters: Array<{
    id: string
    description: string
    adjust: {
      add?: Asset[]
      remove?: Asset[]
    }
    expected: {
      acceptProbDelta: number
      driverChanges: Array<{ driverId: string; delta: number }>
    }
  }>
  sweeteners: Array<{
    id: string
    type: SweetenerType
    target: SweetenerTarget
    suggestion: string
    expectedAcceptProbDelta: number
    reasoningDriverIds: string[]
  }>
  redLines: Array<{
    id: string
    rule: string
    because: string
    driverIds: string[]
  }>
}

export type DriverDirection = 'UP' | 'DOWN' | 'NEUTRAL'
export type DriverStrength = 'WEAK' | 'MEDIUM' | 'STRONG'

export type AcceptDriver = {
  id: string
  name: string
  emoji: string
  direction: DriverDirection
  strength: DriverStrength
  value: number
  evidence: {
    metric?: string
    raw?: number
    unit?: 'PPG' | 'PCT' | 'COUNT' | 'SCORE' | 'ROUND' | 'AGE'
    note?: string
  }
}
