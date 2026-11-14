/**
 * Global Fantasy Intelligence Engine (PROMPT 139).
 * Combines trend detection, strategy meta, dynasty projections, and simulations
 * into one deterministic global insight layer.
 */

import { SUPPORTED_SPORTS, isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import { getTrendFeed } from '@/lib/player-trend/TrendDetectionService'
import { runMetaAnalysis } from '@/lib/strategy-meta-engine'
import { getDynastyProjectionsForLeague } from '@/lib/dynasty-engine/DynastyQueryService'
import { getSimulationSummaryForAI } from '@/lib/simulation-engine/SimulationQueryService'
import type { TrendFeedItem, TrendFeedType } from '@/lib/player-trend'
import type { DynastyProjectionOutput } from '@/lib/dynasty-engine/types'
import type {
  DraftStrategyShift,
  MetaAnalysisResult,
  MetaInsightHeadline as StrategyMetaHeadline,
  PositionValueChange,
  WaiverStrategyTrend,
} from '@/lib/strategy-meta-engine'
import { buildWeatherContextForAI } from '@/lib/weather/weatherContextForAI'
import { getPlayerValuesContext } from '@/lib/player-values/playerValuesLoader'
import type {
  DynastyInsights,
  GlobalFantasyActionItem,
  GlobalFantasyHeadline,
  GlobalFantasyInsightPriority,
  GlobalFantasyInsightTone,
  GlobalFantasyInsights,
  GlobalFantasyInsightsInput,
  GlobalFantasyOverviewCard,
  GlobalFantasySourceState,
  GlobalFantasySourceStatus,
  GlobalFantasySystemScores,
  MetaInsights,
  SimulationInsights,
  TrendInsightLeader,
  TrendInsights,
} from './types'

const TREND_FEED_TYPES: TrendFeedType[] = [
  'hot_streak',
  'cold_streak',
  'breakout_candidate',
  'sell_high_candidate',
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value: number, digits = 1): number {
  return Number(value.toFixed(digits))
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeSport(sport: string | undefined): string | null {
  if (!sport?.trim()) return null
  const normalized = sport.trim().toUpperCase()
  return isSupportedSport(normalized) ? normalizeToSupportedSport(normalized) : null
}

function emptyTrendTypeCounts(): Record<TrendFeedType, number> {
  return {
    hot_streak: 0,
    cold_streak: 0,
    breakout_candidate: 0,
    sell_high_candidate: 0,
  }
}

function formatTrendType(trendType: TrendFeedType): string {
  switch (trendType) {
    case 'hot_streak':
      return 'hot streak'
    case 'cold_streak':
      return 'cold streak'
    case 'breakout_candidate':
      return 'breakout candidate'
    case 'sell_high_candidate':
      return 'sell-high candidate'
    default:
      return trendType
  }
}

function toPriority(score: number): GlobalFantasyInsightPriority {
  if (score >= 75) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}

function toTone(value: number, positiveThreshold: number, negativeThreshold: number): GlobalFantasyInsightTone {
  if (value >= positiveThreshold) return 'positive'
  if (value <= negativeThreshold) return 'negative'
  return 'neutral'
}

function resolveSourceState(args: {
  enabled: boolean
  error?: string
  hasData: boolean
}): GlobalFantasySourceState {
  if (!args.enabled) return 'unavailable'
  if (args.error) return 'error'
  if (args.hasData) return 'ready'
  return 'empty'
}

function buildTrendLeader(item: TrendFeedItem | undefined): TrendInsightLeader | null {
  if (!item) return null
  return {
    playerId: item.playerId,
    displayName: item.displayName,
    position: item.position,
    team: item.team,
    trendType: item.trendType,
    signalStrength: roundTo(item.signals.signalStrength, 1),
    recommendation: item.summary.recommendation,
  }
}

function getTopMetaHeadline(result: MetaAnalysisResult): StrategyMetaHeadline | null {
  return [...result.headlines].sort((left, right) => right.confidence - left.confidence)[0] ?? null
}

function getAverageMetaConfidence(result: MetaAnalysisResult): number | null {
  const confidenceValues = [
    ...result.draftStrategyShifts.map((item) => item.confidence),
    ...result.positionValueChanges.map((item) => item.confidence),
    ...result.waiverStrategyTrends.map((item) => item.confidence),
    ...result.headlines.map((item) => item.confidence),
  ].filter((value) => Number.isFinite(value))

  return average(confidenceValues)
}

function getTopDraftShift(meta: MetaInsights): DraftStrategyShift | null {
  return [...meta.draftStrategyShifts].sort(
    (left, right) => right.signalStrength - left.signalStrength
  )[0] ?? null
}

function getTopPositionValue(meta: MetaInsights): PositionValueChange | null {
  return [...meta.positionValueChanges].sort((left, right) => right.valueScore - left.valueScore)[0] ?? null
}

function getTopWaiverTrend(meta: MetaInsights): WaiverStrategyTrend | null {
  return [...meta.waiverStrategyTrends].sort(
    (left, right) => right.streamingScore - left.streamingScore
  )[0] ?? null
}

function getTopWindowProjection(projections: DynastyProjectionOutput[]): DynastyProjectionOutput | null {
  return [...projections].sort(
    (left, right) => right.championshipWindowScore - left.championshipWindowScore
  )[0] ?? null
}

function getTopFutureAssetProjection(projections: DynastyProjectionOutput[]): DynastyProjectionOutput | null {
  return [...projections].sort(
    (left, right) => right.futureAssetScore - left.futureAssetScore
  )[0] ?? null
}

function buildTrendHeat(items: TrendFeedItem[]): number {
  const topSignals = items
    .slice(0, 5)
    .map((item) => item.signals.signalStrength)
    .filter((value) => Number.isFinite(value))

  return roundTo(clamp(average(topSignals) ?? 0, 0, 100), 1)
}

function buildMetaVolatility(meta: MetaInsights): number {
  const topDraftSignal = getTopDraftShift(meta)?.signalStrength ?? 0
  const topPositionSignal = getTopPositionValue(meta)?.valueScore ?? 0
  const topWaiverSignal = getTopWaiverTrend(meta)?.streamingScore ?? 0
  return roundTo(clamp(average([topDraftSignal, topPositionSignal, topWaiverSignal]) ?? 0, 0, 100), 1)
}

function buildDynastyLeverage(dynasty: DynastyInsights): number {
  if (dynasty.projections.length === 0) return 0
  const leverage = dynasty.projections.slice(0, 3).map((projection) =>
    (projection.championshipWindowScore + projection.futureAssetScore + (100 - projection.rebuildProbability)) /
      3
  )
  return roundTo(clamp(average(leverage) ?? 0, 0, 100), 1)
}

function buildSimulationConfidence(simulation: SimulationInsights): number {
  const matchupConfidence = simulation.averageMatchupEdge ?? 0
  const playoffConfidence =
    simulation.topPlayoffProbability != null ? simulation.topPlayoffProbability * 100 : 0
  const values = [matchupConfidence, playoffConfidence].filter((value) => value > 0)
  return roundTo(clamp(average(values) ?? 0, 0, 100), 1)
}

function buildOpportunityIndex(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights
): number {
  const trendOpportunity = average(
    trend.items
      .filter((item) => item.trendType === 'hot_streak' || item.trendType === 'breakout_candidate')
      .slice(0, 3)
      .map((item) => item.signals.signalStrength)
  ) ?? 0
  const metaOpportunity = buildMetaVolatility(meta)
  const dynastyOpportunity = average(
    [dynasty.topWindowScore ?? 0, dynasty.averageFutureAssetScore ?? 0].filter((value) => value > 0)
  ) ?? 0
  const simulationOpportunity = average(
    [
      simulation.topPlayoffProbability != null ? simulation.topPlayoffProbability * 100 : 0,
      simulation.averageMatchupEdge ?? 0,
    ].filter((value) => value > 0)
  ) ?? 0

  return roundTo(
    clamp(
      average(
        [trendOpportunity, metaOpportunity, dynastyOpportunity, simulationOpportunity].filter(
          (value) => value > 0
        )
      ) ?? 0,
      0,
      100
    ),
    1
  )
}

function buildRiskIndex(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights
): number {
  const trendRisk = average(
    trend.items
      .filter((item) => item.trendType === 'cold_streak' || item.trendType === 'sell_high_candidate')
      .slice(0, 3)
      .map((item) => item.signals.signalStrength)
  ) ?? 0

  const metaRiskInputs: number[] = []
  const topPosition = getTopPositionValue(meta)
  if (topPosition?.direction === 'Falling') metaRiskInputs.push(topPosition.valueScore)
  const topDraft = getTopDraftShift(meta)
  if (topDraft?.trendingDirection === 'Falling') metaRiskInputs.push(topDraft.signalStrength)
  const topWaiver = getTopWaiverTrend(meta)
  if (topWaiver) metaRiskInputs.push(topWaiver.churnRate * 100)
  const metaRisk = average(metaRiskInputs) ?? 0

  const dynastyRisk = dynasty.projections.length
    ? average(
        dynasty.projections
          .slice(0, 3)
          .map((projection) => (projection.rebuildProbability + projection.agingRiskScore) / 2)
      ) ?? 0
    : 0

  const simulationRisk = simulation.matchupSimulations.length || simulation.seasonSimulations.length
    ? 100 - buildSimulationConfidence(simulation)
    : 0

  return roundTo(
    clamp(
      average([trendRisk, metaRisk, dynastyRisk, simulationRisk].filter((value) => value > 0)) ?? 0,
      0,
      100
    ),
    1
  )
}

function buildSystemScores(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights
): GlobalFantasySystemScores {
  const trendHeat = buildTrendHeat(trend.items)
  const metaVolatility = buildMetaVolatility(meta)
  const dynastyLeverage = buildDynastyLeverage(dynasty)
  const simulationConfidence = buildSimulationConfidence(simulation)
  const opportunityIndex = buildOpportunityIndex(trend, meta, dynasty, simulation)
  const riskIndex = buildRiskIndex(trend, meta, dynasty, simulation)

  return {
    trendHeat,
    metaVolatility,
    dynastyLeverage,
    simulationConfidence,
    opportunityIndex,
    riskIndex,
  }
}

function buildOverviewCards(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights,
  leagueId: string | null,
  systemScores: GlobalFantasySystemScores
): GlobalFantasyOverviewCard[] {
  const positiveTrendCount =
    trend.trendTypeCounts.hot_streak + trend.trendTypeCounts.breakout_candidate
  const negativeTrendCount =
    trend.trendTypeCounts.cold_streak + trend.trendTypeCounts.sell_high_candidate
  const topMetaHeadline = meta.topHeadline

  return [
    {
      id: 'trend',
      label: 'Trend pulse',
      value: trend.strongestSignal
        ? `${trend.strongestSignal.displayName ?? trend.strongestSignal.playerId}`
        : `${positiveTrendCount} positive signals`,
      detail: trend.strongestSignal
        ? `${formatTrendType(trend.strongestSignal.trendType)} at ${trend.strongestSignal.signalStrength} strength`
        : `${positiveTrendCount} positive vs ${negativeTrendCount} risk signals`,
      tone:
        positiveTrendCount > negativeTrendCount
          ? 'positive'
          : negativeTrendCount > positiveTrendCount
            ? 'negative'
            : toTone(systemScores.trendHeat, 65, 40),
    },
    {
      id: 'meta',
      label: 'Meta shift',
      value: topMetaHeadline?.title ?? `${meta.draftStrategyShifts.length} draft shifts`,
      detail:
        topMetaHeadline?.summary ??
        getTopDraftShift(meta)?.summary ??
        'No dominant strategy shift surfaced in the current window.',
      tone: toTone(systemScores.metaVolatility, 70, 35),
    },
    {
      id: 'dynasty',
      label: 'Dynasty window',
      value: dynasty.topWindowTeamId ?? 'League context needed',
      detail:
        dynasty.topWindowTeamId && dynasty.topWindowScore != null
          ? `Top window score ${roundTo(dynasty.topWindowScore, 0)} with ${dynasty.contenderCount} contender builds`
          : 'Add league context to unlock long-horizon team leverage.',
      tone: leagueId ? toTone(systemScores.dynastyLeverage, 65, 40) : 'neutral',
    },
    {
      id: 'simulation',
      label: 'Simulation edge',
      value: simulation.topPlayoffOddsTeamId ?? simulation.topMatchupEdgeTeamId ?? 'League context needed',
      detail:
        simulation.topPlayoffOddsTeamId && simulation.topPlayoffProbability != null
          ? `Best playoff odds at ${roundTo(simulation.topPlayoffProbability * 100, 0)}%`
          : simulation.topMatchupEdgeTeamId && simulation.topMatchupWinProbability != null
            ? `Best weekly edge at ${roundTo(simulation.topMatchupWinProbability * 100, 0)}% win odds`
            : 'Add league context to surface playoff and matchup edges.',
      tone: leagueId ? toTone(systemScores.simulationConfidence, 65, 40) : 'neutral',
    },
  ]
}

function buildHeadlines(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights
): GlobalFantasyHeadline[] {
  const headlines: GlobalFantasyHeadline[] = []

  if (trend.strongestSignal) {
    headlines.push({
      id: 'trend-strongest',
      category: 'trend',
      title: `${trend.strongestSignal.displayName ?? trend.strongestSignal.playerId} is the strongest ${formatTrendType(
        trend.strongestSignal.trendType
      )} signal`,
      summary: trend.items[0]?.summary.rationale ?? trend.strongestSignal.recommendation,
      confidence: roundTo(clamp(trend.strongestSignal.signalStrength / 100, 0.35, 0.95), 2),
      priority: toPriority(trend.strongestSignal.signalStrength),
      relatedEntity: trend.strongestSignal.displayName ?? trend.strongestSignal.playerId,
    })
  }

  if (meta.topHeadline) {
    headlines.push({
      id: `meta-${meta.topHeadline.id}`,
      category: 'meta',
      title: meta.topHeadline.title,
      summary: meta.topHeadline.summary,
      confidence: roundTo(clamp(meta.topHeadline.confidence, 0.35, 0.95), 2),
      priority: toPriority(meta.topHeadline.confidence * 100),
      relatedEntity: null,
    })
  } else if (getTopDraftShift(meta)) {
    const draftShift = getTopDraftShift(meta)!
    headlines.push({
      id: `meta-draft-${draftShift.strategyType}`,
      category: 'meta',
      title: `${draftShift.strategyLabel ?? draftShift.strategyType} is driving the draft room`,
      summary: draftShift.summary,
      confidence: roundTo(clamp(draftShift.confidence, 0.35, 0.95), 2),
      priority: toPriority(draftShift.signalStrength),
      relatedEntity: draftShift.strategyLabel ?? draftShift.strategyType,
    })
  }

  if (dynasty.topWindowTeamId && dynasty.topWindowScore != null) {
    headlines.push({
      id: `dynasty-${dynasty.topWindowTeamId}`,
      category: 'dynasty',
      title: `${dynasty.topWindowTeamId} owns the strongest dynasty window`,
      summary: `${dynasty.topWindowTeamId} leads the league with a ${roundTo(
        dynasty.topWindowScore,
        0
      )} championship-window score and ${dynasty.contenderCount} contender builds are already separating.`,
      confidence: roundTo(clamp(dynasty.topWindowScore / 100, 0.35, 0.95), 2),
      priority: toPriority(dynasty.topWindowScore),
      relatedEntity: dynasty.topWindowTeamId,
    })
  }

  if (simulation.topPlayoffOddsTeamId && simulation.topPlayoffProbability != null) {
    headlines.push({
      id: `simulation-playoff-${simulation.topPlayoffOddsTeamId}`,
      category: 'simulation',
      title: `${simulation.topPlayoffOddsTeamId} leads the simulation board`,
      summary: `${simulation.topPlayoffOddsTeamId} has the best playoff odds at ${roundTo(
        simulation.topPlayoffProbability * 100,
        0
      )}% with an average matchup edge of ${roundTo(simulation.averageMatchupEdge ?? 0, 0)}.`,
      confidence: roundTo(clamp(simulation.topPlayoffProbability, 0.35, 0.95), 2),
      priority: toPriority((simulation.topPlayoffProbability ?? 0) * 100),
      relatedEntity: simulation.topPlayoffOddsTeamId,
    })
  } else if (simulation.topMatchupEdgeTeamId && simulation.topMatchupWinProbability != null) {
    headlines.push({
      id: `simulation-matchup-${simulation.topMatchupEdgeTeamId}`,
      category: 'simulation',
      title: `${simulation.topMatchupEdgeTeamId} has the clearest weekly edge`,
      summary: `${simulation.topMatchupEdgeTeamId} is carrying a ${roundTo(
        simulation.topMatchupWinProbability * 100,
        0
      )}% win expectation in the strongest live simulation matchup.`,
      confidence: roundTo(clamp(simulation.topMatchupWinProbability, 0.35, 0.95), 2),
      priority: toPriority((simulation.topMatchupWinProbability ?? 0) * 100),
      relatedEntity: simulation.topMatchupEdgeTeamId,
    })
  }

  if (
    dynasty.topWindowTeamId &&
    simulation.topPlayoffOddsTeamId &&
    dynasty.topWindowTeamId === simulation.topPlayoffOddsTeamId
  ) {
    headlines.push({
      id: `cross-system-${dynasty.topWindowTeamId}`,
      category: 'cross_system',
      title: `${dynasty.topWindowTeamId} is leading both long-term and current-week signals`,
      summary: `${dynasty.topWindowTeamId} sits at the top of the dynasty board and also carries the strongest playoff projection, which is the cleanest cross-system contender signal in the engine.`,
      confidence: roundTo(
        clamp(
          average([
            (dynasty.topWindowScore ?? 0) / 100,
            simulation.topPlayoffProbability ?? 0,
          ]) ?? 0.5,
          0.35,
          0.95
        ),
        2
      ),
      priority: 'high',
      relatedEntity: dynasty.topWindowTeamId,
    })
  } else {
    const strongestSignal = trend.strongestSignal
    const topPosition = getTopPositionValue(meta)
    if (
      strongestSignal?.position &&
      topPosition?.position &&
      strongestSignal.position === topPosition.position &&
      topPosition.direction === 'Rising'
    ) {
      headlines.push({
        id: `cross-system-position-${strongestSignal.position}`,
        category: 'cross_system',
        title: `${strongestSignal.position} is heating up at both the player and market level`,
        summary: `${strongestSignal.displayName ?? strongestSignal.playerId} is driving the loudest player signal, and the wider ${strongestSignal.position} market is also rising in value.`,
        confidence: roundTo(
          clamp(
            average([
              strongestSignal.signalStrength / 100,
              topPosition.confidence,
            ]) ?? 0.5,
            0.35,
            0.95
          ),
          2
        ),
        priority: toPriority(
          average([strongestSignal.signalStrength, topPosition.valueScore]) ?? 50
        ),
        relatedEntity: strongestSignal.position,
      })
    }
  }

  return headlines
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5)
}

function buildActionItems(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights
): GlobalFantasyActionItem[] {
  const items: GlobalFantasyActionItem[] = []

  if (trend.strongestSignal) {
    items.push({
      id: 'action-trend',
      category: 'trend',
      priority: toPriority(trend.strongestSignal.signalStrength),
      title: `Act on ${trend.strongestSignal.displayName ?? trend.strongestSignal.playerId}`,
      recommendation: trend.strongestSignal.recommendation,
      rationale:
        trend.items[0]?.summary.rationale ??
        `${trend.strongestSignal.displayName ?? trend.strongestSignal.playerId} is the strongest current player signal.`,
      relatedEntity: trend.strongestSignal.displayName ?? trend.strongestSignal.playerId,
    })
  }

  const topPosition = getTopPositionValue(meta)
  if (topPosition?.direction === 'Rising') {
    items.push({
      id: `action-meta-position-${topPosition.position}`,
      category: 'meta',
      priority: toPriority(topPosition.valueScore),
      title: `Lean into ${topPosition.position} value`,
      recommendation: `Prioritize ${topPosition.position} acquisition while the market is still moving upward.`,
      rationale: topPosition.summary,
      relatedEntity: topPosition.position,
    })
  } else if (getTopWaiverTrend(meta)) {
    const waiverTrend = getTopWaiverTrend(meta)!
    items.push({
      id: `action-meta-waiver-${waiverTrend.primaryPosition ?? waiverTrend.sport}`,
      category: 'meta',
      priority: toPriority(waiverTrend.streamingScore),
      title: 'Attack the waiver stream',
      recommendation: `Increase waiver aggression around ${waiverTrend.primaryPosition ?? waiverTrend.sport} depth this week.`,
      rationale: waiverTrend.summary,
      relatedEntity: waiverTrend.primaryPosition ?? waiverTrend.sport,
    })
  }

  if (dynasty.topWindowTeamId && dynasty.topWindowScore != null) {
    items.push({
      id: `action-dynasty-${dynasty.topWindowTeamId}`,
      category: 'dynasty',
      priority: toPriority(dynasty.topWindowScore),
      title:
        dynasty.topWindowScore >= 70
          ? 'Press the contender window'
          : 'Balance short-term push with future assets',
      recommendation:
        dynasty.topWindowScore >= 70
          ? `Use ${dynasty.topWindowTeamId}'s window to buy immediate points before the market tightens.`
          : `Keep ${dynasty.topWindowTeamId} competitive, but avoid trading away every future lever at once.`,
      rationale: `${dynasty.topWindowTeamId} leads the dynasty board while ${dynasty.contenderCount} contender builds are live and the average aging risk sits at ${roundTo(
        dynasty.averageAgingRiskScore ?? 0,
        0
      )}.`,
      relatedEntity: dynasty.topWindowTeamId,
    })
  }

  if (simulation.topMatchupEdgeTeamId && simulation.topMatchupWinProbability != null) {
    items.push({
      id: `action-simulation-${simulation.topMatchupEdgeTeamId}`,
      category: 'simulation',
      priority: toPriority((simulation.topMatchupWinProbability ?? 0) * 100),
      title: 'Respect the live simulation edge',
      recommendation: `Build around ${simulation.topMatchupEdgeTeamId} as the clearest current-week leverage point.`,
      rationale: `${simulation.topMatchupEdgeTeamId} is carrying the strongest matchup edge at ${roundTo(
        simulation.topMatchupWinProbability * 100,
        0
      )}% win probability.`,
      relatedEntity: simulation.topMatchupEdgeTeamId,
    })
  } else if (simulation.topPlayoffOddsTeamId && simulation.topPlayoffProbability != null) {
    items.push({
      id: `action-simulation-playoff-${simulation.topPlayoffOddsTeamId}`,
      category: 'simulation',
      priority: toPriority((simulation.topPlayoffProbability ?? 0) * 100),
      title: 'Protect the playoff favorite',
      recommendation: `Preserve lineup stability and avoid unnecessary volatility around ${simulation.topPlayoffOddsTeamId}.`,
      rationale: `${simulation.topPlayoffOddsTeamId} owns the best playoff odds at ${roundTo(
        simulation.topPlayoffProbability * 100,
        0
      )}%.`,
      relatedEntity: simulation.topPlayoffOddsTeamId,
    })
  }

  return items.slice(0, 4)
}

function buildSourceStatus(
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights,
  hasLeagueContext: boolean
): GlobalFantasySourceStatus {
  const trendState = resolveSourceState({
    enabled: true,
    error: trend.error,
    hasData: trend.items.length > 0,
  })
  const metaState = resolveSourceState({
    enabled: true,
    error: meta.error,
    hasData:
      meta.draftStrategyShifts.length > 0 ||
      meta.positionValueChanges.length > 0 ||
      meta.waiverStrategyTrends.length > 0,
  })
  const dynastyState = resolveSourceState({
    enabled: hasLeagueContext,
    error: dynasty.error,
    hasData: dynasty.projections.length > 0,
  })
  const simulationState = resolveSourceState({
    enabled: hasLeagueContext,
    error: simulation.error,
    hasData:
      simulation.matchupSimulations.length > 0 || simulation.seasonSimulations.length > 0,
  })

  const states = [trendState, metaState, dynastyState, simulationState]

  return {
    trend: trendState,
    meta: metaState,
    dynasty: dynastyState,
    simulation: simulationState,
    availableSources: states.filter((state) => state === 'ready' || state === 'empty').length,
    errorCount: states.filter((state) => state === 'error').length,
    hasLeagueContext,
  }
}

function buildSummary(
  sport: string | null,
  trend: TrendInsights,
  meta: MetaInsights,
  dynasty: DynastyInsights,
  simulation: SimulationInsights,
  hasLeagueContext: boolean
): string {
  const label = sport ?? 'Global'
  const segments: string[] = []

  if (trend.strongestSignal) {
    segments.push(
      `${label} trend pulse is led by ${trend.strongestSignal.displayName ?? trend.strongestSignal.playerId}, grading as a ${formatTrendType(
        trend.strongestSignal.trendType
      )} at ${roundTo(trend.strongestSignal.signalStrength, 0)} signal strength.`
    )
  } else {
    segments.push(`${label} trend pulse is balanced, with no single player signal clearly separating from the pack.`)
  }

  if (meta.topHeadline) {
    segments.push(meta.topHeadline.summary)
  } else if (getTopDraftShift(meta)) {
    segments.push(getTopDraftShift(meta)!.summary)
  } else {
    segments.push('Strategy meta is relatively steady, without a dominant draft or waiver shift.')
  }

  if (hasLeagueContext) {
    if (
      dynasty.topWindowTeamId &&
      simulation.topPlayoffOddsTeamId &&
      dynasty.topWindowTeamId === simulation.topPlayoffOddsTeamId
    ) {
      segments.push(
        `${dynasty.topWindowTeamId} is the clearest cross-system team signal, sitting on top of both the dynasty window board and the simulation playoff table.`
      )
    } else {
      if (dynasty.topWindowTeamId) {
        segments.push(
          `${dynasty.topWindowTeamId} owns the strongest dynasty window, with ${dynasty.contenderCount} contender profiles currently ahead of the rebuild tier.`
        )
      }
      if (simulation.topPlayoffOddsTeamId && simulation.topPlayoffProbability != null) {
        segments.push(
          `${simulation.topPlayoffOddsTeamId} leads the simulation board at ${roundTo(
            simulation.topPlayoffProbability * 100,
            0
          )}% playoff odds.`
        )
      }
    }
  } else {
    segments.push('Add league context to unlock team-level dynasty and simulation intelligence on top of the platform-wide trend and meta layers.')
  }

  return segments.join(' ')
}

export function buildUnifiedGlobalFantasyInsights(args: {
  trend: TrendInsights
  meta: MetaInsights
  dynasty: DynastyInsights
  simulation: SimulationInsights
  sport: string | null
  leagueId: string | null
  season: number | null
  weekOrPeriod: number | null
  generatedAt?: string
  weatherContextForAI?: string | null
  playerValuesContextForAI?: string | null
}): GlobalFantasyInsights {
  const hasLeagueContext = Boolean(args.leagueId)
  const systemScores = buildSystemScores(args.trend, args.meta, args.dynasty, args.simulation)
  const overviewCards = buildOverviewCards(
    args.trend,
    args.meta,
    args.dynasty,
    args.simulation,
    args.leagueId,
    systemScores
  )
  const headlines = buildHeadlines(args.trend, args.meta, args.dynasty, args.simulation)
  const actionItems = buildActionItems(args.trend, args.meta, args.dynasty, args.simulation)
  const sourceStatus = buildSourceStatus(
    args.trend,
    args.meta,
    args.dynasty,
    args.simulation,
    hasLeagueContext
  )
  const baseSummary = buildSummary(
    args.sport,
    args.trend,
    args.meta,
    args.dynasty,
    args.simulation,
    hasLeagueContext
  )
  const wx = args.weatherContextForAI?.trim()
  const summary = wx ? `${baseSummary} ${wx}` : baseSummary

  return {
    trend: args.trend,
    meta: args.meta,
    dynasty: args.dynasty,
    simulation: args.simulation,
    sport: args.sport,
    leagueId: args.leagueId,
    season: args.season,
    weekOrPeriod: args.weekOrPeriod,
    summary,
    overviewCards,
    headlines,
    actionItems,
    systemScores,
    sourceStatus,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    weatherContextForAI: wx || undefined,
    playerValuesContextForAI: args.playerValuesContextForAI?.trim() || undefined,
  }
}

async function fetchTrendInsights(sport: string | null, limit: number): Promise<TrendInsights> {
  const generatedAt = new Date().toISOString()

  try {
    const items = await getTrendFeed({
      sport: sport ?? undefined,
      limit,
      limitPerType: Math.max(4, Math.ceil(limit / TREND_FEED_TYPES.length)),
    })

    const trendTypeCounts = items.reduce((counts, item) => {
      counts[item.trendType] += 1
      return counts
    }, emptyTrendTypeCounts())

    return {
      items,
      sport,
      generatedAt,
      trendTypeCounts,
      averageSignalStrength: roundTo(
        average(items.map((item) => item.signals.signalStrength)) ?? 0,
        1
      ),
      strongestSignal: buildTrendLeader(items[0]),
    }
  } catch (error) {
    return {
      items: [],
      sport,
      generatedAt,
      trendTypeCounts: emptyTrendTypeCounts(),
      averageSignalStrength: null,
      strongestSignal: null,
      error: error instanceof Error ? error.message : 'Trend fetch failed',
    }
  }
}

async function fetchMetaInsights(
  sport: string | null,
  windowDays: number,
  leagueFormat: string | null
): Promise<MetaInsights> {
  const generatedAt = new Date().toISOString()

  try {
    const result = await runMetaAnalysis({
      sport: sport ?? undefined,
      leagueFormat: leagueFormat ?? undefined,
      windowDays,
    })
    const topHeadline = getTopMetaHeadline(result)

    return {
      draftStrategyShifts: result.draftStrategyShifts,
      positionValueChanges: result.positionValueChanges,
      waiverStrategyTrends: result.waiverStrategyTrends,
      overviewCards: result.overviewCards,
      headlines: result.headlines,
      sourceCoverage: result.sourceCoverage,
      sport: result.sport,
      generatedAt,
      averageConfidence: roundTo(getAverageMetaConfidence(result) ?? 0, 2),
      topHeadline,
    }
  } catch (error) {
    return {
      draftStrategyShifts: [],
      positionValueChanges: [],
      waiverStrategyTrends: [],
      overviewCards: [],
      headlines: [],
      sourceCoverage: null,
      sport,
      generatedAt,
      averageConfidence: null,
      topHeadline: null,
      error: error instanceof Error ? error.message : 'Meta analysis failed',
    }
  }
}

async function fetchDynastyInsights(
  leagueId: string | null,
  sport: string | null
): Promise<DynastyInsights> {
  const generatedAt = new Date().toISOString()
  if (!leagueId?.trim()) {
    return {
      projections: [],
      leagueId: null,
      sport,
      generatedAt,
      contenderCount: 0,
      rebuildCount: 0,
      averageAgingRiskScore: null,
      averageFutureAssetScore: null,
      topWindowTeamId: null,
      topWindowScore: null,
      topFutureAssetTeamId: null,
    }
  }

  try {
    const projections = await getDynastyProjectionsForLeague(leagueId, sport ?? undefined)
    const topWindowProjection = getTopWindowProjection(projections)
    const topFutureAssetProjection = getTopFutureAssetProjection(projections)

    return {
      projections,
      leagueId,
      sport,
      generatedAt,
      contenderCount: projections.filter(
        (projection) =>
          projection.championshipWindowScore >= 60 && projection.rebuildProbability < 45
      ).length,
      rebuildCount: projections.filter((projection) => projection.rebuildProbability >= 55).length,
      averageAgingRiskScore: roundTo(
        average(projections.map((projection) => projection.agingRiskScore)) ?? 0,
        1
      ),
      averageFutureAssetScore: roundTo(
        average(projections.map((projection) => projection.futureAssetScore)) ?? 0,
        1
      ),
      topWindowTeamId: topWindowProjection?.teamId ?? null,
      topWindowScore: topWindowProjection?.championshipWindowScore ?? null,
      topFutureAssetTeamId: topFutureAssetProjection?.teamId ?? null,
    }
  } catch (error) {
    return {
      projections: [],
      leagueId,
      sport,
      generatedAt,
      contenderCount: 0,
      rebuildCount: 0,
      averageAgingRiskScore: null,
      averageFutureAssetScore: null,
      topWindowTeamId: null,
      topWindowScore: null,
      topFutureAssetTeamId: null,
      error: error instanceof Error ? error.message : 'Dynasty fetch failed',
    }
  }
}

async function fetchSimulationInsights(
  leagueId: string | null,
  sport: string | null,
  season: number | null,
  weekOrPeriod: number | null
): Promise<SimulationInsights> {
  const generatedAt = new Date().toISOString()
  if (!leagueId?.trim() || season == null || weekOrPeriod == null) {
    return {
      matchupSimulations: [],
      seasonSimulations: [],
      leagueId: null,
      season: null,
      weekOrPeriod: null,
      generatedAt,
      topMatchupEdgeTeamId: null,
      topMatchupWinProbability: null,
      topPlayoffOddsTeamId: null,
      topPlayoffProbability: null,
      averageMatchupEdge: null,
      averageExpectedMargin: null,
      averagePlayoffProbability: null,
    }
  }

  try {
    const { matchupResults, seasonResults } = await getSimulationSummaryForAI(
      leagueId,
      sport ?? SUPPORTED_SPORTS[0],
      season,
      weekOrPeriod
    )

    const matchupSimulations = (matchupResults ?? []).map((result) => ({
      simulationId: result.simulationId,
      leagueId: result.leagueId ?? null,
      weekOrPeriod: result.weekOrPeriod,
      teamAId: result.teamAId ?? null,
      teamBId: result.teamBId ?? null,
      expectedScoreA: result.expectedScoreA,
      expectedScoreB: result.expectedScoreB,
      winProbabilityA: result.winProbabilityA,
      winProbabilityB: result.winProbabilityB,
      iterations: result.iterations,
      createdAt: result.createdAt?.toISOString?.() ?? generatedAt,
    }))

    const seasonSimulations = (seasonResults ?? []).map((result) => ({
      resultId: result.resultId,
      leagueId: result.leagueId,
      teamId: result.teamId,
      season: result.season,
      weekOrPeriod: result.weekOrPeriod,
      playoffProbability: result.playoffProbability,
      championshipProbability: result.championshipProbability,
      expectedWins: result.expectedWins,
      expectedRank: result.expectedRank,
      simulationsRun: result.simulationsRun,
    }))

    const topMatchup = [...matchupSimulations].sort((left, right) => {
      const leftEdge = Math.abs(left.winProbabilityA - 0.5)
      const rightEdge = Math.abs(right.winProbabilityA - 0.5)
      return rightEdge - leftEdge
    })[0] ?? null
    const topSeason = [...seasonSimulations].sort(
      (left, right) => right.playoffProbability - left.playoffProbability
    )[0] ?? null

    return {
      matchupSimulations,
      seasonSimulations,
      leagueId,
      season,
      weekOrPeriod,
      generatedAt,
      topMatchupEdgeTeamId: topMatchup
        ? topMatchup.winProbabilityA >= topMatchup.winProbabilityB
          ? topMatchup.teamAId
          : topMatchup.teamBId
        : null,
      topMatchupWinProbability: topMatchup
        ? Math.max(topMatchup.winProbabilityA, topMatchup.winProbabilityB)
        : null,
      topPlayoffOddsTeamId: topSeason?.teamId ?? null,
      topPlayoffProbability: topSeason?.playoffProbability ?? null,
      averageMatchupEdge: roundTo(
        average(
          matchupSimulations.map((result) => Math.abs(result.winProbabilityA - 0.5) * 200)
        ) ?? 0,
        1
      ),
      averageExpectedMargin: roundTo(
        average(
          matchupSimulations.map((result) => Math.abs(result.expectedScoreA - result.expectedScoreB))
        ) ?? 0,
        1
      ),
      averagePlayoffProbability: roundTo(
        average(seasonSimulations.map((result) => result.playoffProbability)) ?? 0,
        4
      ),
    }
  } catch (error) {
    return {
      matchupSimulations: [],
      seasonSimulations: [],
      leagueId,
      season,
      weekOrPeriod,
      generatedAt,
      topMatchupEdgeTeamId: null,
      topMatchupWinProbability: null,
      topPlayoffOddsTeamId: null,
      topPlayoffProbability: null,
      averageMatchupEdge: null,
      averageExpectedMargin: null,
      averagePlayoffProbability: null,
      error: error instanceof Error ? error.message : 'Simulation fetch failed',
    }
  }
}

export async function getGlobalFantasyInsights(
  input: GlobalFantasyInsightsInput = {}
): Promise<GlobalFantasyInsights> {
  const sport = normalizeSport(input.sport)
  const leagueId = input.leagueId?.trim() || null
  const season = input.season ?? new Date().getFullYear()
  const weekOrPeriod = input.weekOrPeriod ?? 1
  const trendLimit = Math.min(100, Math.max(1, input.trendLimit ?? 20))
  const metaWindowDays = Math.min(90, Math.max(1, input.metaWindowDays ?? 30))

  const [trend, meta, dynasty, simulation] = await Promise.all([
    fetchTrendInsights(sport, trendLimit),
    fetchMetaInsights(sport, metaWindowDays, input.leagueFormat ?? null),
    fetchDynastyInsights(leagueId, sport),
    fetchSimulationInsights(leagueId, sport, leagueId ? season : null, leagueId ? weekOrPeriod : null),
  ])

  let weatherContextForAI: string | undefined
  if (input.weatherForAI) {
    weatherContextForAI = await buildWeatherContextForAI(
      input.weatherForAI.sport,
      input.weatherForAI.position,
      input.weatherForAI.weather,
      input.weatherForAI.impact
    )
  }

  const playerValuesContextForAI =
    getPlayerValuesContext(sport ? { sport } : undefined) || null

  return buildUnifiedGlobalFantasyInsights({
    trend,
    meta,
    dynasty,
    simulation,
    sport,
    leagueId,
    season: leagueId ? season : null,
    weekOrPeriod: leagueId ? weekOrPeriod : null,
    weatherContextForAI,
    playerValuesContextForAI,
  })
}

export function getGlobalFantasyInsightsSupportedSports(): readonly string[] {
  return SUPPORTED_SPORTS
}
