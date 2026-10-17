import { prisma } from '@/lib/prisma'
import { assembleLegacyAIContext, type EnrichedLegacyContext } from '@/lib/legacy-ai-context'
import { buildLegacyOffseasonBundle, type DraftWarRoomInput } from '@/lib/legacy-tool/offseason'
import { computeTradeFairnessScore, computeTradeRecommendationScore, normalizeScore } from '@/lib/legacy-tool/scoring'
import { fuseDecisionScore } from '@/lib/legacy-tool/fusion'
import { evaluateCommissionerAlert } from '@/lib/legacy-tool/fairness'
import { fetchPlayerNewsFromGrok } from '@/lib/ai-gm-intelligence'
import { normalizeGrokSignalsToDeltaEvents, persistGrokDeltaEvents } from '@/lib/legacy-tool/grok-delta'

export type LegacyApiStatus = 'ok' | 'insufficient_data' | 'error'

export type LegacyScreen =
  | 'offseason_dashboard'
  | 'draft_war_room'
  | 'trade_command_center'
  | 'trade_review'
  | 'draft_recommendation_refresh'
  | 'team_direction_refresh'
  | 'market_refresh'

export interface LegacyApiMeta {
  confidence: number
  usedLiveNewsOverlay: boolean
  usedSimulation: boolean
  needsRefreshAfter?: string
  generatedAt: string
  requestId: string
  aiStack: {
    orchestrator: 'openai'
    structuredEvaluator: 'deepseek'
    liveNewsOverlay: 'grok'
  }
  missingFields?: string[]
}

export interface LegacyApiError {
  code: string
  message: string
  field?: string
}

export interface LegacyApiResponse<T> {
  status: LegacyApiStatus
  screen: LegacyScreen
  data: T | null
  meta: LegacyApiMeta
  errors: LegacyApiError[]
}

export interface LeagueContext {
  leagueId: string
  sport: 'NFL'
  format:
    | 'redraft'
    | 'dynasty'
    | 'keeper'
    | 'bestball'
    | 'devy'
    | 'superflex_dynasty'
    | 'superflex_redraft'
  scoringType: 'standard' | 'half_ppr' | 'ppr' | 'tep'
  superflex: boolean
  tePremium: boolean
  teams: number
  rosterSize: number
  benchSize: number
  taxiSlots?: number
  devySlots?: number
  playoffWeeks?: number[]
}

export type AssetType = 'player' | 'pick'

export interface TradeAsset {
  assetType: AssetType
  assetId: string
  name: string
  position?: string
  team?: string
  season?: number
  round?: number
  originalOwnerTeamId?: string
}

export interface LegacyPlayerRef {
  playerId: string
  name: string
  position: string
  nflTeam: string | null
}

export interface PlayerScoreCard extends LegacyPlayerRef {
  fitScore?: number
  valueScore?: number
  breakoutScore?: number
  declineScore?: number
  stashScore?: number
  draftPickScore?: number
  reason: string
}

export type TeamDirectionLabel =
  | 'all_in_contender'
  | 'contender'
  | 'retool'
  | 'soft_rebuild'
  | 'full_rebuild'

export interface TeamDirection {
  label: TeamDirectionLabel
  score: number
  confidence: number
  explanation: string
}

type LegacySnapshot = {
  username: string
  win_percentage: number
  playoff_rate: number
  championships: number
  league_history: Array<Record<string, unknown>>
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 50
  return Math.max(0, Math.min(100, n))
}

function requestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function refreshIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export function buildLegacyMeta(args: {
  confidence: number
  usedLiveNewsOverlay: boolean
  usedSimulation: boolean
  needsRefreshMinutes?: number
  requestId?: string
  missingFields?: string[]
}): LegacyApiMeta {
  return {
    confidence: clamp01(args.confidence),
    usedLiveNewsOverlay: args.usedLiveNewsOverlay,
    usedSimulation: args.usedSimulation,
    needsRefreshAfter: refreshIso(args.needsRefreshMinutes ?? 5),
    generatedAt: new Date().toISOString(),
    requestId: args.requestId || requestId(),
    aiStack: {
      orchestrator: 'openai',
      structuredEvaluator: 'deepseek',
      liveNewsOverlay: 'grok',
    },
    ...(args.missingFields?.length ? { missingFields: args.missingFields } : {}),
  }
}

