import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { getTeamLogo } from '@/lib/players/getTeamLogo'
import { normalizePosition, normalizeTeamAbbrev } from '@/lib/team-abbrev'

export const NFL_REDRAFT_CANONICAL_PLAYER_MODEL_VERSION = 'nfl-redraft-player-v1' as const

export type NflRedraftDataState = 'available' | 'missing' | 'stale' | 'unknown'

export type NflRedraftProviderIds = {
  allFantasyId: string
  providerPlayerId: string | null
  sleeperId: string | null
  espnId: string | null
  yahooId: string | null
  gsisId: string | null
  sportradarId: string | null
  fantasyCalcId: string | null
  rollingInsightsId: string | null
}

export type NflRedraftMediaFallbackKind =
  | 'none'
  | 'player-silhouette'
  | 'team-badge'
  | 'team-text-badge'

export type NflRedraftMediaAsset = {
  url: string | null
  source: string | null
  fallbackKind: NflRedraftMediaFallbackKind
  safeToRenderImage: boolean
}

export type NflRedraftHistoricalSeason = {
  season: number | null
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  rank: number | null
  positionalRank: number | null
  source: string | null
  updatedAt: string | null
  stale: boolean
  statLines: {
    passingYards: number | null
    passingTouchdowns: number | null
    interceptions: number | null
    rushingYards: number | null
    rushingTouchdowns: number | null
    receivingYards: number | null
    receivingTouchdowns: number | null
    receptions: number | null
    fieldGoalsMade: number | null
    extraPointsMade: number | null
    sacks: number | null
    defensiveInterceptions: number | null
    fumblesRecovered: number | null
    defensiveTouchdowns: number | null
  }
}

export type NflRedraftProjectionSnapshot = {
  weeklyProjectedPoints: number | null
  seasonProjectedPoints: number | null
  restOfSeasonProjectedPoints: number | null
  floor: number | null
  ceiling: number | null
  scoringFormat: string | null
  rank: number | null
  positionalRank: number | null
  source: string | null
  updatedAt: string | null
  stale: boolean
  unavailable: boolean
}

export type NflRedraftInjurySnapshot = {
  designation: string | null
  practiceStatus: string | null
  gameStatus: string | null
  source: string | null
  updatedAt: string | null
  freshness: NflRedraftDataState
}

export type NflRedraftNewsSnapshot = {
  summary: string | null
  source: string | null
  updatedAt: string | null
  freshness: NflRedraftDataState
}

export type NflRedraftFallback = {
  field: string
  reason: string
  source: string | null
}

export type NflRedraftCanonicalPlayer = {
  modelVersion: typeof NFL_REDRAFT_CANONICAL_PLAYER_MODEL_VERSION
  playerId: string
  providerIds: NflRedraftProviderIds
  fullName: string
  displayName: string
  nflTeam: string | null
  teamId: string | null
  teamAbbr: string | null
  position: string | null
  fantasyPosition: string | null
  rosterEligibility: string[]
  jerseyNumber: number | null
  media: {
    headshot: NflRedraftMediaAsset
    teamLogo: NflRedraftMediaAsset
  }
  byeWeek: number | null
  injury: NflRedraftInjurySnapshot
  activeStatus: string | null
  depthChartRole: string | null
  depthChartRank: number | null
  age: number | null
  experience: {
    years: number | null
    label: string | null
    source: string | null
  }
  college: string | null
  historicalStats: {
    previousSeason: NflRedraftHistoricalSeason | null
    seasons: NflRedraftHistoricalSeason[]
  }
  previousSeasonFantasyPoints: number | null
  currentProjection: NflRedraftProjectionSnapshot
  adp: number | null
  rank: number | null
  positionalRank: number | null
  news: NflRedraftNewsSnapshot
  lastUpdatedAt: string | null
  dataFreshness: {
    profile: NflRedraftDataState
    media: NflRedraftDataState
    stats: NflRedraftDataState
    projections: NflRedraftDataState
    injury: NflRedraftDataState
    news: NflRedraftDataState
    missingFields: string[]
    staleWarnings: string[]
  }
  fallbacks: NflRedraftFallback[]
}

export type BuildNflRedraftCanonicalPlayerOptions = {
  teamLogoUrl?: string | null
  now?: Date
}

const STALE_HOURS = {
  stats: 24 * 7,
  projections: 24 * 3,
  injury: 24 * 2,
  news: 24 * 3,
}

