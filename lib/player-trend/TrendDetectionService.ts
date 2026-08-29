/**
 * Player Trend Detection Engine (PROMPT 135).
 * Detects hot_streak, cold_streak, breakout_candidate, sell_high_candidate
 * with deterministic signals: performance delta, usage change, minutes/snap share, efficiency.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER via sport-scope.
 */
import { prisma } from '@/lib/prisma'
import { buildNameIndex } from '@/lib/player-identity/nameIndex'
import { getPlayerAnalyticsBatch, type PlayerAnalytics } from '@/lib/player-analytics'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { TimeframeId } from '@/lib/global-meta-engine/types'
import { getTrendingByDirection, type TrendingPlayerRow } from './PlayerTrendAnalyzer'
import type {
  TrendDeterministicSignals,
  TrendFeedItem,
  TrendFeedType,
  TrendSignalSnapshot,
  TrendSummary,
} from './types'

export type {
  TrendDeterministicSignals,
  TrendFeedItem,
  TrendFeedType,
  TrendSignalSnapshot,
  TrendSummary,
}

export interface TrendFeedOptions {
  sport?: string
  timeframe?: TimeframeId
  limitPerType?: number
  /** Max items total across all types (default 80) */
  limit?: number
}

export interface TrendFeedProfileInput {
  row: TrendingPlayerRow
  previousTrendScore: number | null
  stats: TrendGameStatSample[]
  analytics: PlayerAnalytics | null
  timeframe?: TimeframeId
}

export interface TrendClassificationInput {
  row: TrendingPlayerRow
  signals: TrendDeterministicSignals
  snapshot: TrendSignalSnapshot
}

export interface TrendGameStatSample {
  sport: string
  season: number
  weekOrRound: number
  fantasyPoints: number | null
  normalizedStatMap: Record<string, number>
}

interface PlayerContext {
  displayName: string | null
  position: string | null
  team: string | null
}

interface TrendWindowMetrics {
  games: number
  fantasyPointsAvg: number | null
  usageAvg: number | null
  minutesOrShareAvg: number | null
  efficiencyAvg: number | null
}

const TIMEFRAME_WINDOW_SIZE: Record<'default' | TimeframeId, number> = {
  default: 4,
  '24h': 2,
  '7d': 4,
  '30d': 6,
}

const SPORT_USAGE_GROUPS: Record<string, ReadonlyArray<{ keys: readonly string[]; mode?: 'sum' | 'first' }>> = {
  NFL: [
    { keys: ['targets', 'target_share', 'rush_attempts', 'rushing_attempts', 'carries', 'touches'], mode: 'sum' },
    { keys: ['pass_attempts', 'passing_attempts'], mode: 'sum' },
    { keys: ['snap_share', 'snap_pct', 'offensive_snap_share'], mode: 'first' },
  ],
  NCAAF: [
    { keys: ['targets', 'target_share', 'rush_attempts', 'rushing_attempts', 'carries', 'touches'], mode: 'sum' },
    { keys: ['pass_attempts', 'passing_attempts'], mode: 'sum' },
    { keys: ['snap_share', 'snap_pct', 'offensive_snap_share'], mode: 'first' },
  ],
  NBA: [
    { keys: ['usage_rate'], mode: 'first' },
    { keys: ['fga', 'field_goal_attempts', '3pa', 'three_point_attempts', 'fta', 'free_throw_attempts'], mode: 'sum' },
    { keys: ['touches', 'possessions'], mode: 'first' },
  ],
  NCAAB: [
    { keys: ['usage_rate'], mode: 'first' },
    { keys: ['fga', 'field_goal_attempts', '3pa', 'three_point_attempts', 'fta', 'free_throw_attempts'], mode: 'sum' },
    { keys: ['touches', 'possessions'], mode: 'first' },
  ],
  MLB: [
    { keys: ['plate_appearances', 'pa', 'at_bats', 'ab'], mode: 'first' },
    { keys: ['innings_pitched', 'batters_faced'], mode: 'first' },
  ],
  NHL: [
    { keys: ['time_on_ice', 'toi'], mode: 'first' },
    { keys: ['shot_on_goal', 'shots', 'save', 'saves'], mode: 'sum' },
  ],
  SOCCER: [
    { keys: ['touches'], mode: 'first' },
    { keys: ['shot', 'shots', 'shot_on_target', 'key_pass', 'key_passes', 'cross'], mode: 'sum' },
    { keys: ['minutes_played', 'minutes', 'mins'], mode: 'first' },
  ],
}

