import type { LeagueSport } from '@prisma/client'
import type { SupportedSport } from '@/lib/sport-scope'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import type { AiTimeContextPayload } from '@/lib/time-engine/types'
import type { UnpricedReason } from '@/lib/trade-value/unpricedReason'
import type { LeagueValueAdjustment } from '@/lib/trade-value/leagueTradeValue'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

export type TradeSportFilter = 'ALL' | SupportedSport

export type TradeStrategyMode =
  | 'contender'
  | 'rebuilder'
  | 'win_now'
  | 'long_term'
  | 'neutral'

export type TeamContextMode = 'my_team' | 'team_a' | 'team_b' | 'neutral'

export type TradeAssetInput =
  | { kind: 'player'; playerId?: string; name?: string; sportHint?: string }
  | {
      kind: 'pick'
      year: number
      round: number
      tier?: 'early' | 'mid' | 'late'
      label?: string
    }
  | { kind: 'faab'; amount: number }

export type TradeConsoleAnalyzeInput = {
  sportFilter: TradeSportFilter
  leagueId?: string | null
  userId: string | null
  leagueSize?: number
  tePremium?: boolean
  isSuperFlex?: boolean
  waiverBudget?: number
  strategy: TradeStrategyMode
  teamContext: TeamContextMode
  analysisTab: string
  sideGive: TradeAssetInput[]
  sideGet: TradeAssetInput[]
  skipAi?: boolean
  /** When true, multisport trades are allowed (rare league modes). */
  allowMultisportFairness?: boolean
  /** League team `externalId` — opponent roster for lineup / rebalance context. */
  opponentTeamExternalId?: string | null
}

export type TradeConsoleLeagueSnapshot = {
  id: string
  name: string
  sport: LeagueSport
  leagueSize: number | null
  isDynasty: boolean
  leagueType: string | null
  scoring: string | null
  isSuperFlexHint: boolean
  tePremiumHint: boolean
  waiverBudget: number | null
  taxiSlots: number | null
  leagueVariant: string | null
  bestBallMode: boolean | null
  settings: Record<string, unknown> | null
  quickModeBadges: string[]
}

export type TradeConsoleRosterSummary = {
  lineupSimulation: boolean
  yourRosterPlayers: number
  theirRosterPlayers: number
  opponentTeams: Array<{
    externalId: string
    teamName: string
    ownerName: string
    platformUserId: string | null
  }>
}