const NFL_FANTASY_POSITIONS = new Set([
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
  'DL',
  'LB',
  'DB',
  'EDGE',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value != null)
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function integerValue(value: unknown): number | null {
  const n = numberValue(value)
  return n == null ? null : Math.trunc(n)
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const part of path.split('.')) {
    const record = asRecord(current)
    if (!(part in record)) return undefined
    current = record[part]
  }
  return current
}

function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = stringValue(readPath(source, path))
    if (value) return value
  }
  return null
}

function firstNumber(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = numberValue(readPath(source, path))
    if (value != null) return value
  }
  return null
}

function firstInteger(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = integerValue(readPath(source, path))
    if (value != null) return value
  }
  return null
}

function isoFromValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function firstIso(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = isoFromValue(readPath(source, path))
    if (value) return value
  }
  return null
}

function isStale(updatedAt: string | null, maxAgeHours: number, now: Date): boolean {
  if (!updatedAt) return false
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return false
  return now.getTime() - date.getTime() > maxAgeHours * 60 * 60 * 1000
}

function freshnessFor(valuePresent: boolean, updatedAt: string | null, maxAgeHours: number, now: Date): NflRedraftDataState {
  if (!valuePresent) return 'missing'
  if (!updatedAt) return 'unknown'
  return isStale(updatedAt, maxAgeHours, now) ? 'stale' : 'available'
}

function latestIso(values: Array<string | null>): string | null {
  const dates = values
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())))
  if (!dates.length) return null
  return new Date(Math.max(...dates.map((value) => value.getTime()))).toISOString()
}

function isLikelySleeperId(value: string | null): boolean {
  return Boolean(value && /^\d{3,}$/.test(value))
}

function firstArrayString(source: unknown, paths: string[]): string[] {
  for (const path of paths) {
    const value = readPath(source, path)
    if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
  }
  return []
}

function fantasyPosition(position: string | null): string | null {
  const normalized = normalizePosition(position)
  if (!normalized) return null
  if (normalized === 'DST') return 'DEF'
  if (NFL_FANTASY_POSITIONS.has(normalized)) return normalized
  if (['DE', 'DT', 'NT'].includes(normalized)) return 'DL'
  if (['CB', 'S', 'SS', 'FS', 'NB'].includes(normalized)) return 'DB'
  return normalized
}

function rosterEligibility(position: string | null, explicit: string[]): string[] {
  const pos = fantasyPosition(position)
  const base = uniq([pos, ...explicit.map((value) => normalizePosition(value))])
  const out = new Set(base)
  if (pos === 'DST') out.add('DEF')
  if (pos === 'DEF') out.add('DST')
  if (pos && ['RB', 'WR', 'TE'].includes(pos)) {
    out.add('FLEX')
    out.add('RB_WR_TE')
    out.add('SUPER_FLEX')
  }
  if (pos && ['WR', 'TE'].includes(pos)) out.add('WR_TE')
  if (pos === 'QB') out.add('SUPER_FLEX')
  if (pos && ['DL', 'LB', 'DB', 'EDGE'].includes(pos)) {
    out.add('IDP')
    out.add('FLEX_IDP')
  }
  return [...out]
}

function experienceLabel(years: number | null, rookie: boolean | null): string | null {
  if (years != null) return years === 0 ? 'Rookie' : `${years} YOE`
  if (rookie === true) return 'Rookie'
  return null
}