const SPORT_PARTICIPATION_GROUPS: Record<string, ReadonlyArray<{ keys: readonly string[]; mode?: 'sum' | 'first' }>> = {
  NFL: [
    { keys: ['snap_share', 'snap_pct', 'offensive_snap_share', 'route_participation'], mode: 'first' },
    { keys: ['snap_count', 'snaps'], mode: 'first' },
  ],
  NCAAF: [
    { keys: ['snap_share', 'snap_pct', 'offensive_snap_share', 'route_participation'], mode: 'first' },
    { keys: ['snap_count', 'snaps'], mode: 'first' },
  ],
  NBA: [
    { keys: ['minutes_played', 'minutes', 'mins'], mode: 'first' },
  ],
  NCAAB: [
    { keys: ['minutes_played', 'minutes', 'mins'], mode: 'first' },
  ],
  MLB: [
    { keys: ['innings_pitched'], mode: 'first' },
    { keys: ['plate_appearances', 'pa'], mode: 'first' },
  ],
  NHL: [
    { keys: ['time_on_ice', 'toi'], mode: 'first' },
  ],
  SOCCER: [
    { keys: ['minutes_played', 'minutes', 'mins'], mode: 'first' },
  ],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits))
}

function average(values: Array<number | null | undefined>, digits: number = 2): number | null {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (usable.length === 0) return null
  return roundTo(usable.reduce((sum, value) => sum + value, 0) / usable.length, digits)
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['`]/g, "'")
    .replace(/[^a-z0-9' .-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function coerceStatMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      out[key] = rawValue
      continue
    }
    if (typeof rawValue === 'string') {
      const parsed = Number.parseFloat(rawValue)
      if (Number.isFinite(parsed)) out[key] = parsed
    }
  }
  return out
}

function getWindowSize(timeframe?: TimeframeId): number {
  return timeframe ? TIMEFRAME_WINDOW_SIZE[timeframe] : TIMEFRAME_WINDOW_SIZE.default
}

function resolveMetricFromGroups(
  statMap: Record<string, number>,
  groups: ReadonlyArray<{ keys: readonly string[]; mode?: 'sum' | 'first' }>
): { value: number | null; key: string | null } {
  for (const group of groups) {
    const matches = group.keys.filter((key) => typeof statMap[key] === 'number' && Number.isFinite(statMap[key]))
    if (matches.length === 0) continue
    if (group.mode === 'first') {
      return { value: statMap[matches[0]], key: matches[0] }
    }
    const sum = matches.reduce((total, key) => total + statMap[key], 0)
    return { value: sum, key: matches[0] }
  }
  return { value: null, key: null }
}

function normalizeParticipationValue(sport: string, key: string | null, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const metricKey = (key ?? '').toLowerCase()
  if (metricKey.includes('share') || metricKey.includes('pct') || metricKey.includes('participation')) {
    return roundTo(clamp(value > 1 ? value / 100 : value, 0, 1), 3)
  }
  if (sport === 'NBA') return roundTo(clamp(value / 36, 0, 1), 3)
  if (sport === 'NCAAB') return roundTo(clamp(value / 40, 0, 1), 3)
  if (sport === 'SOCCER') return roundTo(clamp(value / 90, 0, 1), 3)
  if (sport === 'NHL') return roundTo(clamp(value / 30, 0, 1), 3)
  if (sport === 'MLB') {
    if (metricKey.includes('innings')) return roundTo(clamp(value / 9, 0, 1), 3)
    return roundTo(clamp(value / 5, 0, 1), 3)
  }
  return roundTo(clamp(value > 1 ? value / 100 : value, 0, 1), 3)
}

function resolveUsageMetric(sport: string, statMap: Record<string, number>): number | null {
  const groups = SPORT_USAGE_GROUPS[sport] ?? []
  const { value, key } = resolveMetricFromGroups(statMap, groups)
  if (value == null) return null
  if (key === 'usage_rate') return roundTo(value > 1 ? value / 100 : value, 3)
  return roundTo(value, 2)
}

function resolveParticipationMetric(sport: string, statMap: Record<string, number>): number | null {
  const groups = SPORT_PARTICIPATION_GROUPS[sport] ?? []
  const { value, key } = resolveMetricFromGroups(statMap, groups)
  return normalizeParticipationValue(sport, key, value)
}

function resolveEfficiencyMetric(
  fantasyPoints: number | null,
  usageValue: number | null,
  minutesOrShare: number | null
): number | null {
  if (fantasyPoints == null || !Number.isFinite(fantasyPoints)) return null
  if (usageValue != null && usageValue > 0) {
    const scaled = usageValue <= 1 ? fantasyPoints / usageValue : (fantasyPoints / usageValue) * 10
    return roundTo(clamp(scaled, 0, 100), 2)
  }
  if (minutesOrShare != null && minutesOrShare > 0) {
    return roundTo(clamp((fantasyPoints / minutesOrShare) / 3, 0, 100), 2)
  }
  return null
}

function sortStatsDescending(stats: TrendGameStatSample[]): TrendGameStatSample[] {
  return [...stats].sort((a, b) => {
    if (b.season !== a.season) return b.season - a.season
    return b.weekOrRound - a.weekOrRound
  })
}

function aggregateWindowMetrics(sport: string, stats: TrendGameStatSample[]): TrendWindowMetrics {
  const fantasyPoints = stats.map((row) => row.fantasyPoints)
  const usageValues = stats.map((row) => resolveUsageMetric(sport, row.normalizedStatMap))
  const shareValues = stats.map((row) => resolveParticipationMetric(sport, row.normalizedStatMap))
  const efficiencyValues = stats.map((row, index) =>
    resolveEfficiencyMetric(fantasyPoints[index], usageValues[index], shareValues[index])
  )
  return {
    games: stats.length,
    fantasyPointsAvg: average(fantasyPoints),
    usageAvg: average(usageValues, 3),
    minutesOrShareAvg: average(shareValues, 3),
    efficiencyAvg: average(efficiencyValues),
  }
}

export function buildTrendSignalSnapshot({
  row,
  previousTrendScore,
  stats,
  analytics,
  timeframe,
}: TrendFeedProfileInput): TrendSignalSnapshot {
  const windowSize = getWindowSize(timeframe)
  const sortedStats = sortStatsDescending(stats)
  const recentWindow = sortedStats.slice(0, windowSize)
  const priorWindow = sortedStats.slice(windowSize, windowSize * 2)
  const recent = aggregateWindowMetrics(row.sport, recentWindow)
  const prior = aggregateWindowMetrics(row.sport, priorWindow)
  const performanceFallback =
    previousTrendScore != null && Number.isFinite(previousTrendScore)
      ? roundTo(row.trendScore - previousTrendScore)
      : null

  const seasonFantasyPointsPerGame = analytics?.fantasyPointsPerGame ?? null
  const expectedFantasyPointsPerGame = analytics?.expectedFantasyPointsPerGame ?? null
  const recentFantasyPointsAvg =
    recent.fantasyPointsAvg ??
    seasonFantasyPointsPerGame ??
    (performanceFallback != null ? roundTo(row.trendScore / 4) : null)
  const priorFantasyPointsAvg =
    prior.fantasyPointsAvg ??
    expectedFantasyPointsPerGame ??
    (recentFantasyPointsAvg != null && performanceFallback != null
      ? roundTo(recentFantasyPointsAvg - performanceFallback)
      : null)
  const recentUsageValue = recent.usageAvg ?? roundTo(Math.max(row.addRate - row.dropRate, 0), 3)
  const priorUsageValue =
    prior.usageAvg ??
    (recentUsageValue != null && Math.abs(row.addRate - row.dropRate) > 0
      ? roundTo(Math.max(recentUsageValue - (row.addRate - row.dropRate), 0), 3)
      : null)
  const recentMinutesOrShare = recent.minutesOrShareAvg ?? roundTo(clamp(row.lineupStartRate, 0, 1), 3)
  const priorMinutesOrShare =
    prior.minutesOrShareAvg ??
    (recentMinutesOrShare != null && row.lineupStartRate > 0
      ? roundTo(clamp(recentMinutesOrShare - (row.lineupStartRate - recentMinutesOrShare), 0, 1), 3)
      : null)
  const recentEfficiency =
    recent.efficiencyAvg ??
    resolveEfficiencyMetric(recentFantasyPointsAvg, recentUsageValue, recentMinutesOrShare) ??
    roundTo(row.trendScore)
  const priorEfficiency =
    prior.efficiencyAvg ??
    resolveEfficiencyMetric(priorFantasyPointsAvg, priorUsageValue, priorMinutesOrShare) ??
    (recentEfficiency != null && performanceFallback != null ? roundTo(recentEfficiency - performanceFallback) : null)
  const expectedGap =
    recentFantasyPointsAvg != null && expectedFantasyPointsPerGame != null
      ? roundTo(recentFantasyPointsAvg - expectedFantasyPointsPerGame)
      : null

  return {
    dataSource:
      recentWindow.length > 0
        ? 'game_stats'
        : analytics
          ? 'analytics_snapshot'
          : 'trend_baseline',
    recentGamesSample: recent.games,
    priorGamesSample: prior.games,
    recentFantasyPointsAvg,
    priorFantasyPointsAvg,
    recentUsageValue,
    priorUsageValue,
    recentMinutesOrShare,
    priorMinutesOrShare,
    recentEfficiency,
    priorEfficiency,
    expectedFantasyPointsPerGame,
    seasonFantasyPointsPerGame,
    expectedGap,
    weeklyVolatility: analytics?.weeklyVolatility ?? null,
    breakoutRating: analytics?.college.breakoutRating ?? null,
    currentAdpTrend: analytics?.draft.currentAdpTrend ?? null,
  }
}

export function buildTrendDeterministicSignals({
  row,
  previousTrendScore,
  stats,
  analytics,
  timeframe,
}: TrendFeedProfileInput): TrendDeterministicSignals {
  const snapshot = buildTrendSignalSnapshot({
    row,
    previousTrendScore,
    stats,
    analytics,
    timeframe,
  })
  const performanceDelta =
    snapshot.recentFantasyPointsAvg != null && snapshot.priorFantasyPointsAvg != null
      ? roundTo(snapshot.recentFantasyPointsAvg - snapshot.priorFantasyPointsAvg)
      : previousTrendScore != null && Number.isFinite(previousTrendScore)
        ? roundTo(row.trendScore - previousTrendScore)
        : null
  const usageChange =
    snapshot.recentUsageValue != null && snapshot.priorUsageValue != null
      ? roundTo(snapshot.recentUsageValue - snapshot.priorUsageValue, 3)
      : roundTo(row.addRate - row.dropRate, 3)
  const minutesOrSnapShare = roundTo(
    clamp(snapshot.recentMinutesOrShare ?? row.lineupStartRate ?? 0, 0, 1),
    3
  )
  const efficiencyScore = roundTo(snapshot.recentEfficiency ?? row.trendScore)
  const volumeChange =
    snapshot.recentMinutesOrShare != null && snapshot.priorMinutesOrShare != null
      ? roundTo(snapshot.recentMinutesOrShare - snapshot.priorMinutesOrShare, 3)
      : null
  const efficiencyDelta =
    snapshot.recentEfficiency != null && snapshot.priorEfficiency != null
      ? roundTo(snapshot.recentEfficiency - snapshot.priorEfficiency)
      : null
  const sampleCoverage = clamp(
    (snapshot.recentGamesSample + snapshot.priorGamesSample) / Math.max(getWindowSize(timeframe) * 2, 1),
    0,
    1
  )
  const dataCoverage =
    [
      performanceDelta != null,
      snapshot.recentUsageValue != null,
      snapshot.recentMinutesOrShare != null,
      snapshot.recentEfficiency != null,
      snapshot.expectedFantasyPointsPerGame != null || snapshot.seasonFantasyPointsPerGame != null,
    ].filter(Boolean).length / 5
  const confidence = roundTo(clamp(0.3 + sampleCoverage * 0.35 + dataCoverage * 0.35, 0.35, 0.98), 2)

  const performanceComponent = Math.min(28, Math.abs(performanceDelta ?? 0) * 2.4)
  const usageComponent = Math.min(18, Math.abs(usageChange) * 20)
  const participationComponent = Math.min(14, minutesOrSnapShare * 18)
  const efficiencyComponent = Math.min(20, Math.abs(efficiencyDelta ?? 0) * 1.6 + efficiencyScore / 8)
  const marketComponent = Math.min(
    18,
    (row.addRate + row.tradeInterest + row.draftFrequency + row.lineupStartRate) * 8
  )
  const injuryPenalty = Math.min(10, row.injuryImpact * 12)
  const signalStrength = roundTo(
    clamp(
      performanceComponent + usageComponent + participationComponent + efficiencyComponent + marketComponent - injuryPenalty,
      0,
      100
    ),
    1
  )

  return {
    performanceDelta,
    usageChange,
    minutesOrSnapShare,
    efficiencyScore,
    volumeChange,
    efficiencyDelta,
    confidence,
    signalStrength,
  }
}

export function classifyTrendFeedType({
  row,
  signals,
  snapshot,
}: TrendClassificationInput): TrendFeedType {
  const performanceDelta = signals.performanceDelta ?? 0
  const usageChange = signals.usageChange
  const volumeChange = signals.volumeChange ?? 0
  const expectedGap = snapshot.expectedGap ?? 0
  const breakoutRating = snapshot.breakoutRating ?? 0
  const tradeHeat = row.tradeInterest

  const looksCold =
    row.trendingDirection === 'Cold' ||
    row.trendingDirection === 'Falling' ||
    performanceDelta <= -2.5 ||
    (usageChange <= -0.18 && signals.minutesOrSnapShare <= 0.58) ||
    (signals.efficiencyDelta ?? 0) <= -3
  if (looksCold) return 'cold_streak'

  const looksSellHigh =
    (row.trendingDirection === 'Hot' || row.trendScore >= 70) &&
    performanceDelta >= 2.5 &&
    tradeHeat >= 0.15 &&
    (expectedGap >= 2.5 || usageChange <= 0.08 || volumeChange <= 0.02)
  if (looksSellHigh) return 'sell_high_candidate'

  const looksBreakout =
    (row.trendingDirection === 'Rising' || row.trendingDirection === 'Hot') &&
    performanceDelta >= 1.5 &&
    (usageChange >= 0.12 || volumeChange >= 0.04 || breakoutRating >= 0.55 || row.addRate >= 0.45)
  if (looksBreakout) return 'breakout_candidate'

  return 'hot_streak'
}

function buildTrendSummary(input: {
  row: TrendingPlayerRow
  item: Pick<TrendFeedItem, 'displayName' | 'team' | 'position'>
  trendType: TrendFeedType
  signals: TrendDeterministicSignals
  snapshot: TrendSignalSnapshot
}): TrendSummary {
  const { row, item, trendType, signals, snapshot } = input
  const playerLabel = item.displayName ?? input.row.playerId
  const usageText =
    signals.usageChange >= 0
      ? `usage is up ${signals.usageChange.toFixed(2)}`
      : `usage is down ${Math.abs(signals.usageChange).toFixed(2)}`
  const performanceText =
    signals.performanceDelta != null
      ? `recent production moved ${signals.performanceDelta >= 0 ? 'up' : 'down'} ${Math.abs(signals.performanceDelta).toFixed(1)} fantasy points`
      : `trend score sits at ${row.trendScore.toFixed(1)}`
  const shareText = `${Math.round(signals.minutesOrSnapShare * 100)}% role share`

  if (trendType === 'sell_high_candidate') {
    return {
      headline: `${playerLabel} is producing ahead of the underlying opportunity`,
      rationale: `${performanceText}, but ${usageText} and trade interest is elevated enough to consider a market exit.`,
      recommendation: `Shop ${playerLabel} while the narrative is still hot, especially if you can trade current output for steadier weekly volume.`,
    }
  }

  if (trendType === 'breakout_candidate') {
    return {
      headline: `${playerLabel} has the ingredients of a real breakout`,
      rationale: `${performanceText}, ${usageText}, and the current profile now carries ${shareText}.`,
      recommendation: `Lean into ${playerLabel} before the role fully prices in, especially in formats where opportunity growth matters most.`,
    }
  }

  if (trendType === 'cold_streak') {
    return {
      headline: `${playerLabel} is sliding the wrong way`,
      rationale: `${performanceText}, ${usageText}, and the recent workload has settled around ${shareText}.`,
      recommendation: `Treat ${playerLabel} as a matchup-dependent hold until the volume or efficiency stabilizes.`,
    }
  }

  const expectedGapText =
    snapshot.expectedGap != null
      ? `${snapshot.expectedGap >= 0 ? '+' : ''}${snapshot.expectedGap.toFixed(1)} versus expected fantasy output`
      : `${signals.efficiencyScore.toFixed(1)} efficiency score`
  return {
    headline: `${playerLabel} is sustaining a hot stretch`,
    rationale: `${performanceText}, ${usageText}, and the profile is running ${expectedGapText}.`,
    recommendation: `Keep ${playerLabel} in active lineups while the workload and efficiency keep pointing in the same direction.`,
  }
}

async function resolvePlayerContext(rows: TrendingPlayerRow[]): Promise<Map<string, PlayerContext>> {
  if (rows.length === 0) return new Map()
  const players = await prisma.player.findMany({
    where: {
      OR: rows.map((row) => ({
        id: row.playerId,
        sport: row.sport,
      })),
    },
    select: {
      id: true,
      sport: true,
      name: true,
      position: true,
      team: true,
    },
  })
  const map = new Map<string, PlayerContext>()
  for (const player of players) {
    map.set(`${player.id}:${player.sport}`, {
      displayName: player.name ?? null,
      position: player.position ?? null,
      team: player.team ?? null,
    })
  }
  return map
}

async function getPreviousScores(rows: TrendingPlayerRow[]): Promise<Map<string, number | null>> {
  if (rows.length === 0) return new Map()
  const records = await prisma.playerMetaTrend.findMany({
    where: {
      OR: rows.map((row) => ({
        playerId: row.playerId,
        sport: row.sport,
      })),
    },
    select: {
      playerId: true,
      sport: true,
      previousTrendScore: true,
    },
  })
  const map = new Map<string, number | null>()
  for (const record of records) {
    map.set(`${record.playerId}:${record.sport}`, record.previousTrendScore ?? null)
  }
  return map
}

async function getGameStats(rows: TrendingPlayerRow[]): Promise<Map<string, TrendGameStatSample[]>> {
  if (rows.length === 0) return new Map()
  const stats = await prisma.playerGameStat.findMany({
    where: {
      OR: rows.map((row) => ({
        playerId: row.playerId,
        sportType: row.sport,
      })),
    },
    select: {
      playerId: true,
      sportType: true,
      season: true,
      weekOrRound: true,
      fantasyPoints: true,
      normalizedStatMap: true,
    },
    orderBy: [{ season: 'desc' }, { weekOrRound: 'desc' }],
  })
  const map = new Map<string, TrendGameStatSample[]>()
  for (const stat of stats) {
    const key = `${stat.playerId}:${stat.sportType}`
    const list = map.get(key) ?? []
    list.push({
      sport: stat.sportType,
      season: stat.season,
      weekOrRound: stat.weekOrRound,
      fantasyPoints: typeof stat.fantasyPoints === 'number' ? stat.fantasyPoints : null,
      normalizedStatMap: coerceStatMap(stat.normalizedStatMap),
    })
    map.set(key, list)
  }
  return map
}

async function getAnalyticsByPlayerKey(
  contextMap: Map<string, PlayerContext>
): Promise<Map<string, PlayerAnalytics>> {
  const names = [...new Set(
    [...contextMap.values()]
      .map((context) => context.displayName?.trim())
      .filter((name): name is string => Boolean(name))
  )]
  if (names.length === 0) return new Map()
  const batch = await getPlayerAnalyticsBatch(names)
  /*
   * `batch` is keyed by DISPLAY name and this re-keys by normalized name, so two distinct
   * display names can collapse onto one key ("A.J. Brown" and "AJ Brown"). Refuse rather
   * than let the later one win.
   */
  const normalizedEntries = buildNameIndex(
    [...batch.entries()],
    ([name]) => normalizeName(name),
  )
  const byPlayerKey = new Map<string, PlayerAnalytics>()
  for (const [playerKey, context] of contextMap.entries()) {
    const displayName = context.displayName?.trim()
    if (!displayName) continue
    const entry = normalizedEntries.get(normalizeName(displayName))
    if (entry) byPlayerKey.set(playerKey, entry[1])
  }
  return byPlayerKey
}

function dedupeRows(rows: TrendingPlayerRow[]): TrendingPlayerRow[] {
  const map = new Map<string, TrendingPlayerRow>()
  for (const row of rows) {
    map.set(`${row.playerId}:${row.sport}`, row)
  }
  return [...map.values()]
}

function sortFeedItems(items: TrendFeedItem[]): TrendFeedItem[] {
  return [...items].sort((a, b) => {
    if (b.signals.signalStrength !== a.signals.signalStrength) {
      return b.signals.signalStrength - a.signals.signalStrength
    }
    return b.trendScore - a.trendScore
  })
}

async function buildFeedItems(rows: TrendingPlayerRow[], timeframe?: TimeframeId): Promise<TrendFeedItem[]> {
  if (rows.length === 0) return []
  const [contextMap, previousScores, gameStats] = await Promise.all([
    resolvePlayerContext(rows),
    getPreviousScores(rows),
    getGameStats(rows),
  ])
  const analyticsByPlayerKey = await getAnalyticsByPlayerKey(contextMap)

  return rows.map((row) => {
    const key = `${row.playerId}:${row.sport}`
    const playerContext = contextMap.get(key) ?? {
      displayName: null,
      position: null,
      team: null,
    }
    const previousTrendScore = previousScores.get(key) ?? null
    const analytics = analyticsByPlayerKey.get(key) ?? null
    const stats = gameStats.get(key) ?? []
    const snapshot = buildTrendSignalSnapshot({
      row,
      previousTrendScore,
      stats,
      analytics,
      timeframe,
    })
    const signals = buildTrendDeterministicSignals({
      row,
      previousTrendScore,
      stats,
      analytics,
      timeframe,
    })
    const trendType = classifyTrendFeedType({
      row,
      signals,
      snapshot,
    })
    const summary = buildTrendSummary({
      row,
      item: {
        displayName: playerContext.displayName,
        position: playerContext.position,
        team: playerContext.team,
      },
      trendType,
      signals,
      snapshot,
    })

    return {
      trendType,
      playerId: row.playerId,
      sport: row.sport,
      displayName: playerContext.displayName,
      position: playerContext.position ?? analytics?.position ?? null,
      team: playerContext.team ?? analytics?.currentTeam ?? null,
      signals,
      snapshot,
      summary,
      trendScore: row.trendScore,
      direction: row.trendingDirection,
      updatedAt: row.updatedAt.toISOString(),
    }
  })
}

/**
 * Fetch full trend feed: hot_streak, cold_streak, breakout_candidate, sell_high_candidate
 * with deterministic signals and summary overlays. Sport filter uses sport-scope.
 */
export async function getTrendFeed(options: TrendFeedOptions = {}): Promise<TrendFeedItem[]> {
  const {
    sport,
    timeframe,
    limitPerType = 25,
    limit = 80,
  } = options

  const sportFilter = sport && (SUPPORTED_SPORTS as readonly string[]).includes(sport) ? sport : undefined
  const analyzerLimit = Math.max(limitPerType * 2, 20)
  const analyzerOptions = { sport: sportFilter, timeframe, limit: analyzerLimit }

  const [hotRows, risingRows, fallingRows, coldRows] = await Promise.all([
    getTrendingByDirection('Hot', analyzerOptions),
    getTrendingByDirection('Rising', analyzerOptions),
    getTrendingByDirection('Falling', analyzerOptions),
    getTrendingByDirection('Cold', analyzerOptions),
  ])

  const dedupedRows = dedupeRows([
    ...hotRows,
    ...risingRows,
    ...fallingRows,
    ...coldRows,
  ])
  const feedItems = await buildFeedItems(dedupedRows, timeframe)
  const buckets: Record<TrendFeedType, TrendFeedItem[]> = {
    hot_streak: [],
    cold_streak: [],
    breakout_candidate: [],
    sell_high_candidate: [],
  }

  for (const item of sortFeedItems(feedItems)) {
    const bucket = buckets[item.trendType]
    if (bucket.length >= limitPerType) continue
    bucket.push(item)
  }

  return sortFeedItems([
    ...buckets.hot_streak,
    ...buckets.breakout_candidate,
    ...buckets.sell_high_candidate,
    ...buckets.cold_streak,
  ]).slice(0, limit)
}

/**
 * Get supported sports for the trend feed (from sport-scope).
 */
export function getTrendFeedSupportedSports(): readonly string[] {
  return SUPPORTED_SPORTS
}

/**
 * Get a single feed item for a player/sport (for AI insight endpoint).
 */
export async function getTrendFeedItemForPlayer(
  playerId: string,
  sport: string
): Promise<TrendFeedItem | null> {
  const metaTrend = await prisma.playerMetaTrend.findUnique({
    where: { uniq_player_meta_trend_player_sport: { playerId, sport } },
    select: {
      playerId: true,
      sport: true,
      trendScore: true,
      trendingDirection: true,
      addRate: true,
      dropRate: true,
      tradeInterest: true,
      draftFrequency: true,
      lineupStartRate: true,
      injuryImpact: true,
      updatedAt: true,
      previousTrendScore: true,
    },
  })
  if (!metaTrend) return null

  const trendingRow: TrendingPlayerRow = {
    playerId: metaTrend.playerId,
    sport: metaTrend.sport,
    trendScore: metaTrend.trendScore,
    trendingDirection: metaTrend.trendingDirection as TrendingPlayerRow['trendingDirection'],
    addRate: metaTrend.addRate,
    dropRate: metaTrend.dropRate,
    tradeInterest: metaTrend.tradeInterest,
    draftFrequency: metaTrend.draftFrequency,
    lineupStartRate: metaTrend.lineupStartRate,
    injuryImpact: metaTrend.injuryImpact,
    updatedAt: metaTrend.updatedAt,
  }

  const [contextMap, gameStats] = await Promise.all([
    resolvePlayerContext([trendingRow]),
    getGameStats([trendingRow]),
  ])
  const analyticsByPlayerKey = await getAnalyticsByPlayerKey(contextMap)
  const key = `${playerId}:${sport}`
  const context = contextMap.get(key) ?? {
    displayName: null,
    position: null,
    team: null,
  }
  const analytics = analyticsByPlayerKey.get(key) ?? null
  const stats = gameStats.get(key) ?? []
  const snapshot = buildTrendSignalSnapshot({
    row: trendingRow,
    previousTrendScore: metaTrend.previousTrendScore ?? null,
    stats,
    analytics,
  })
  const signals = buildTrendDeterministicSignals({
    row: trendingRow,
    previousTrendScore: metaTrend.previousTrendScore ?? null,
    stats,
    analytics,
  })
  const trendType = classifyTrendFeedType({
    row: trendingRow,
    signals,
    snapshot,
  })

  return {
    trendType,
    playerId,
    sport,
    displayName: context.displayName,
    position: context.position ?? analytics?.position ?? null,
    team: context.team ?? analytics?.currentTeam ?? null,
    signals,
    snapshot,
    summary: buildTrendSummary({
      row: trendingRow,
      item: {
        displayName: context.displayName,
        position: context.position,
        team: context.team,
      },
      trendType,
      signals,
      snapshot,
    }),
    trendScore: metaTrend.trendScore,
    direction: metaTrend.trendingDirection,
    updatedAt: metaTrend.updatedAt.toISOString(),
  }
}
