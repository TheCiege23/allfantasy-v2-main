import type {
  CanonicalNflRedraftProviderRecord,
  NflRedraftProviderFreshness,
  NflRedraftProviderId,
} from '@/lib/nfl-provider/nflRedraftProviderFoundation'
import {
  buildNflRedraftProviderFreshness,
  toCanonicalNflRedraftProviderRecord,
} from '@/lib/nfl-provider/nflRedraftProviderFoundation'
import type { NflRedraftDataState } from '@/lib/player-data/nflRedraftCanonicalPlayer'
import type {
  NflRedraftProviderFallbackMetadata,
  NflRedraftProviderFreshnessMetadata,
} from '@/lib/player-data/nflRedraftPlayerMetadata'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export const NFL_REDRAFT_LIVE_SCORING_CONTEXT_MODEL_VERSION = 'nfl-redraft-live-scoring-context-v1' as const

export type NflRedraftLiveGameStatus =
  | 'scheduled'
  | 'live'
  | 'halftime'
  | 'overtime'
  | 'final'
  | 'suspended'
  | 'postponed'
  | 'unknown'

export type NflRedraftLiveClockContext = {
  quarter: number | null
  clock: string | null
  display: string | null
}

export type NflRedraftLiveStatLine = {
  stats: Record<string, number>
  source: string | null
  updatedAtIso: string | null
  freshness: NflRedraftDataState
  unavailable: boolean
}

export type NflRedraftStatCorrectionRecord = {
  correctionId: string
  playerId: string
  gameId: string
  statCategory: string
  oldValue: number | null
  newValue: number | null
  fantasyPointDelta: number | null
  providerSource: string | null
  timestampIso: string | null
  applied: boolean
}

export type NflRedraftLiveRefreshContext = {
  scoringRefreshTimestamp: string | null
  matchupRefreshTimestamp: string | null
  standingsRefreshRequired: boolean
  standingsRefreshReason: string | null
}

export type NflRedraftLiveScoringContext = {
  modelVersion: typeof NFL_REDRAFT_LIVE_SCORING_CONTEXT_MODEL_VERSION
  playerId: string | null
  gameId: string | null
  season: number | null
  week: number | null
  gameStatus: NflRedraftLiveGameStatus
  gameClock: NflRedraftLiveClockContext
  final: boolean
  stats: NflRedraftLiveStatLine
  fantasyPoints: number | null
  projectedFantasyPoints: number | null
  actualFantasyPoints: number | null
  statCorrections: NflRedraftStatCorrectionRecord[]
  refresh: NflRedraftLiveRefreshContext
  providerFreshness: NflRedraftProviderFreshnessMetadata
  providerFallback: NflRedraftProviderFallbackMetadata
}

export type NormalizeNflRedraftProviderLiveScoringOptions = {
  now?: Date
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  fallback?: boolean
  maxAgeMinutes?: number
  allFantasyPlayerId?: string | null
}

type BuildLiveScoringContextInput = {
  playerId?: string | null
  gameId?: string | null
  season?: number | null
  week?: number | null
  gameStatus?: NflRedraftLiveGameStatus | string | null
  quarter?: number | null
  clock?: string | null
  clockDisplay?: string | null
  final?: boolean | null
  stats?: Record<string, unknown> | null
  statsSource?: string | null
  statsUpdatedAtIso?: string | null
  statsFreshness?: NflRedraftDataState
  fantasyPoints?: number | null
  projectedFantasyPoints?: number | null
  actualFantasyPoints?: number | null
  statCorrections?: NflRedraftStatCorrectionRecord[]
  scoringRefreshTimestamp?: string | null
  matchupRefreshTimestamp?: string | null
  standingsRefreshRequired?: boolean | null
  standingsRefreshReason?: string | null
  providerFreshness?: Partial<NflRedraftProviderFreshnessMetadata>
  providerFallback?: Partial<NflRedraftProviderFallbackMetadata>
}

const PROVIDER_LIVE_SCORING_MAX_AGE_MINUTES: Record<NflRedraftProviderId, number> = {
  api_sports: 5,
  clearsports: 15,
  sportsdataio: 5,
  rolling_insights: 5,
  fantasycalc: 360,
  espn: 5,
  sleeper: 1440,
  thesportsdb: 15,
  openweather: 120,
  deterministic: 525600,
}

function cleanString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function finiteInteger(value: unknown): number | null {
  const valueNumber = finiteNumber(value)
  return valueNumber == null ? null : Math.trunc(valueNumber)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    const record = asRecord(current)
    if (!(part in record)) return undefined
    current = record[part]
  }
  return current
}