function statLinesFrom(source: unknown): NflRedraftHistoricalSeason['statLines'] {
  return {
    passingYards: firstNumber(source, ['passingYards', 'passYards', 'passing_yards', 'stats.passingYards']),
    passingTouchdowns: firstNumber(source, ['passingTouchdowns', 'passTouchdowns', 'passingTD', 'passing_tds', 'stats.passingTouchdowns']),
    interceptions: firstNumber(source, ['interceptions', 'passingInterceptions', 'ints', 'stats.interceptions']),
    rushingYards: firstNumber(source, ['rushingYards', 'rushYards', 'rushing_yards', 'stats.rushingYards']),
    rushingTouchdowns: firstNumber(source, ['rushingTouchdowns', 'rushTouchdowns', 'rushingTD', 'rushing_tds', 'stats.rushingTouchdowns']),
    receivingYards: firstNumber(source, ['receivingYards', 'recYards', 'receiving_yards', 'stats.receivingYards']),
    receivingTouchdowns: firstNumber(source, ['receivingTouchdowns', 'recTouchdowns', 'receivingTD', 'receiving_tds', 'stats.receivingTouchdowns']),
    receptions: firstNumber(source, ['receptions', 'rec', 'stats.receptions']),
    fieldGoalsMade: firstNumber(source, ['fieldGoalsMade', 'fgMade', 'fgm', 'stats.fieldGoalsMade']),
    extraPointsMade: firstNumber(source, ['extraPointsMade', 'xpm', 'stats.extraPointsMade']),
    sacks: firstNumber(source, ['sacks', 'defenseSacks', 'stats.sacks']),
    defensiveInterceptions: firstNumber(source, ['defensiveInterceptions', 'defInterceptions', 'defInts', 'stats.defensiveInterceptions']),
    fumblesRecovered: firstNumber(source, ['fumblesRecovered', 'defFumblesRecovered', 'stats.fumblesRecovered']),
    defensiveTouchdowns: firstNumber(source, ['defensiveTouchdowns', 'defTd', 'defensiveTD', 'stats.defensiveTouchdowns']),
  }
}

function hasAnyStatLine(lines: NflRedraftHistoricalSeason['statLines']): boolean {
  return Object.values(lines).some((value) => value != null)
}

function historicalSeasonFrom(source: unknown, fallbackSource: string | null, now: Date): NflRedraftHistoricalSeason | null {
  const record = asRecord(source)
  if (!Object.keys(record).length) return null
  const statLines = statLinesFrom(record)
  const season = firstInteger(record, ['season', 'year', 'seasonYear'])
  const gamesPlayed = firstNumber(record, ['gamesPlayed', 'games', 'gp'])
  const fantasyPoints = firstNumber(record, ['fantasyPoints', 'fantasyPointsSeason', 'fantasy_points', 'points'])
  const fantasyPointsPerGame = firstNumber(record, ['fantasyPointsPerGame', 'pointsPerGame', 'fppg'])
  const rank = firstInteger(record, ['rank', 'overallRank', 'seasonFinish'])
  const positionalRank = firstInteger(record, ['positionalRank', 'positionRank', 'posRank'])
  const updatedAt = firstIso(record, ['updatedAt', 'fetchedAt', 'lastUpdated', 'syncedAt'])
  if (
    season == null &&
    gamesPlayed == null &&
    fantasyPoints == null &&
    fantasyPointsPerGame == null &&
    rank == null &&
    positionalRank == null &&
    !hasAnyStatLine(statLines)
  ) {
    return null
  }
  return {
    season,
    gamesPlayed,
    fantasyPoints,
    fantasyPointsPerGame,
    rank,
    positionalRank,
    source: firstString(record, ['source', 'dataSource', 'provider']) ?? fallbackSource,
    updatedAt,
    stale: isStale(updatedAt, STALE_HOURS.stats, now),
    statLines,
  }
}

function historicalStats(stats: Record<string, unknown>, fallbackSource: string | null, now: Date): NflRedraftCanonicalPlayer['historicalStats'] {
  const cacheStats = asRecord(stats.cacheStats)
  const directPrevious =
    historicalSeasonFrom(cacheStats.previousSeason, fallbackSource, now) ??
    historicalSeasonFrom(stats.previousSeason, fallbackSource, now) ??
    historicalSeasonFrom(cacheStats.seasonStats, fallbackSource, now) ??
    historicalSeasonFrom(cacheStats, fallbackSource, now) ??
    historicalSeasonFrom(stats, fallbackSource, now)
  const seasonRows = [
    ...asArray(cacheStats.seasons),
    ...asArray(cacheStats.history),
    ...asArray(stats.seasons),
    ...asArray(stats.history),
  ]
    .map((row) => historicalSeasonFrom(row, fallbackSource, now))
    .filter((row): row is NflRedraftHistoricalSeason => Boolean(row))
  const seasons = directPrevious
    ? [directPrevious, ...seasonRows.filter((row) => row.season !== directPrevious.season)]
    : seasonRows
  return {
    previousSeason: directPrevious,
    seasons,
  }
}