export type TradeConsolePlayerLine = {
  name: string
  playerId: string | null
  /**
   * The SLEEPER provider id, when this player could be resolved to one — the key the trade
   * ENRICHMENT tables are written under.
   *
   * 🛑 A SECOND FIELD RATHER THAN A BETTER `playerId`, BECAUSE THEY ARE DIFFERENT ID SPACES AND
   * MIXING THEM IS THE BUG THIS EXISTS TO FIX. Measured on production 2026-09-08, resolving one
   * player four ways and asking `resolveTradeEnrichment` which key it can read:
   *
   *     SportsPlayerRecord.id   NFL:NFL:puka-nacua:WR:LAR   <- what `playerId` carries   nothing
   *     SportsPlayer.id         bde7f6cf-...                                             nothing
   *     canonicalPlayerId       bf213084-...                                             nothing
   *     providerIds.sleeper     9493                                                     adp 2.8
   *
   * `PlayerValueSnapshot.sleeperId` is 9493 for the same player, so the market table keys the same
   * way. `playerId` stays the slug id every existing consumer already reads (`sportsDataReady`, the
   * client); this carries the one the enrichment port can actually use.
   *
   * ⚠ NULL IS A REAL ANSWER AND MUST STAY VISIBLE. A hand-typed name that does not resolve, or one
   * that resolves ambiguously across the 178 NFL duplicate-name groups, gets null here — priced by
   * name exactly as before, and counted in `playerAssets` but not `playerAssetsWithId`, so the
   * resolution rate stays measured rather than assumed.
   */
  enrichmentPlayerId?: string | null
  sport: string
  position: string
  team: string
  headshotUrl: string | null
  logoUrl: string | null
  injuryStatus: string | null
  dataSource: string
  composite: number
  marketValue: number
  /**
   * Where the price came from. `idp_league` means this league's own IDP scoring and
   * starting slots priced the player — no market prices defenders, so collapsing it
   * into 'unknown' would report a value we can fully explain as one we cannot.
   */
  pricedSource: 'fantasycalc' | 'idp_league' | 'sports_db' | 'faab' | 'pick' | 'unknown'
  /**
   * True when the engine found NO value, and `marketValue` is only its placeholder 0.
   *
   * 🛑 THE ZERO REACHED THE SCREEN. `pricePlayer` marks this case `unpriced` and warns that every
   * surface must check it first; this line type dropped the flag, so the Trade Center printed "0"
   * for a team defense after Analyze — the one rendering this app forbids for an unpriced asset.
   * `marketValue` keeps its number so the engine's own maths is unchanged; the flag is what a
   * surface reads.
   */
  unpriced?: boolean
  /** Why, when `unpriced`; see `lib/trade-value/unpricedReason.ts`. */
  unpricedReason?: UnpricedReason | null
  /**
   * `marketValue` after THIS league's scoring and the viewer's roster need — the number the verdict
   * is graded on (Guap, 2026-09-24). Null when the line is unpriced. See `lib/trade-value/leagueTradeValue.ts`.
   */
  leagueValue?: number | null
  /** Each factor that moved `marketValue` to `leagueValue`, with its reason. Empty when nothing did. */
  valueAdjustments?: LeagueValueAdjustment[]
  /** From `resolveNormalizedPlayerSportsProfiles` + league scoring stack. */
  effectiveProjection?: number | null
  projectionNotes?: string[]
  injuryNewsSummary?: string | null
  weatherSummary?: string | null
  weatherRiskLevel?: string | null
  trendHint?: string | null
  rollingFppg?: number | null
}

/** Opponent roster pieces not in the current "get" side — potential counter/ask targets. */
export type TradeConsoleOpponentRosterTarget = {
  id: string
  name: string
  position: string | null
  marketValue: number
}

/** Deterministic, data-grounded summary for UI + Chimmy (no invented stats). */
export type TradeConsoleValidation = {
  leagueContextResolved: boolean
  scoringAppliedToProjections: boolean
  rosterContextAvailable: boolean
  projectionLayerReady: boolean
  injuryNewsLayerReady: boolean
}

/** Provider-health flags for UI chips — mirrors other AI tools. */
export type TradeConsoleSourceFlags = {
  /** FantasyCalc valuations available (NFL only — always false for other sports). */
  fantasyCalcReady: boolean
  /** `sports_players` rows resolved for all assets (no unresolved lookups). */
  sportsDataReady: boolean
  /** Projection engine layer attached to at least one line. */
  projectionLayerReady: boolean
  /** Injury / news signal attached to at least one line. */
  injuryNewsLayerReady: boolean
  /** League scoring rules applied via normalized league context. */
  leagueScoringApplied: boolean
  /** AI time + league envelope attached to chimmyPayload. */
  aiEnvelopeReady: boolean
}

export type TradeIntelligence = {
  fairnessVerdict: string
  confidenceScore: number
  whoWinsNow: 'you' | 'opponent' | 'even'
  whoWinsLongTerm: 'you' | 'opponent' | 'even'
  contenderRecommendation: string
  rebuilderRecommendation: string
  tradeWarnings: string[]
  rebalanceSuggestions: string[]
  alternateTargetsNote: string
  /** Opponent roster pieces not in the deal — for counter offers (real market values). */
  alternateTargets: Array<{ name: string; marketValue: number; position: string | null }>
  /** Single narrative tying fairness, projections, roster lens, and strategy. */
  why: string
  /** League-scored projected fantasy points summed per side when DB projections exist. */
  projectedImpact: {
    giveTotal: number | null
    getTotal: number | null
    net: number | null
    summary: string
  }
  leagueReasoning: string
  teamReasoning: string
  leagueHistoryNote: string | null
  /** Populated when warehouse / LeagueSeason / waiver tables have rows for this league */
  syncedDataHighlights?: string[]
}