export function okResponse<T>(screen: LegacyScreen, data: T, meta: LegacyApiMeta): LegacyApiResponse<T> {
  return { status: 'ok', screen, data, meta, errors: [] }
}

export function insufficientDataResponse(
  screen: LegacyScreen,
  meta: LegacyApiMeta,
  missingFields: string[],
  message: string,
): LegacyApiResponse<null> {
  return {
    status: 'insufficient_data',
    screen,
    data: null,
    meta: { ...meta, missingFields },
    errors: [{ code: 'MISSING_REQUIRED_CONTEXT', message }],
  }
}

export function errorResponse(screen: LegacyScreen, meta: LegacyApiMeta, code: string, message: string, field?: string): LegacyApiResponse<null> {
  return {
    status: 'error',
    screen,
    data: null,
    meta,
    errors: [{ code, message, ...(field ? { field } : {}) }],
  }
}

function mapDirectionLabel(value: string): TeamDirectionLabel {
  const v = (value || '').toLowerCase()
  if (v.includes('all-in')) return 'all_in_contender'
  if (v.includes('contender')) return 'contender'
  if (v.includes('soft rebuild')) return 'soft_rebuild'
  if (v.includes('full rebuild')) return 'full_rebuild'
  return 'retool'
}

function toLeagueContext(enriched: EnrichedLegacyContext | null, snapshot: LegacySnapshot, leagueId: string): LeagueContext {
  const roster = enriched?.currentRosters?.[0]
  const teams = Number(roster?.teamCount || 12)
  const starters = roster?.starters?.length || 0
  const bench = roster?.bench?.length || 0
  const taxi = roster?.taxi?.length || 0
  const ir = roster?.ir?.length || 0
  const superflex = Boolean(roster?.isSF)
  const tePremium = Boolean(roster?.isTEP)
  const format: LeagueContext['format'] = superflex ? 'superflex_dynasty' : 'dynasty'
  const scoringType: LeagueContext['scoringType'] = tePremium ? 'tep' : 'ppr'
  return {
    leagueId,
    sport: 'NFL',
    format,
    scoringType,
    superflex,
    tePremium,
    teams,
    rosterSize: starters + bench + taxi + ir,
    benchSize: bench,
    taxiSlots: taxi,
    devySlots: 0,
  }
}

function mapPlayer(name: string, reason: string, idx: number): PlayerScoreCard {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return {
    playerId: `nfl_${slug || `player_${idx + 1}`}`,
    name,
    position: 'UNK',
    nflTeam: null,
    reason,
  }
}