function projectionSnapshot(
  projectedPoints: number | null,
  normalizedProjections: Record<string, unknown>,
  source: string | null,
  now: Date,
): NflRedraftProjectionSnapshot {
  const cache = asRecord(normalizedProjections.cacheProjections)
  const merged = { ...normalizedProjections, ...cache }
  const updatedAt = firstIso(merged, ['updatedAt', 'fetchedAt', 'generatedAt', 'computedAt', 'lastUpdated'])
  const weekly =
    firstNumber(merged, [
      'weeklyProjectedPoints',
      'weeklyProjection',
      'projectedPointsPerGame',
      'nflDraftProjectionSplits.projectedPointsPerGame',
      'pprProjection',
      'halfPprProjection',
      'fantasyPointsWeekly',
      'weekProjection',
      'projectedPoints',
    ]) ?? projectedPoints
  const season = firstNumber(merged, [
    'seasonProjectedPoints',
    'seasonProjection',
    'projectedSeasonPoints',
    'projectedPointsSeason',
    'nflDraftProjectionSplits.projectedPoints',
  ])
  const restOfSeason = firstNumber(merged, ['restOfSeasonProjectedPoints', 'restOfSeason', 'rosProjection', 'remainingProjectedPoints'])
  return {
    weeklyProjectedPoints: weekly,
    seasonProjectedPoints: season,
    restOfSeasonProjectedPoints: restOfSeason,
    floor: firstNumber(merged, ['floor', 'floorProjection']),
    ceiling: firstNumber(merged, ['ceiling', 'ceilingProjection']),
    scoringFormat: firstString(merged, ['scoringFormat', 'scoring', 'format']),
    rank: firstInteger(merged, ['rank', 'overallRank']),
    positionalRank: firstInteger(merged, ['positionalRank', 'positionRank', 'posRank']),
    source: firstString(merged, ['source', 'projectionSource', 'provider']) ?? source,
    updatedAt,
    stale: isStale(updatedAt, STALE_HOURS.projections, now),
    unavailable: weekly == null && season == null && restOfSeason == null,
  }
}

function newsSnapshot(stats: Record<string, unknown>, projections: Record<string, unknown>, profileSource: string | null, now: Date): NflRedraftNewsSnapshot {
  const cacheStats = asRecord(stats.cacheStats)
  const cacheProjections = asRecord(projections.cacheProjections)
  const merged = { ...stats, ...cacheStats, ...projections, ...cacheProjections }
  const summary = firstString(merged, ['newsSummary', 'latestNews', 'news', 'headline', 'note', 'statusNote'])
  const updatedAt = firstIso(merged, ['newsUpdatedAt', 'publishedAt', 'timestamp', 'updatedAt', 'fetchedAt'])
  return {
    summary,
    source: summary ? firstString(merged, ['newsSource', 'source', 'provider']) ?? profileSource : null,
    updatedAt,
    freshness: freshnessFor(Boolean(summary), updatedAt, STALE_HOURS.news, now),
  }
}

function activeStatusFrom(rawStatus: string | null, injuryStatus: string | null): string | null {
  const status = stringValue(rawStatus)
  if (status) return status
  const injury = String(injuryStatus ?? '').trim().toLowerCase()
  if (!injury) return null
  if (injury.includes('out') || injury.includes('ir') || injury.includes('inactive')) return 'inactive'
  return 'active'
}

function depthRankFrom(source: unknown): number | null {
  return firstInteger(source, [
    'depthChartRank',
    'depthRank',
    'depth_chart_rank',
    'cacheStats.depthChartRank',
    'cacheProjections.depthChartRank',
  ])
}

function sourceObject(view: UnifiedPlayerProductView): Record<string, unknown> {
  return {
    ...asRecord(view),
    metadata: asRecord(view.display?.metadata),
    displayMetadata: asRecord(view.display?.metadata),
    stats: view.unified.normalizedStats,
    projections: view.unified.normalizedProjections,
    cacheStats: asRecord(view.unified.normalizedStats.cacheStats),
    cacheProjections: asRecord(view.unified.normalizedProjections.cacheProjections),
  }
}