function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = cleanString(readPath(source, path))
    if (value) return value
  }
  return null
}

function firstNumber(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = finiteNumber(readPath(source, path))
    if (value != null) return value
  }
  return null
}

function firstInteger(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = finiteInteger(readPath(source, path))
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => cleanString(value)).filter((value): value is string => Boolean(value))))
}

function dataStateFromFreshness(freshness: NflRedraftProviderFreshness | null | undefined): NflRedraftDataState {
  if (!freshness) return 'unknown'
  if (freshness.status === 'fresh') return 'available'
  if (freshness.status === 'stale') return 'stale'
  return 'missing'
}

function providerFreshnessMetadata(
  freshness: Partial<NflRedraftProviderFreshnessMetadata> | null | undefined,
): NflRedraftProviderFreshnessMetadata {
  const status = freshness?.status ?? 'unknown'
  const warnings = uniqueStrings(freshness?.warnings ?? [])
  return {
    status,
    updatedAtIso: freshness?.updatedAtIso ?? null,
    ageMinutes: freshness?.ageMinutes ?? null,
    maxAgeMinutes: freshness?.maxAgeMinutes ?? null,
    stale: freshness?.stale ?? status === 'stale',
    warnings,
  }
}

function providerFallbackMetadata(
  fallback: Partial<NflRedraftProviderFallbackMetadata> | null | undefined,
): NflRedraftProviderFallbackMetadata {
  const fields = uniqueStrings(fallback?.fields ?? [])
  const labels = uniqueStrings(fallback?.labels ?? fields)
  return {
    fallback: fallback?.fallback ?? fields.length > 0,
    fields,
    labels,
  }
}

function normalizeLiveGameStatus(value: unknown, final?: boolean | null): NflRedraftLiveGameStatus {
  if (final === true) return 'final'
  const text = cleanString(value)?.toLowerCase()
  if (!text) return 'unknown'
  if (['scheduled', 'not started', 'not_started', 'pre', 'pregame'].includes(text)) return 'scheduled'
  if (['inprogress', 'in_progress', 'in progress', 'live', 'active'].includes(text)) return 'live'
  if (['halftime', 'half'].includes(text)) return 'halftime'
  if (['overtime', 'ot'].includes(text)) return 'overtime'
  if (['final', 'final overtime', 'closed', 'complete', 'completed'].includes(text)) return 'final'
  if (text.includes('postponed')) return 'postponed'
  if (text.includes('suspended')) return 'suspended'
  return 'unknown'
}

function normalizeStats(value: unknown): Record<string, number> {
  const source = asRecord(value)
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(source)) {
    if (key === 'providerPayload' || key === 'rawProviderPayload') continue
    const num = finiteNumber(raw)
    if (num != null) out[key] = num
  }
  return out
}

function candidateStats(source: Record<string, unknown>): Record<string, unknown> {
  const nested =
    asRecord(source.stats).stats && typeof asRecord(source.stats).stats === 'object'
      ? asRecord(asRecord(source.stats).stats)
      : { ...asRecord(source.stats), ...asRecord(source.Stats) }
  const live = asRecord(source.liveScoring)
  const context = asRecord(source.liveScoringContext)
  const playerGame = asRecord(source.PlayerGame)
  return {
    ...nested,
    ...asRecord(live.stats),
    ...asRecord(context.stats),
    ...asRecord(playerGame.Stats),
  }
}

function missingFieldsFromInput(input: BuildLiveScoringContextInput, stats: Record<string, number>): string[] {
  const missing: string[] = []
  if (!cleanString(input.playerId)) missing.push('playerId')
  if (!cleanString(input.gameId)) missing.push('gameId')
  if (input.season == null) missing.push('season')
  if (input.week == null) missing.push('week')
  if (normalizeLiveGameStatus(input.gameStatus, input.final) === 'unknown') missing.push('gameStatus')
  if (Object.keys(stats).length === 0) missing.push('stats')
  if (input.fantasyPoints == null && input.actualFantasyPoints == null) missing.push('fantasyPoints')
  return missing
}