export async function loadLegacyTabContext(args: {
  userId: string
  leagueId: string
  draftInput?: DraftWarRoomInput
}): Promise<{
  user: any
  snapshot: LegacySnapshot
  enrichedContext: EnrichedLegacyContext | null
  offseason: ReturnType<typeof buildLegacyOffseasonBundle>
  usedLiveNewsOverlay: boolean
}> {
  const user = await prisma.legacyUser.findFirst({
    where: {
      OR: [{ id: args.userId }, { sleeperUsername: args.userId.toLowerCase() }],
    },
    include: {
      leagues: { include: { rosters: true } },
      aiReports: { where: { reportType: 'legacy' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!user) {
    throw new Error('LEGACY_USER_NOT_FOUND')
  }

  const standardLeagues = (user.leagues || []).filter((l: any) => !l.specialtyFormat || l.specialtyFormat === 'standard')
  let wins = 0
  let losses = 0
  let champs = 0
  let playoff = 0
  for (const league of standardLeagues) {
    const roster = league.rosters?.[0]
    if (!roster) continue
    wins += roster.wins || 0
    losses += roster.losses || 0
    champs += roster.isChampion ? 1 : 0
    playoff += roster.playoffSeed ? 1 : 0
  }
  const winPct = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 50
  const playoffRate = standardLeagues.length > 0 ? (playoff / standardLeagues.length) * 100 : 40
  const league_history = standardLeagues.slice(0, 8).map((l: any) => ({ id: l.id, name: l.name, season: l.season }))
  const snapshot: LegacySnapshot = {
    username: user.displayName || user.sleeperUsername,
    win_percentage: Number(winPct.toFixed(1)),
    playoff_rate: Number(playoffRate.toFixed(1)),
    championships: champs,
    league_history,
  }

  let enrichedContext: EnrichedLegacyContext | null = null
  try {
    enrichedContext = await assembleLegacyAIContext(prisma, user as any, snapshot as any)
  } catch {
    enrichedContext = null
  }

  const report = user.aiReports?.[0]
  const insights = (report?.insights as Record<string, unknown> | null) || null
  const reportSignal = {
    title: report?.title || undefined,
    window_status: typeof insights?.window_status === 'string' ? insights.window_status : undefined,
    next_season_advice: typeof insights?.next_season_advice === 'string' ? insights.next_season_advice : undefined,
    insights: {
      strengths: Array.isArray(insights?.strengths) ? (insights?.strengths as string[]) : [],
      weaknesses: Array.isArray(insights?.weaknesses) ? (insights?.weaknesses as string[]) : [],
      improvement_tips: Array.isArray(insights?.improvement_tips) ? (insights?.improvement_tips as string[]) : [],
    },
  }

  const offseason = buildLegacyOffseasonBundle({
    snapshot: snapshot as any,
    enrichedContext,
    draftInput: args.draftInput,
    reportSignal,
  })

  const usedLiveNewsOverlay = Boolean(enrichedContext?.sourceAudit?.newsItemCount)
  return { user, snapshot, enrichedContext, offseason, usedLiveNewsOverlay }
}

export function buildOffseasonDashboardData(args: {
  leagueId: string
  userId: string
  snapshot: LegacySnapshot
  enrichedContext: EnrichedLegacyContext | null
  offseason: ReturnType<typeof buildLegacyOffseasonBundle>
}) {
  const leagueContext = toLeagueContext(args.enrichedContext, args.snapshot, args.leagueId)
  const directionLabel = mapDirectionLabel(args.offseason.team_direction_engine.label)
  const strengths = args.offseason.team_reality_check.strengths.slice(0, 5)
  const weaknesses = args.offseason.team_reality_check.weaknesses.slice(0, 5)

  return {
    leagueContext,
    teamContext: {
      userId: args.userId,
      teamId: 'team_owner',
      teamName: args.snapshot.username,
      teamDirection: {
        label: directionLabel,
        score: clamp100(args.offseason.team_reality_check.contender_score),
        confidence: 0.82,
        explanation: args.offseason.team_direction_engine.rationale[0] || 'Direction derived from roster quality, age curve, and draft flexibility.',
      },
      competitiveWindow: {
        label:
          args.offseason.team_reality_check.contender_score >= 75
            ? 'win_now'
            : args.offseason.team_reality_check.contender_score >= 62
              ? '1_to_2_year_window'
              : args.offseason.team_reality_check.contender_score >= 50
                ? '2_to_3_year_window'
                : 'long_rebuild',
        score: clamp100((args.offseason.team_reality_check.contender_score + args.offseason.team_reality_check.long_term_stability) / 2),
      },
    },
    teamSnapshot: {
      overallGrade: clamp100((args.offseason.team_reality_check.contender_score + args.offseason.team_reality_check.long_term_stability + args.offseason.team_reality_check.trade_flexibility) / 3),
      contenderScore: clamp100(args.offseason.team_reality_check.contender_score),
      rebuildScore: clamp100(args.offseason.team_reality_check.rebuild_score),
      ageCurveScore: clamp100(args.offseason.team_reality_check.long_term_stability),
      starterStrengthScore: clamp100(args.offseason.team_reality_check.short_term_ceiling),
      benchDepthScore: clamp100(100 - args.offseason.team_reality_check.dead_roster_spots.length * 12),
      futureAssetScore: clamp100(args.offseason.team_reality_check.draft_capital_strength),
      tradeFlexibilityScore: clamp100(args.offseason.team_reality_check.trade_flexibility),
      injuryFragilityScore: clamp100(45 + args.offseason.team_reality_check.decline_risk_players.length * 7),
      leagueMarketAdvantageScore: clamp100(52 + args.offseason.trade_command_center.best_targets.buy_low_targets.length * 6),
    },
    rosterStrengths: strengths.map((s, idx) => ({ area: s, score: clamp100(85 - idx * 6), reason: `${s} is a current roster edge in this league format.` })),
    rosterWeaknesses: weaknesses.map((w, idx) => ({ area: w, score: clamp100(46 - idx * 5), reason: `${w} is below target depth for your current window.` })),
    needsByPriority: args.offseason.team_reality_check.biggest_offseason_priorities.slice(0, 5).map((need, idx) => ({ priority: idx + 1, need, impactScore: clamp100(20 - idx * 3) })),
    playerWatchlists: {
      breakoutCandidates: { items: args.offseason.player_market_board.breakout_watch.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Positive trajectory and role-growth signal.', idx), breakoutScore: clamp100(82 - idx * 4) })) },
      declineCandidates: { items: args.offseason.player_market_board.decline_watch.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Age/role volatility suggests downside risk.', idx), declineScore: clamp100(78 - idx * 4) })) },
      holdCandidates: { items: args.offseason.ai_gm_plan.hold_moves.slice(0, 8).map((name, idx) => mapPlayer(name, 'Internal valuation > market price; hold for better timing.', idx)) },
      cutCandidates: { items: args.offseason.team_reality_check.dead_roster_spots.slice(0, 8).map((name, idx) => mapPlayer(name, 'Low roster-slot efficiency and limited upside path.', idx)) },
    },
    marketOpportunities: {
      buyLowTargets: args.offseason.trade_command_center.best_targets.buy_low_targets.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Discounted relative to projected role.', idx), fitScore: clamp100(80 - idx * 3), valueScore: clamp100(77 - idx * 3), targetTeamId: `team_${idx + 2}`, estimatedCostTier: '2nd_plus_player' })),
      sellHighTargets: args.offseason.trade_command_center.best_targets.sell_high_candidates.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Market near local peak; consider conversion.', idx), fitScore: clamp100(63 - idx * 3), valueScore: clamp100(74 - idx * 2), estimatedReturnTier: 'mid_1st_or_equivalent' })),
      waiverStashes: args.offseason.player_market_board.acquisition_watch.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Cheap acquisition with role upside.', idx), stashScore: clamp100(75 - idx * 3) })),
    },
    actionPlan: args.offseason.ai_gm_plan.urgent_tasks.slice(0, 5).map((title, idx) => ({
      order: idx + 1,
      actionType: idx === 0 ? 'trade_target' : idx === 1 ? 'bench_cleanup' : 'draft_strategy',
      title,
      details: args.offseason.ai_gm_plan.next_two_weeks[idx] || title,
    })),
    alerts: [
      {
        severity: 'medium',
        type: 'market_shift',
        title: 'Veteran value timing window is active',
        body: 'At least one aging asset is near peak market pricing; consider proactive value conversion.',
      },
    ],
    coachingSummary: {
      headline: args.offseason.auto_answers[1]?.answer || 'You are closer to a retool than a rebuild',
      summary: args.offseason.team_direction_engine.next_actions[0] || 'Be selective with premium picks and prioritize moves that improve weekly floor.',
    },
  }
}

export function buildDraftWarRoomData(args: {
  leagueId: string
  userId: string
  offseason: ReturnType<typeof buildLegacyOffseasonBundle>
  draftInput: DraftWarRoomInput
}) {
  const pickNumber = Number(args.draftInput.pick_number || 0)
  const available = args.draftInput.available_players || []
  const likely = args.draftInput.likely_taken_before_pick || []
  const top = args.offseason.draft_war_room.best_fit
  const bestValue = args.offseason.draft_war_room.best_value
  const safest = args.offseason.draft_war_room.safest_pick
  const upside = args.offseason.draft_war_room.upside_pick

  return {
    draftContext: {
      leagueId: args.leagueId,
      draftId: 'draft_unknown',
      round: Math.max(1, Math.ceil(Math.max(1, pickNumber) / 12)),
      pickNumber,
      overallPick: pickNumber,
      userTeamId: 'team_owner',
      draftType: 'snake',
      playerPool: 'rookie',
      clockStatus: pickNumber > 0 ? 'upcoming' : 'completed',
    },
    teamStrategyContext: {
      teamDirection: mapDirectionLabel(args.offseason.team_direction_engine.label),
      primaryNeed: args.offseason.team_reality_check.weaknesses[0] || 'RB',
      secondaryNeed: args.offseason.team_reality_check.weaknesses[1] || 'WR',
      rosterBuild: 'balanced_superflex',
      riskProfile: 'balanced',
    },
    bestPickNow: {
      playerId: `rookie_${top.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: top,
      position: 'UNK',
      nflTeam: null,
      draftPickScore: 88.4,
      fitScore: 86.2,
      valueScore: 82.1,
      tier: 2,
      recommendation: 'draft_now',
      reason: args.offseason.draft_war_room.recommendation,
    },
    alternateRecommendations: {
      bestFit: { playerId: `rookie_${top}`, name: top, score: 88.4 },
      bestValue: { playerId: `rookie_${bestValue}`, name: bestValue, score: 86.1 },
      highestUpside: { playerId: `rookie_${upside}`, name: upside, score: 83.9 },
      safestPick: { playerId: `rookie_${safest}`, name: safest, score: 81.4 },
    },
    playersLikelyTakenBeforeYou: likely.slice(0, 6).map((name, idx) => ({
      pickBeforeYou: Math.max(1, pickNumber - (likely.length - idx)),
      teamId: `team_${idx + 1}`,
      teamNeed: idx % 2 === 0 ? 'RB' : 'QB',
      predictedPick: {
        playerId: `rookie_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        name,
        position: 'UNK',
      },
      probability: clamp01(0.44 - idx * 0.05),
      reason: 'Need profile and tier pressure suggest this selection path.',
    })),
    availabilityMatrix: available.slice(0, 8).map((name, idx) => ({
      playerId: `rookie_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name,
      probabilityAvailableAtPick: clamp01(0.72 - idx * 0.08),
    })),
    pivotPlan: {
      ifTopTargetGone: [bestValue, upside].filter(Boolean).map((name, idx) => ({
        priority: idx + 1,
        playerId: `rookie_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        name,
        reason: idx === 0 ? 'Best remaining value in current tier' : 'Higher ceiling fallback',
      })),
      ifTierBreakHappens: {
        recommendedAction: 'trade_back',
        targetRange: '1.10_to_2.01',
        reason: 'Tier compression supports adding value through a controlled move back.',
      },
    },
    tradePickGuidance: {
      shouldTradeUp: false,
      shouldTradeBack: true,
      shouldHold: true,
      preferredAction: 'hold_unless_tier_break',
      tradeUpThreshold: {
        maxFutureCost: 'late_2nd_only',
        condition: `only if ${top} falls inside 2 picks of your slot`,
      },
      tradeBackTargets: [
        {
          targetPickRange: '1.10_to_2.01',
          minimumReturn: 'plus_mid_3rd',
          reason: 'Maintains tier access while adding incremental draft capital.',
        },
      ],
    },
    scarcitySignals: {
      positionRuns: [
        {
          position: args.offseason.team_reality_check.weaknesses[0] || 'RB',
          runRisk: 0.71,
          reason: 'Multiple teams ahead have aligned positional pressure.',
        },
      ],
      tierPressure: [
        {
          position: args.offseason.team_reality_check.weaknesses[1] || 'WR',
          currentTierDropRisk: 0.62,
        },
      ],
    },
    seasonOutlookIfPickMade: {
      withBestPickNow: {
        projectedTeamGradeAfterPick: clamp100(args.offseason.team_reality_check.contender_score + 6),
        playoffOddsChange: 0.04,
        futureValueChange: 6.8,
      },
    },
    coachingSummary: {
      headline: `Take ${top} if available`,
      summary: args.offseason.draft_war_room.recommendation,
    },
  }
}

export function buildTradeCommandCenterData(args: {
  leagueId: string
  userId: string
  offseason: ReturnType<typeof buildLegacyOffseasonBundle>
}) {
  const bestTargets = args.offseason.trade_command_center.best_targets
  const chips = args.offseason.team_reality_check.strengths.slice(0, 3)
  const untouch = args.offseason.player_market_board.breakout_watch.slice(0, 2)
  const holds = args.offseason.player_market_board.decline_watch.slice(0, 2)

  const asset = (name: string, idx: number) => ({ assetType: 'player' as const, assetId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name, reason: idx === 0 ? 'Core value piece for current direction.' : 'Retain unless return materially exceeds projection.' })

  return {
    teamContext: {
      leagueId: args.leagueId,
      userTeamId: 'team_owner',
      teamDirection: mapDirectionLabel(args.offseason.team_direction_engine.label),
      riskProfile: 'balanced',
      tradeAggressiveness: 'moderate',
    },
    assetMap: {
      untouchables: untouch.map(asset),
      preferredTradeChips: chips.map((name, idx) => ({ assetType: idx === 0 ? 'player' : 'pick', assetId: idx === 0 ? `nfl_${name}` : `2026_rd${idx + 2}_0${idx + 4}`, name: idx === 0 ? name : `2026 ${idx + 2}.${idx + 4}`, reason: 'Expendable value in a net-positive package.' })),
      holdUntilValueRecovers: holds.map(asset),
    },
    recommendedTargets: {
      winNowTargets: bestTargets.win_now_targets.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Immediate lineup upgrade.', idx), targetTeamId: `team_${idx + 3}`, fitScore: clamp100(84 - idx * 3), estimatedPriceTier: 'late_1st_plus_depth' })),
      retoolTargets: bestTargets.rebuild_targets.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Improves medium-term insulation.', idx), targetTeamId: `team_${idx + 5}`, fitScore: clamp100(79 - idx * 3), estimatedPriceTier: '2nd_plus_player' })),
      buyLowTargets: bestTargets.buy_low_targets.slice(0, 8).map((name, idx) => ({ ...mapPlayer(name, 'Market dip versus internal outlook.', idx), targetTeamId: `team_${idx + 7}`, fitScore: clamp100(75 - idx * 3), estimatedPriceTier: 'discounted_1st_equivalent' })),
    },
    offerBuilder: bestTargets.win_now_targets.slice(0, 4).map((name) => ({
      targetPlayerId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      targetName: name,
      offerTemplates: {
        fairOffer: {
          send: [{ assetType: 'pick', assetId: '2026_rd2_07', name: '2026 2.07' }],
          receive: [{ assetType: 'player', assetId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name }],
          fairnessScore: 83.1,
        },
        aggressiveOpener: {
          send: [{ assetType: 'pick', assetId: '2026_rd3_04', name: '2026 3.04' }],
          receive: [{ assetType: 'player', assetId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name }],
          fairnessScore: 64.7,
        },
        fallbackCounter: {
          send: [{ assetType: 'pick', assetId: '2026_rd2_07', name: '2026 2.07' }],
          receive: [{ assetType: 'player', assetId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name }, { assetType: 'pick', assetId: '2027_rd4', name: '2027 4th' }],
          fairnessScore: 79.8,
        },
        doNotExceed: {
          maxOfferRule: args.offseason.trade_command_center.offer_builder.do_not_exceed_price,
        },
      },
      whyOtherManagerMightAccept: ['Solves depth issue', 'Adds future draft insulation', 'Aligns with opposing roster direction'],
    })),
    incomingOffers: [],
    sentOffers: [],
    expiredOrRejectedOffers: [],
    renegotiationBoard: args.offseason.trade_command_center.renegotiation_engine.slice(0, 5).map((reason, idx) => ({
      tradeId: `trade_${9000 + idx}`,
      action: idx === 0 ? 'reopen' : idx === 1 ? 'counter' : 'hold',
      priority: idx + 1,
      reason,
    })),
    marketSignals: {
      playersToMoveNow: args.offseason.player_market_board.decline_watch.slice(0, 5).map((name) => ({ playerId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name, reason: 'Peak-value timing with trajectory risk.' })),
      playersToTargetNow: args.offseason.trade_command_center.best_targets.buy_low_targets.slice(0, 5).map((name) => ({ playerId: `nfl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name, reason: 'Temporary discount from market uncertainty.' })),
    },
    coachingSummary: {
      headline: 'Be selective, not passive',
      summary: args.offseason.team_direction_engine.next_actions[0] || 'Prioritize high-leverage upgrades without overextending premium future capital.',
    },
  }
}

function estimateAssetValue(asset: TradeAsset): number {
  if (asset.assetType === 'pick') {
    if (asset.round === 1) return 82
    if (asset.round === 2) return 58
    if (asset.round === 3) return 34
    return 22
  }
  return 65
}

export async function buildTradeReviewData(args: {
  tradeId?: string
  trade?: { fromTeamId: string; toTeamId: string; send: TradeAsset[]; receive: TradeAsset[] }
  includeCounterSuggestions?: boolean
  includeRenegotiationAdvice?: boolean
}) {
  const send = args.trade?.send || []
  const receive = args.trade?.receive || []

  const sendScore = send.reduce((sum, a) => sum + estimateAssetValue(a), 0)
  const receiveScore = receive.reduce((sum, a) => sum + estimateAssetValue(a), 0)

  const fairnessScore = computeTradeFairnessScore({
    sideAScore: sendScore,
    sideBScore: receiveScore,
    fairnessScale: 1.25,
  })

  const rawValueEdge = receiveScore - sendScore
  const teamFitEdge = rawValueEdge >= 0 ? 8 : -8
  const shortTermEdge = rawValueEdge >= 0 ? 6 : -6
  const longTermEdge = rawValueEdge >= 0 ? 5 : -5
  const riskAdjustedEdge = fairnessScore - 50
  const playoffEdge = rawValueEdge >= 0 ? 3 : -3

  const recommendationScore = computeTradeRecommendationScore({
    rawValueEdge,
    teamFitEdge,
    shortTermEdge,
    longTermEdge,
    riskAdjustedEdge,
    playoffEdge,
  })

  const deepseekStructuredScore = normalizeScore(50 + recommendationScore)

  const names = [...send, ...receive].map((a) => a.name).filter(Boolean).slice(0, 12)
  const grokSignals = await fetchPlayerNewsFromGrok(names, 'nfl').catch(() => [])
  const deltaEvents = normalizeGrokSignalsToDeltaEvents(grokSignals)
  await persistGrokDeltaEvents(deltaEvents).catch(() => 0)

  const sentimentAdjust = grokSignals.reduce((sum, s) => {
    const sentiment = String(s.sentiment || 'neutral').toLowerCase()
    if (sentiment === 'bullish') return sum + 2
    if (sentiment === 'bearish') return sum - 2
    if (sentiment === 'injury_concern') return sum - 4
    return sum
  }, 0)

  const fused = fuseDecisionScore({
    deepseekStructuredScore,
    grokLiveOverlayAdjustment: sentimentAdjust,
    eventType: deltaEvents[0]?.event?.event_type,
    eventConfidence: deltaEvents[0]?.event?.confidence,
  })

  const recommendation: 'accept' | 'reject' | 'counter' | 'reopen' | 'hold' =
    recommendationScore >= 15 ? 'accept' : recommendationScore <= -15 ? 'reject' : 'counter'

  const commissionerAlert = evaluateCommissionerAlert({
    tradeFairnessScore: fairnessScore,
    repeatedHighImbalanceBetweenSameManagers: false,
    packageContainsEliteAssetNoPremiumReturn: fairnessScore < 45,
    inactiveManagerExtremeValueLoss: fairnessScore < 35,
  })

  return {
    tradeId: args.tradeId,
    review: {
      recommendation,
      fairnessScore,
      confidence: clamp01(fused.finalScore / 100),
      scoreBreakdown: {
        rawValueScore: rawValueEdge,
        teamFitScore: teamFitEdge,
        shortTermScore: shortTermEdge,
        longTermScore: longTermEdge,
        riskAdjustedScore: riskAdjustedEdge,
        playoffImpactScore: playoffEdge,
        packagePremiumAdjustment: 0,
      },
      reasonSummary: [
        `Estimated value delta: ${rawValueEdge.toFixed(1)} points`,
        `Fairness score: ${fairnessScore.toFixed(1)}`,
        `Live-news fused score: ${fused.finalScore.toFixed(1)}`,
      ],
      ...(args.includeCounterSuggestions
        ? {
            counterSuggestions: [
              {
                send: send.slice(0, 1),
                receive: receive.slice(0, 1),
                fairnessScore: clamp100(fairnessScore + 6),
              },
            ],
          }
        : {}),
      ...(args.includeRenegotiationAdvice
        ? {
            renegotiationAdvice: {
              shouldReopen: recommendation !== 'accept',
              whyNow: 'Recent market and sentiment volatility changed short-term pricing.',
              preferredAdjustments: ['Reduce outgoing premium pick cost', 'Add low-tier throw-in on return side'],
            },
          }
        : {}),
      commissionerAlert,
    },
  }
}