function providerIds(view: UnifiedPlayerProductView, source: Record<string, unknown>): NflRedraftProviderIds {
  const allFantasyId = view.unified.playerId
  const providerPlayerId =
    view.unified.providerPlayerId ??
    firstString(source, ['providerPlayerId', 'externalSourceId', 'externalId', 'metadata.externalSourceId'])
  const sleeperId =
    firstString(source, ['sleeperId', 'sleeper_id', 'metadata.sleeperId', 'metadata.sleeper_id']) ??
    (isLikelySleeperId(providerPlayerId) ? providerPlayerId : null) ??
    (isLikelySleeperId(allFantasyId) ? allFantasyId : null)
  return {
    allFantasyId,
    providerPlayerId,
    sleeperId,
    espnId: firstString(source, ['espnId', 'espn_id', 'metadata.espnId', 'metadata.espn_id']),
    yahooId: firstString(source, ['yahooId', 'yahoo_id', 'metadata.yahooId', 'metadata.yahoo_id']),
    gsisId: firstString(source, ['gsisId', 'gsis_id', 'metadata.gsisId', 'metadata.gsis_id']),
    sportradarId: firstString(source, ['sportradarId', 'sportradar_id', 'metadata.sportradarId']),
    fantasyCalcId: firstString(source, ['fantasyCalcId', 'fantasycalcId', 'fantasy_calc_id', 'metadata.fantasyCalcId']),
    rollingInsightsId: firstString(source, ['rollingInsightsId', 'rolling_insights_id', 'metadata.rollingInsightsId']),
  }
}