function normalizeCorrectionRecord(value: unknown, fallback: {
  playerId?: string | null
  gameId?: string | null
  providerSource?: string | null
  timestampIso?: string | null
}): NflRedraftStatCorrectionRecord | null {
  const source = asRecord(value)
  const correctionId = firstString(source, ['correctionId', 'CorrectionID', 'id', 'Id'])
  const statCategory = firstString(source, ['statCategory', 'StatCategory', 'stat', 'category'])
  const playerId = firstString(source, ['allFantasyPlayerId']) ?? fallback.playerId ?? null
  const gameId = firstString(source, ['gameId', 'GameID']) ?? fallback.gameId ?? null
  if (!correctionId || !statCategory || !playerId || !gameId) return null
  return {
    correctionId,
    playerId,
    gameId,
    statCategory,
    oldValue: firstNumber(source, ['oldValue', 'OldValue', 'from']),
    newValue: firstNumber(source, ['newValue', 'NewValue', 'to']),
    fantasyPointDelta: firstNumber(source, ['fantasyPointDelta', 'FantasyPointDelta', 'pointsDelta']),
    providerSource: firstString(source, ['providerSource', 'source']) ?? fallback.providerSource ?? null,
    timestampIso: firstIso(source, ['timestampIso', 'timestamp', 'Timestamp', 'updatedAt']) ?? fallback.timestampIso ?? null,
    applied: readPath(source, 'applied') === false ? false : true,
  }
}

function normalizeCorrections(source: Record<string, unknown>, fallback: {
  playerId?: string | null
  gameId?: string | null
  providerSource?: string | null
  timestampIso?: string | null
}): NflRedraftStatCorrectionRecord[] {
  const raw = source.statCorrections ?? source.corrections ?? source.StatCorrections
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list
    .map((value) => normalizeCorrectionRecord(value, fallback))
    .filter((value): value is NflRedraftStatCorrectionRecord => Boolean(value))
}

export function buildNflRedraftLiveScoringContext(
  input: BuildLiveScoringContextInput,
): NflRedraftLiveScoringContext {
  const stats = normalizeStats(input.stats ?? {})
  const status = normalizeLiveGameStatus(input.gameStatus, input.final)
  const final = input.final === true || status === 'final'
  const fallbackFields = uniqueStrings([...(input.providerFallback?.fields ?? []), ...missingFieldsFromInput(input, stats)])
  const fallbackLabels = uniqueStrings(input.providerFallback?.labels ?? fallbackFields)
  const providerFreshness = providerFreshnessMetadata(input.providerFreshness)
  const statsUnavailable = Object.keys(stats).length === 0
  const statsFreshness = input.statsFreshness ?? (statsUnavailable ? 'missing' : providerFreshness.status)

  return {
    modelVersion: NFL_REDRAFT_LIVE_SCORING_CONTEXT_MODEL_VERSION,
    playerId: cleanString(input.playerId),
    gameId: cleanString(input.gameId),
    season: finiteInteger(input.season),
    week: finiteInteger(input.week),
    gameStatus: status,
    gameClock: {
      quarter: finiteInteger(input.quarter),
      clock: cleanString(input.clock),
      display: cleanString(input.clockDisplay) ?? cleanString(input.clock),
    },
    final,
    stats: {
      stats,
      source: statsUnavailable ? null : cleanString(input.statsSource),
      updatedAtIso: input.statsUpdatedAtIso ?? null,
      freshness: statsFreshness,
      unavailable: statsUnavailable,
    },
    fantasyPoints: finiteNumber(input.fantasyPoints),
    projectedFantasyPoints: finiteNumber(input.projectedFantasyPoints),
    actualFantasyPoints: finiteNumber(input.actualFantasyPoints ?? input.fantasyPoints),
    statCorrections: input.statCorrections ?? [],
    refresh: {
      scoringRefreshTimestamp: input.scoringRefreshTimestamp ?? input.statsUpdatedAtIso ?? providerFreshness.updatedAtIso,
      matchupRefreshTimestamp: input.matchupRefreshTimestamp ?? input.statsUpdatedAtIso ?? providerFreshness.updatedAtIso,
      standingsRefreshRequired: input.standingsRefreshRequired ?? (final || (input.statCorrections?.some((correction) => correction.applied) ?? false)),
      standingsRefreshReason: cleanString(input.standingsRefreshReason) ?? (final ? 'final_game_state' : null),
    },
    providerFreshness,
    providerFallback: providerFallbackMetadata({
      fallback: input.providerFallback?.fallback ?? fallbackFields.length > 0,
      fields: fallbackFields,
      labels: fallbackLabels,
    }),
  }
}