export type TradeConsoleAnalyzeResult = {
  ok: true
  /** `league` = roster + scoring from a league row; `global` = sport/asset analysis without league. */
  analysisMode: 'league' | 'global'
  effectiveSport: SupportedSport | 'MIXED'
  analysisScope: 'league' | 'general' | 'browse_only'
  league: TradeConsoleLeagueSnapshot | null
  labels: {
    fairnessLabel: string
    sideAdvantage: 'even' | 'you' | 'opponent' | 'mixed'
    confidenceLabel: string
  }
  fairnessScore: number
  confidenceScore: number
  percentDiff: number
  giveTotal: number
  getTotal: number
  giveMarket: number
  getMarket: number
  /**
   * What `giveTotal`/`getTotal` and the grade are priced in. Always present on a success, so a grade
   * never appears without the rules behind it.
   */
  valueBasis: {
    /** 'league' when league rules or roster need moved any value; 'market' when grading on the chart alone. */
    graded: 'league' | 'market'
    /** The chart, in words: "Dynasty · Superflex · 12 teams · Half PPR · TE premium +0.5". */
    label: string
    scoringAdjusted: boolean
    needAdjusted: boolean
    /** Why roster need could not be priced, when it could not. Null when it ran or was not attempted. */
    needGap: string | null
  }
  /**
   * THE grade for this deal — letter, label and recommendation — from the one grader every trade
   * surface uses (`lib/decision-os/trade/leagueTradeGrader.ts`). The Trade Center reads its letters from
   * here, so a deal shows the same letter here as on its pending-offer card and in Chimmy.
   */
  grade: TradeGradeView
  degraded: boolean
  dataGaps: string[]
  dataSources: string[]
  lastUpdated: string | null
  players: { give: TradeConsolePlayerLine[]; get: TradeConsolePlayerLine[] }
  rosterSummary: TradeConsoleRosterSummary
  secondary: {
    rawValue: { give: number; get: number; deltaPct: number }
    teamFit: { grade: string; note: string }
    risk: { grade: string; note: string }
    scheduleImpact: { note: string }
    injuryImpact: { note: string }
    scoringContext: { note: string }
    projectionImpact: {
      giveTotal: number | null
      getTotal: number | null
      net: number | null
      summary: string
    }
    shortTermOutlook: { note: string }
    longTermOutlook: { note: string }
    positionalScarcity: { note: string }
    leagueImpact: { note: string }
    contenderScore: number
    rebuilderScore: number
  }
  drivers: Record<string, unknown>
  evaluation: { bullets: string[]; sensitivity: string }
  negotiationToolkit: Record<string, unknown> | null
  /** Present when league opponent roster was loaded; not part of the trade's receive side. */
  opponentRosterTargets?: TradeConsoleOpponentRosterTarget[]
  tradeIntelligence: TradeIntelligence
  chimmyPayload: Record<string, unknown>
  /** Time engine + lock hints (same as other AI tools). */
  timeContext?: AiTimeContextPayload | null
  validation: TradeConsoleValidation
  sourceFlags: TradeConsoleSourceFlags
  /** One-line grounded summary for UI and downstream tools. */
  summaryLine: string
  dataQuality: 'full' | 'partial' | 'degraded'
  /**
   * League trade-window context — real values from `NormalizedTradeSettings` + matchup period.
   * Null fields indicate the rule is unknown for this league (no deadline configured, etc.).
   */
  tradeWindow: {
    currentPeriod: number | null
    tradeDeadlineWeek: number | null
    weeksUntilDeadline: number | null
    pastDeadline: boolean
    tradeReviewHours: number | null
    draftPickTrading: boolean | null
    note: string
  } | null
}

export type TradeConsoleAnalyzeError = {
  ok: false
  error: string
  code?: 'CROSS_SPORT' | 'VALIDATION' | 'EMPTY' | 'PLAYER_NOT_FOUND' | LeagueToolAccessErrorCode
  userMessage?: string
  /** Names that could not be resolved to DB rows — populated when `code === 'PLAYER_NOT_FOUND'`. */
  unresolvedAssets?: string[]
}

export type TradeConsoleAnalyzeOutput = TradeConsoleAnalyzeResult | TradeConsoleAnalyzeError
