/**
 * Shared types for AI opponent managers (deterministic core + optional LLM overlay).
 */

export type BotThinkSpeed = "instant" | "fast" | "normal" | "realistic"

export type AggressionLevel = "off" | "low" | "medium" | "high"

export type PersonalityPoolMode = "balanced" | "random" | "commissioner_assigned"

export type TeamStrategyMode = "contend" | "neutral" | "rebuild"

/** Persisted in `league.settings.aiOpponents` — off by default everywhere. */
export type AiOpponentsLeagueSettings = {
  enabled?: boolean
  fillEmptyWithAi?: boolean
  takeoverInactive?: boolean
  mockDraftsOnly?: boolean
  allowFullAiLeagues?: boolean
  defaultThinkSpeed?: BotThinkSpeed
  personalityPool?: PersonalityPoolMode
  tradeActivity?: AggressionLevel
  waiverActivity?: AggressionLevel
}

export type BotArchetypeId =
  | "balanced_builder"
  | "win_now_grinder"
  | "rookie_hunter"
  | "zero_rb_sharp"
  | "hero_rb_drafter"
  | "qb_early_drafter"
  | "te_premium_exploiter"
  | "chaos_gambler"
  | "devy_hoarder"
  | "pick_collector"
  | "aging_vet_buyer"
  | "risk_averse_floor"

export type StrategicTendencies = {
  /** -1 = sell future, +1 = buy future */
  winNowVsFuture: number
  /** 0–1 */
  riskTolerance: number
  tradeAggression: number
  waiverAggression: number
  rookieAppetite: number
  /** TE / SF leverage */
  positionalPremiumBias: Partial<Record<"QB" | "TE" | "RB" | "WR" | "FL", number>>
  /** Draft: tendency to skip RB early */
  zeroRbWeight: number
  /** Draft: anchor RB early */
  heroRbWeight: number
  qbEarlyWeight: number
  tePremiumWeight: number
  chaosReach: number
  devyWeight: number
  pickHoarding: number
  vetBuyerWeight: number
  floorVsUpside: number
  bluffTendency: number
}

export type BotProfile = {
  botId: string
  displayName: string
  avatarUrl: string | null
  archetypeId: BotArchetypeId
  description: string
  tendencies: StrategicTendencies
  /** Rough activity multiplier for automation frequency (0.5–1.5) */
  activityLevel: number
}

export type DraftFormatHint =
  | "snake"
  | "linear"
  | "rookie"
  | "supplemental"
  | "dispersal"
  | "startup_dynasty"
  | "unknown"

export type DraftPlayerOption = {
  playerId: string
  name: string
  position: string
  team: string | null
  adp: number | null
  tier: number | null
  isRookie?: boolean
  age?: number | null
  /** When set, must match `DraftDecisionContext.leagueSport` for scoring (wrong-sport guard). */
  sport?: string | null
}

export type DraftDecisionContext = {
  leagueId: string
  teamId: string
  bot: BotProfile
  format: DraftFormatHint
  scoring: string | null
  isSuperflex: boolean
  isTePremium: boolean
  isDynasty: boolean
  isDevy: boolean
  round: number
  pickInRound: number
  overallPick: number
  rosterCounts: Record<string, number>
  /** Queued player ids (first = top priority) */
  queue: string[]
  available: DraftPlayerOption[]
  /** Picks this team still owns (dynasty) */
  futurePickCapital?: number
  /** From bot memory — do-not-draft list */
  avoidPlayerIds?: string[]
  /** NPC / commissioner-assigned draft persona — AllFantasy live draft autopick */
  npcDraftPersonality?: import('@/lib/live-draft-engine/npcDraftPersonalityTypes').NpcDraftPersonalityId | null
  npcFavoriteTeamAbbr?: string | null
  leagueSport?: string | null
  /** Normalized NFL-like team abbreviations already rostered (skill positions) for stack personality */
  rosteredSkillTeams?: string[]
}

export type DraftPickDecision = {
  playerId: string
  reason: string
  confidence: number
  /** Optional LLM / persona line */
  publicLine?: string
}

export type WaiverClaimCandidate = {
  playerId: string
  name: string
  position: string
  faabSuggested: number
  upside: number
  floor: number
  needBonus: number
}

export type WaiverDecision = {
  orderedClaims: Array<{ playerId: string; faabBid: number; reason: string }>
  publicLine?: string
}

export type LineupPlayer = {
  playerId: string
  name: string
  position: string
  slotEligible: string[]
  projectedPoints: number
  injuryStatus?: string | null
  isBye?: boolean
}

export type LineupSlotRequirement = { slotId: string; positions: string[] }

export type LineupDecision = {
  startersBySlot: Record<string, string>
  benchPlayerIds: string[]
  reason: string
  publicLine?: string
}

export type TradeAsset = {
  kind: "player" | "pick"
  id: string
  name?: string
  value: number
}

export type TradeEvaluationContext = {
  leagueId: string
  teamId: string
  bot: BotProfile
  strategyMode: TeamStrategyMode
  incomingGive: TradeAsset[]
  incomingReceive: TradeAsset[]
}

export type TradeResponseDecision = {
  decision: "accept" | "reject" | "counter"
  confidence: number
  reasoning: string
  counterGive?: TradeAsset[]
  counterReceive?: TradeAsset[]
  publicLine?: string
}

export type TradeProposalDecision = {
  shouldPropose: boolean
  targetTeamId?: string
  give?: TradeAsset[]
  receive?: TradeAsset[]
  reasoning?: string
}