export function normalizeNflRedraftProviderLiveScoringContext(
  providerId: NflRedraftProviderId,
  payload: unknown,
  options?: NormalizeNflRedraftProviderLiveScoringOptions,
): NflRedraftLiveScoringContext {
  const source = asRecord(payload)
  const maxAgeMinutes = options?.maxAgeMinutes ?? PROVIDER_LIVE_SCORING_MAX_AGE_MINUTES[providerId]
  const updatedAtIso =
    options?.sourceUpdatedAtIso ??
    firstIso(source, ['updatedAt', 'Updated', 'LastUpdated', 'lastUpdated', 'timestamp', 'Timestamp', 'fetchedAt']) ??
    options?.lastSuccessfulSyncAtIso ??
    options?.fetchedAtIso ??
    null
  const freshness = buildNflRedraftProviderFreshness({ updatedAtIso, maxAgeMinutes, now: options?.now })
  const state = dataStateFromFreshness(freshness)
  const playerId =
    options?.allFantasyPlayerId ??
    firstString(source, ['allFantasyPlayerId'])
  const gameId = firstString(source, ['gameId', 'GameID', 'game.id'])
  const stats = candidateStats(source)
  const status = firstString(source, ['gameStatus', 'Status', 'status', 'GameStatus', 'game.status'])
  const final = readPath(source, 'final') === true || readPath(source, 'IsGameOver') === true
  const corrections = normalizeCorrections(source, {
    playerId,
    gameId,
    providerSource: providerId,
    timestampIso: updatedAtIso,
  })

  return buildNflRedraftLiveScoringContext({
    playerId,
    gameId,
    season: firstInteger(source, ['season', 'Season']),
    week: firstInteger(source, ['week', 'Week']),
    gameStatus: status,
    quarter: firstInteger(source, ['quarter', 'Quarter', 'game.Quarter']),
    clock: firstString(source, ['clock', 'Clock', 'timeRemaining', 'TimeRemaining', 'game.TimeRemaining']),
    clockDisplay: firstString(source, ['clockDisplay', 'displayClock']),
    final,
    stats,
    statsSource: Object.keys(stats).length ? providerId : null,
    statsUpdatedAtIso: updatedAtIso,
    statsFreshness: Object.keys(stats).length ? state : 'missing',
    fantasyPoints: firstNumber(source, ['fantasyPoints', 'FantasyPoints']),
    projectedFantasyPoints: firstNumber(source, ['projectedFantasyPoints', 'ProjectedFantasyPoints', 'projection']),
    actualFantasyPoints: firstNumber(source, ['actualFantasyPoints', 'ActualFantasyPoints', 'fantasyPoints', 'FantasyPoints']),
    statCorrections: corrections,
    scoringRefreshTimestamp: firstIso(source, ['scoringRefreshTimestamp', 'scoreUpdatedAt']) ?? updatedAtIso,
    matchupRefreshTimestamp: firstIso(source, ['matchupRefreshTimestamp', 'matchupUpdatedAt']) ?? updatedAtIso,
    standingsRefreshRequired: final || corrections.some((correction) => correction.applied),
    standingsRefreshReason: corrections.some((correction) => correction.applied)
      ? 'stat_correction'
      : final
        ? 'final_game_state'
        : null,
    providerFreshness: {
      status: state,
      updatedAtIso: freshness.updatedAtIso,
      ageMinutes: freshness.ageMinutes,
      maxAgeMinutes: freshness.maxAgeMinutes,
      stale: state === 'stale',
      warnings: state === 'stale' ? ['Provider live scoring data is stale.'] : [],
    },
    providerFallback: {
      fallback: options?.fallback === true,
      fields: options?.fallback ? ['liveScoring'] : [],
      labels: options?.fallback ? ['Using fallback live scoring source.'] : [],
    },
  })
}

export function toCanonicalNflRedraftLiveScoringContextRecord(input: {
  providerId: NflRedraftProviderId
  providerRecordId: string
  payload: unknown
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  fallback?: boolean
  maxAgeMinutes?: number
  now?: Date
  allFantasyPlayerId?: string | null
}): CanonicalNflRedraftProviderRecord<NflRedraftLiveScoringContext> {
  const data = normalizeNflRedraftProviderLiveScoringContext(input.providerId, input.payload, {
    now: input.now,
    fetchedAtIso: input.fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso,
    lastSuccessfulSyncAtIso: input.lastSuccessfulSyncAtIso,
    fallback: input.fallback,
    maxAgeMinutes: input.maxAgeMinutes,
    allFantasyPlayerId: input.allFantasyPlayerId,
  })
  return toCanonicalNflRedraftProviderRecord({
    providerId: input.providerId,
    providerRecordId: input.providerRecordId,
    data,
    fetchedAtIso: input.fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso ?? data.providerFreshness.updatedAtIso,
    maxAgeMinutes: input.maxAgeMinutes ?? PROVIDER_LIVE_SCORING_MAX_AGE_MINUTES[input.providerId],
    fallback: input.fallback,
    warnings: data.providerFreshness.warnings,
    now: input.now,
  })
}