function mediaAsset(args: {
  url: string | null
  source: string | null
  fallbackKind: NflRedraftMediaFallbackKind
}): NflRedraftMediaAsset {
  return {
    url: args.url,
    source: args.source,
    fallbackKind: args.url ? 'none' : args.fallbackKind,
    safeToRenderImage: Boolean(args.url && /^https?:\/\//i.test(args.url)),
  }
}

function pushFallback(fallbacks: NflRedraftFallback[], field: string, reason: string, source: string | null): void {
  fallbacks.push({ field, reason, source })
}

export function buildNflRedraftCanonicalPlayer(
  view: UnifiedPlayerProductView,
  options?: BuildNflRedraftCanonicalPlayerOptions,
): NflRedraftCanonicalPlayer | null {
  if (String(view.unified.sport).toUpperCase() !== 'NFL') return null

  const now = options?.now ?? new Date()
  const source = sourceObject(view)
  const u = view.unified
  const position = fantasyPosition(u.position)
  const teamAbbr = normalizeTeamAbbrev(u.teamAbbr ?? u.team)
  const teamLogoUrl =
    options?.teamLogoUrl ??
    firstString(source, ['metadata.teamLogoUrl', 'display.assets.teamLogoUrl']) ??
    getTeamLogo(teamAbbr ?? u.team, 'NFL')
  const explicitEligibility = firstArrayString(source, [
    'metadata.positionEligibility',
    'displayMetadata.positionEligibility',
    'positionEligibility',
    'eligiblePositions',
  ])
  const stats = u.normalizedStats ?? {}
  const projections = u.normalizedProjections ?? {}
  const historical = historicalStats(stats, u.statsSource, now)
  const projection = projectionSnapshot(u.projectedPoints, projections, u.projectionsSource, now)
  const news = newsSnapshot(stats, projections, u.profileSource, now)
  const injuryUpdatedAt = firstIso(source, [
    'injuryUpdatedAt',
    'metadata.injuryUpdatedAt',
    'cacheStats.injuryUpdatedAt',
    'cacheProjections.injuryUpdatedAt',
    'updatedAt',
    'fetchedAt',
  ])
  const injury = {
    designation: u.injuryStatus,
    practiceStatus: firstString(source, ['practiceStatus', 'metadata.practiceStatus', 'cacheStats.practiceStatus']),
    gameStatus: firstString(source, ['gameStatus', 'metadata.gameStatus', 'cacheStats.gameStatus']),
    source: u.injuryStatus ? u.profileSource ?? u.statsSource ?? null : null,
    updatedAt: injuryUpdatedAt,
    freshness: freshnessFor(Boolean(u.injuryStatus), injuryUpdatedAt, STALE_HOURS.injury, now),
  } satisfies NflRedraftInjurySnapshot
  const statsUpdatedAt = historical.previousSeason?.updatedAt ?? firstIso(stats, ['updatedAt', 'fetchedAt', 'lastUpdated'])
  const statsState = freshnessFor(
    Boolean(historical.previousSeason || historical.seasons.length),
    statsUpdatedAt,
    STALE_HOURS.stats,
    now,
  )
  const projectionState = freshnessFor(!projection.unavailable, projection.updatedAt, STALE_HOURS.projections, now)
  const mediaState: NflRedraftDataState = u.headshotUrl || teamLogoUrl ? 'available' : 'missing'
  const activeStatus = activeStatusFrom(u.status, u.injuryStatus)
  const depthRank = depthRankFrom(source)
  const depthRole = firstString(source, [
    'depthChartRole',
    'depthRole',
    'metadata.depthChartRole',
    'cacheStats.depthChartRole',
    'cacheProjections.depthChartRole',
  ])
  const fallbacks: NflRedraftFallback[] = []

  if (!u.headshotUrl) {
    pushFallback(
      fallbacks,
      'headshotUrl',
      position === 'DEF' && teamLogoUrl ? 'team defense uses team badge' : 'player headshot unavailable',
      u.imageSource,
    )
  }
  if (!teamLogoUrl && teamAbbr) pushFallback(fallbacks, 'teamLogoUrl', 'team logo unavailable; render text badge', null)
  if (!historical.previousSeason && historical.seasons.length === 0) pushFallback(fallbacks, 'historicalStats', 'provider stats unavailable', u.statsSource)
  if (projection.unavailable) pushFallback(fallbacks, 'currentProjection', 'provider projection unavailable', u.projectionsSource)
  if (!u.injuryStatus) pushFallback(fallbacks, 'injuryStatus', 'provider injury designation unavailable', u.profileSource)
  if (!news.summary) pushFallback(fallbacks, 'newsSummary', 'provider news unavailable', u.profileSource)
  if (!u.providerPlayerId) pushFallback(fallbacks, 'providerPlayerId', 'external provider id unavailable', u.profileSource)

  const staleWarnings = [
    statsState === 'stale' ? `Stats data is stale as of ${statsUpdatedAt}.` : null,
    projectionState === 'stale' ? `Projection data is stale as of ${projection.updatedAt}.` : null,
    injury.freshness === 'stale' ? `Injury data is stale as of ${injury.updatedAt}.` : null,
    news.freshness === 'stale' ? `News data is stale as of ${news.updatedAt}.` : null,
  ].filter((value): value is string => Boolean(value))

  const missingFields = fallbacks.map((fallback) => fallback.field)
  const rank = projection.rank ?? historical.previousSeason?.rank ?? firstInteger(source, ['rank', 'overallRank', 'metadata.rank'])
  const positionalRank =
    projection.positionalRank ??
    historical.previousSeason?.positionalRank ??
    firstInteger(source, ['positionalRank', 'positionRank', 'metadata.positionalRank'])

  return {
    modelVersion: NFL_REDRAFT_CANONICAL_PLAYER_MODEL_VERSION,
    playerId: u.playerId,
    providerIds: providerIds(view, source),
    fullName: u.fullName,
    displayName: u.fullName,
    nflTeam: teamAbbr,
    teamId: u.teamId,
    teamAbbr,
    position,
    fantasyPosition: position,
    rosterEligibility: rosterEligibility(position, explicitEligibility),
    jerseyNumber: u.jerseyNumber,
    media: {
      headshot: mediaAsset({
        url: u.headshotUrl,
        source: u.imageSource,
        fallbackKind: position === 'DEF' && teamLogoUrl ? 'team-badge' : 'player-silhouette',
      }),
      teamLogo: mediaAsset({
        url: teamLogoUrl,
        source: teamLogoUrl ? 'team-logo-registry' : null,
        fallbackKind: teamAbbr ? 'team-text-badge' : 'none',
      }),
    },
    byeWeek: view.byeWeek ?? firstInteger(source, ['metadata.byeWeek', 'byeWeek']),
    injury,
    activeStatus,
    depthChartRole: depthRole,
    depthChartRank: depthRank,
    age: u.age,
    experience: {
      years: u.yearsExperience,
      label: experienceLabel(u.yearsExperience, u.nflRookie?.isRookie ?? null),
      source: u.yearsExpSource ?? u.rookieSource,
    },
    college: u.college,
    historicalStats: historical,
    previousSeasonFantasyPoints: historical.previousSeason?.fantasyPoints ?? null,
    currentProjection: projection,
    adp: u.adp,
    rank,
    positionalRank,
    news,
    lastUpdatedAt: latestIso([statsUpdatedAt, projection.updatedAt, injury.updatedAt, news.updatedAt]),
    dataFreshness: {
      profile: u.profileSource ? 'available' : 'unknown',
      media: mediaState,
      stats: statsState,
      projections: projectionState,
      injury: injury.freshness,
      news: news.freshness,
      missingFields,
      staleWarnings,
    },
    fallbacks,
  }
}

export function getNflRedraftCanonicalFromWire(row: UnifiedPlayerWireDto): NflRedraftCanonicalPlayer | null {
  return row.nflRedraft ?? null
}