function buildFromMergedSource(
  source: Record<string, unknown>,
  fallback: { playerId?: string | null; projectedFantasyPoints?: number | null },
): NflRedraftLiveScoringContext {
  const live = asRecord(source.liveScoring)
  const context = asRecord(source.liveScoringContext)
  const merged = { ...source, ...live, ...context }
  const stats = candidateStats(merged)
  return buildNflRedraftLiveScoringContext({
    playerId: fallback.playerId ?? firstString(merged, ['allFantasyPlayerId', 'playerId']),
    gameId: firstString(merged, ['gameId']),
    season: firstInteger(merged, ['nflSeason', 'season']),
    week: firstInteger(merged, ['nflWeek', 'week']),
    gameStatus: firstString(merged, ['liveGameStatus', 'gameStatus', 'status']),
    quarter: firstInteger(merged, ['quarter']),
    clock: firstString(merged, ['clock', 'timeRemaining']),
    clockDisplay: firstString(merged, ['clockDisplay']),
    final: readPath(merged, 'final') === true,
    stats,
    statsSource: firstString(merged, ['statsSource', 'source']),
    statsUpdatedAtIso: firstIso(merged, ['liveStatsUpdatedAt', 'scoringUpdatedAt', 'updatedAt', 'fetchedAt']),
    fantasyPoints: firstNumber(merged, ['fantasyPoints', 'liveFantasyPoints']),
    projectedFantasyPoints: firstNumber(merged, ['projectedFantasyPoints', 'projectedPoints']) ?? fallback.projectedFantasyPoints ?? null,
    actualFantasyPoints: firstNumber(merged, ['actualFantasyPoints', 'fantasyPoints', 'liveFantasyPoints']),
    statCorrections: normalizeCorrections(merged, {
      playerId: fallback.playerId,
      gameId: firstString(merged, ['gameId']),
      providerSource: firstString(merged, ['statsSource', 'source']),
      timestampIso: firstIso(merged, ['liveStatsUpdatedAt', 'scoringUpdatedAt', 'updatedAt', 'fetchedAt']),
    }),
    scoringRefreshTimestamp: firstIso(merged, ['scoringRefreshTimestamp', 'liveStatsUpdatedAt', 'scoringUpdatedAt', 'updatedAt']),
    matchupRefreshTimestamp: firstIso(merged, ['matchupRefreshTimestamp', 'liveStatsUpdatedAt', 'scoringUpdatedAt', 'updatedAt']),
    standingsRefreshRequired: readPath(merged, 'standingsRefreshRequired') === true,
    standingsRefreshReason: firstString(merged, ['standingsRefreshReason']),
    providerFreshness: {
      status: Object.keys(stats).length ? 'available' : 'missing',
      updatedAtIso: firstIso(merged, ['liveStatsUpdatedAt', 'scoringUpdatedAt', 'updatedAt', 'fetchedAt']),
      warnings: [],
    },
    providerFallback: {
      fallback: false,
      fields: [],
      labels: [],
    },
  })
}

export function buildNflRedraftLiveScoringContextFromProductView(
  view: UnifiedPlayerProductView,
): NflRedraftLiveScoringContext | null {
  if (String(view.unified.sport).toUpperCase() !== 'NFL') return null
  const displayMetadata = asRecord(view.display?.metadata)
  const merged = {
    ...displayMetadata,
    ...asRecord(view.unified.normalizedStats),
    ...asRecord(view.unified.normalizedProjections),
    ...asRecord(displayMetadata.liveScoring),
    ...asRecord(view.unified.normalizedStats.liveScoring),
    ...asRecord(view.unified.normalizedProjections.liveScoring),
  }
  return buildFromMergedSource(merged, {
    playerId: view.unified.playerId,
    projectedFantasyPoints: view.unified.projectedPoints,
  })
}

export function buildNflRedraftLiveScoringContextFromWire(
  row: UnifiedPlayerWireDto,
): NflRedraftLiveScoringContext | null {
  if (row.nflRedraftLiveScoringContext) return row.nflRedraftLiveScoringContext
  if (String(row.sport).toUpperCase() !== 'NFL') return null
  const source = asRecord(row.product?.unified)
  const merged = {
    ...row.normalizedStats,
    ...row.normalizedProjections,
    ...source,
    ...asRecord(row.normalizedStats?.liveScoring),
    ...asRecord(row.normalizedProjections?.liveScoring),
  }
  return buildFromMergedSource(merged, {
    playerId: row.id,
    projectedFantasyPoints: row.nflRedraftPlayerIntelligence?.projection.projectedFantasyPoints ?? row.projectedPoints,
  })
}
