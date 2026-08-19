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
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export const NFL_REDRAFT_GAME_CONTEXT_MODEL_VERSION = 'nfl-redraft-game-context-v1' as const

export type NflRedraftHomeAway = 'home' | 'away'
export type NflRedraftVenueRoofType = 'dome' | 'retractable' | 'outdoor' | 'unknown'
export type NflRedraftPrecipitationType = 'none' | 'rain' | 'snow' | 'mixed' | 'unknown'

export type NflRedraftStadiumContext = {
  name: string | null
  city: string | null
  state: string | null
  roofType: NflRedraftVenueRoofType | null
}

export type NflRedraftWeatherContext = {
  condition: string | null
  temperatureF: number | null
  windSpeedMph: number | null
  precipitationType: NflRedraftPrecipitationType
  precipitationChancePercent: number | null
  source: string | null
  updatedAtIso: string | null
  freshness: NflRedraftDataState
  unavailable: boolean
}

export type NflRedraftGameContext = {
  modelVersion: typeof NFL_REDRAFT_GAME_CONTEXT_MODEL_VERSION
  season: number | null
  week: number | null
  opponent: {
    teamAbbr: string | null
  }
  homeAway: NflRedraftHomeAway | null
  kickoffTimeIso: string | null
  gameDateIso: string | null
  stadium: NflRedraftStadiumContext
  byeWeek: number | null
  isByeWeek: boolean
  gameStatus: string | null
  weather: NflRedraftWeatherContext
  providerFreshness: NflRedraftProviderFreshnessMetadata
  weatherFreshness: NflRedraftProviderFreshnessMetadata
  providerFallback: NflRedraftProviderFallbackMetadata
}

export type NormalizeNflRedraftProviderGameContextOptions = {
  now?: Date
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  fallback?: boolean
  maxAgeMinutes?: number
  playerTeamAbbr?: string | null
  byeWeek?: number | null
}

type BuildGameContextInput = {
  season?: number | null
  week?: number | null
  playerTeamAbbr?: string | null
  homeTeamAbbr?: string | null
  awayTeamAbbr?: string | null
  opponentTeamAbbr?: string | null
  homeAway?: NflRedraftHomeAway | string | null
  kickoffTimeIso?: string | null
  gameDateIso?: string | null
  stadiumName?: string | null
  stadiumCity?: string | null
  stadiumState?: string | null
  roofType?: NflRedraftVenueRoofType | string | null
  byeWeek?: number | null
  gameStatus?: string | null
  weatherCondition?: string | null
  temperatureF?: number | null
  windSpeedMph?: number | null
  precipitationType?: NflRedraftPrecipitationType | string | null
  precipitationChancePercent?: number | null
  weatherSource?: string | null
  weatherUpdatedAtIso?: string | null
  weatherFreshness?: NflRedraftDataState
  providerFreshness?: Partial<NflRedraftProviderFreshnessMetadata>
  providerFallback?: Partial<NflRedraftProviderFallbackMetadata>
}

const PROVIDER_GAME_CONTEXT_MAX_AGE_MINUTES: Record<NflRedraftProviderId, number> = {
  api_sports: 1440,
  clearsports: 1440,
  sportsdataio: 1440,
  thesportsdb: 1440,
  openweather: 120,
  rolling_insights: 1440,
  fantasycalc: 1440,
  espn: 1440,
  sleeper: 1440,
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

function normalizeHomeAway(value: unknown): NflRedraftHomeAway | null {
  const text = cleanString(value)?.toLowerCase()
  if (!text) return null
  if (['home', 'h'].includes(text)) return 'home'
  if (['away', 'road', 'a'].includes(text)) return 'away'
  return null
}

function normalizeRoofType(value: unknown): NflRedraftVenueRoofType | null {
  const text = cleanString(value)?.toLowerCase()
  if (!text) return null
  if (['dome', 'domed', 'indoor', 'indoors', 'closed'].includes(text)) return 'dome'
  if (text.includes('retract')) return 'retractable'
  if (['outdoor', 'outdoors', 'open', 'open air', 'open-air'].includes(text)) return 'outdoor'
  if (['unknown', 'n/a', 'na'].includes(text)) return 'unknown'
  return null
}

function normalizePrecipitation(value: unknown): NflRedraftPrecipitationType {
  const text = cleanString(value)?.toLowerCase()
  if (!text) return 'unknown'
  if (['none', 'clear', 'dry', '0'].includes(text)) return 'none'
  const hasRain = text.includes('rain') || text.includes('shower')
  const hasSnow = text.includes('snow') || text.includes('sleet')
  if (hasRain && hasSnow) return 'mixed'
  if (hasRain) return 'rain'
  if (hasSnow) return 'snow'
  return 'unknown'
}

function dateOnlyFromIso(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function weatherUnavailable(input: BuildGameContextInput): boolean {
  return !cleanString(input.weatherCondition) &&
    input.temperatureF == null &&
    input.windSpeedMph == null &&
    normalizePrecipitation(input.precipitationType) === 'unknown'
}

function missingFieldsFromInput(input: BuildGameContextInput, isByeWeek: boolean): string[] {
  const missing: string[] = []
  if (input.season == null) missing.push('season')
  if (input.week == null) missing.push('week')
  if (!isByeWeek && !cleanString(input.opponentTeamAbbr)) missing.push('opponent')
  if (!isByeWeek && !cleanString(input.kickoffTimeIso)) missing.push('kickoffTime')
  if (!isByeWeek && !cleanString(input.stadiumName)) missing.push('stadium')
  if (!isByeWeek && !cleanString(input.roofType)) missing.push('roofType')
  if (!isByeWeek && weatherUnavailable(input)) missing.push('weather')
  return missing
}

function deriveOpponent(input: BuildGameContextInput): string | null {
  const explicit = normalizeTeamAbbrev(input.opponentTeamAbbr)
  if (explicit) return explicit
  const playerTeam = normalizeTeamAbbrev(input.playerTeamAbbr)
  const homeTeam = normalizeTeamAbbrev(input.homeTeamAbbr)
  const awayTeam = normalizeTeamAbbrev(input.awayTeamAbbr)
  if (playerTeam && homeTeam && playerTeam === homeTeam) return awayTeam
  if (playerTeam && awayTeam && playerTeam === awayTeam) return homeTeam
  return null
}

function deriveHomeAway(input: BuildGameContextInput): NflRedraftHomeAway | null {
  const explicit = normalizeHomeAway(input.homeAway)
  if (explicit) return explicit
  const playerTeam = normalizeTeamAbbrev(input.playerTeamAbbr)
  const homeTeam = normalizeTeamAbbrev(input.homeTeamAbbr)
  const awayTeam = normalizeTeamAbbrev(input.awayTeamAbbr)
  if (playerTeam && homeTeam && playerTeam === homeTeam) return 'home'
  if (playerTeam && awayTeam && playerTeam === awayTeam) return 'away'
  return null
}

export function buildNflRedraftGameContext(input: BuildGameContextInput): NflRedraftGameContext {
  const season = finiteInteger(input.season)
  const week = finiteInteger(input.week)
  const byeWeek = finiteInteger(input.byeWeek)
  const isByeWeek = week != null && byeWeek != null && week === byeWeek
  const opponent = isByeWeek ? null : deriveOpponent(input)
  const homeAway = isByeWeek ? null : deriveHomeAway(input)
  const kickoffTimeIso = isByeWeek ? null : isoFromValue(input.kickoffTimeIso)
  const gameDateIso = isByeWeek ? null : dateOnlyFromIso(input.gameDateIso ?? kickoffTimeIso)
  const fallbackFields = uniqueStrings([...(input.providerFallback?.fields ?? []), ...missingFieldsFromInput({ ...input, opponentTeamAbbr: opponent, kickoffTimeIso }, isByeWeek)])
  const fallbackLabels = uniqueStrings(input.providerFallback?.labels ?? fallbackFields)
  const providerFreshness = providerFreshnessMetadata(input.providerFreshness)
  const weatherState = input.weatherFreshness ?? (weatherUnavailable(input) ? 'missing' : providerFreshness.status)
  const weatherWarnings = weatherState === 'stale' ? ['Weather context is stale.'] : weatherState === 'missing' ? ['Weather context unavailable.'] : []

  return {
    modelVersion: NFL_REDRAFT_GAME_CONTEXT_MODEL_VERSION,
    season,
    week,
    opponent: {
      teamAbbr: opponent,
    },
    homeAway,
    kickoffTimeIso,
    gameDateIso,
    stadium: {
      name: isByeWeek ? null : cleanString(input.stadiumName),
      city: isByeWeek ? null : cleanString(input.stadiumCity),
      state: isByeWeek ? null : cleanString(input.stadiumState),
      roofType: isByeWeek ? null : normalizeRoofType(input.roofType),
    },
    byeWeek,
    isByeWeek,
    gameStatus: isByeWeek ? 'Bye' : cleanString(input.gameStatus),
    weather: {
      condition: isByeWeek ? null : cleanString(input.weatherCondition),
      temperatureF: isByeWeek ? null : finiteNumber(input.temperatureF),
      windSpeedMph: isByeWeek ? null : finiteNumber(input.windSpeedMph),
      precipitationType: isByeWeek ? 'none' : normalizePrecipitation(input.precipitationType ?? input.weatherCondition),
      precipitationChancePercent: isByeWeek ? null : finiteNumber(input.precipitationChancePercent),
      source: isByeWeek || weatherUnavailable(input) ? null : cleanString(input.weatherSource),
      updatedAtIso: isByeWeek ? null : input.weatherUpdatedAtIso ?? null,
      freshness: isByeWeek ? 'missing' : weatherState,
      unavailable: isByeWeek ? true : weatherUnavailable(input),
    },
    providerFreshness,
    weatherFreshness: providerFreshnessMetadata({
      ...input.providerFreshness,
      status: isByeWeek ? 'missing' : weatherState,
      updatedAtIso: isByeWeek ? null : input.weatherUpdatedAtIso ?? input.providerFreshness?.updatedAtIso ?? null,
      stale: !isByeWeek && weatherState === 'stale',
      warnings: isByeWeek ? [] : weatherWarnings,
    }),
    providerFallback: providerFallbackMetadata({
      fallback: input.providerFallback?.fallback ?? fallbackFields.length > 0,
      fields: fallbackFields,
      labels: fallbackLabels,
    }),
  }
}

export function normalizeNflRedraftProviderGameContext(
  providerId: NflRedraftProviderId,
  payload: unknown,
  options?: NormalizeNflRedraftProviderGameContextOptions,
): NflRedraftGameContext {
  const source = asRecord(payload)
  const maxAgeMinutes = options?.maxAgeMinutes ?? PROVIDER_GAME_CONTEXT_MAX_AGE_MINUTES[providerId]
  const updatedAtIso =
    options?.sourceUpdatedAtIso ??
    firstIso(source, ['updatedAt', 'Updated', 'lastUpdated', 'LastUpdated', 'timestamp', 'Timestamp', 'fetchedAt']) ??
    options?.lastSuccessfulSyncAtIso ??
    options?.fetchedAtIso ??
    null
  const weatherUpdatedAtIso =
    firstIso(source, ['weatherUpdatedAt', 'weather.updatedAt', 'weather.dt', 'dt', 'fetchedAt']) ?? updatedAtIso
  const freshness = buildNflRedraftProviderFreshness({ updatedAtIso, maxAgeMinutes, now: options?.now })
  const weatherFreshness = buildNflRedraftProviderFreshness({
    updatedAtIso: weatherUpdatedAtIso,
    maxAgeMinutes: providerId === 'openweather' ? 120 : Math.min(maxAgeMinutes, 120),
    now: options?.now,
  })
  const state = dataStateFromFreshness(freshness)
  const weatherState = dataStateFromFreshness(weatherFreshness)
  const homeTeam = firstString(source, ['homeTeam', 'HomeTeam', 'home', 'strHomeTeam', 'home_team'])
  const awayTeam = firstString(source, ['awayTeam', 'AwayTeam', 'away', 'strAwayTeam', 'away_team'])
  const kickoff = firstIso(source, ['kickoffTime', 'kickoffTimeIso', 'DateTime', 'DateTimeUTC', 'dateEvent', 'strTimestamp', 'gameDate'])
  const weatherCondition = firstString(source, ['weatherCondition', 'Weather', 'ForecastDescription', 'weather.condition', 'weather.0.main', 'weather.0.description'])
  const precipitationType =
    firstString(source, ['precipitationType', 'PrecipitationType', 'weather.precipitationType']) ??
    (firstNumber(source, ['rain.1h', 'rain.3h']) != null ? 'rain' : firstNumber(source, ['snow.1h', 'snow.3h']) != null ? 'snow' : null)

  return buildNflRedraftGameContext({
    season: firstInteger(source, ['season', 'Season', 'intSeason']),
    week: firstInteger(source, ['week', 'Week', 'gameWeek']),
    playerTeamAbbr: options?.playerTeamAbbr ?? firstString(source, ['playerTeam', 'team', 'Team']),
    homeTeamAbbr: homeTeam,
    awayTeamAbbr: awayTeam,
    opponentTeamAbbr: firstString(source, ['opponent', 'Opponent', 'opponentTeam']),
    homeAway: firstString(source, ['homeAway', 'HomeAway']),
    kickoffTimeIso: kickoff,
    gameDateIso: firstIso(source, ['gameDate', 'GameDate', 'Day']) ?? dateOnlyFromIso(kickoff),
    stadiumName: firstString(source, ['stadium', 'Stadium', 'stadiumName', 'StadiumDetails.Name', 'strVenue']),
    stadiumCity: firstString(source, ['stadiumCity', 'StadiumCity', 'StadiumDetails.City', 'venueCity']),
    stadiumState: firstString(source, ['stadiumState', 'StadiumState', 'StadiumDetails.State', 'venueState']),
    roofType: firstString(source, ['roofType', 'RoofType', 'stadiumRoof', 'StadiumDetails.Type', 'venueType']),
    byeWeek: options?.byeWeek ?? firstInteger(source, ['byeWeek', 'ByeWeek']),
    gameStatus: firstString(source, ['gameStatus', 'Status', 'status', 'strStatus']),
    weatherCondition,
    temperatureF: firstNumber(source, ['temperatureF', 'TemperatureF', 'tempF', 'ForecastTempLow', 'weather.temperatureF', 'main.temp']),
    windSpeedMph: firstNumber(source, ['windSpeedMph', 'WindSpeedMph', 'windMph', 'ForecastWindSpeed', 'weather.windSpeedMph', 'wind.speed']),
    precipitationType,
    precipitationChancePercent: firstNumber(source, ['precipitationChancePercent', 'PrecipitationChancePercent', 'pop', 'weather.pop']),
    weatherSource: weatherCondition || precipitationType ? providerId : null,
    weatherUpdatedAtIso,
    weatherFreshness: weatherCondition || precipitationType || firstNumber(source, ['temperatureF', 'TemperatureF', 'main.temp']) != null ? weatherState : 'missing',
    providerFreshness: {
      status: state,
      updatedAtIso: freshness.updatedAtIso,
      ageMinutes: freshness.ageMinutes,
      maxAgeMinutes: freshness.maxAgeMinutes,
      stale: state === 'stale',
      warnings: state === 'stale' ? ['Provider game context data is stale.'] : [],
    },
    providerFallback: {
      fallback: options?.fallback === true,
      fields: options?.fallback ? ['gameContext'] : [],
      labels: options?.fallback ? ['Using fallback game context source.'] : [],
    },
  })
}

export function toCanonicalNflRedraftGameContextRecord(input: {
  providerId: NflRedraftProviderId
  providerRecordId: string
  payload: unknown
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  fallback?: boolean
  maxAgeMinutes?: number
  now?: Date
  playerTeamAbbr?: string | null
  byeWeek?: number | null
}): CanonicalNflRedraftProviderRecord<NflRedraftGameContext> {
  const data = normalizeNflRedraftProviderGameContext(input.providerId, input.payload, {
    now: input.now,
    fetchedAtIso: input.fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso,
    lastSuccessfulSyncAtIso: input.lastSuccessfulSyncAtIso,
    fallback: input.fallback,
    maxAgeMinutes: input.maxAgeMinutes,
    playerTeamAbbr: input.playerTeamAbbr,
    byeWeek: input.byeWeek,
  })
  return toCanonicalNflRedraftProviderRecord({
    providerId: input.providerId,
    providerRecordId: input.providerRecordId,
    data,
    fetchedAtIso: input.fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso ?? data.providerFreshness.updatedAtIso,
    maxAgeMinutes: input.maxAgeMinutes ?? PROVIDER_GAME_CONTEXT_MAX_AGE_MINUTES[input.providerId],
    fallback: input.fallback,
    warnings: [...data.providerFreshness.warnings, ...data.weatherFreshness.warnings],
    now: input.now,
  })
}

function buildFromMergedSource(source: Record<string, unknown>, options: { teamAbbr?: string | null; byeWeek?: number | null }): NflRedraftGameContext {
  return buildNflRedraftGameContext({
    season: firstInteger(source, ['nflSeason', 'season', 'Season']),
    week: firstInteger(source, ['nflWeek', 'week', 'Week']),
    playerTeamAbbr: options.teamAbbr ?? firstString(source, ['teamAbbr', 'team']),
    homeTeamAbbr: firstString(source, ['homeTeam', 'HomeTeam']),
    awayTeamAbbr: firstString(source, ['awayTeam', 'AwayTeam']),
    opponentTeamAbbr: firstString(source, ['opponent', 'opponentTeam', 'Opponent']),
    homeAway: firstString(source, ['homeAway']),
    kickoffTimeIso: firstIso(source, ['kickoffTimeIso', 'kickoffTime', 'gameTime', 'DateTime']),
    gameDateIso: firstIso(source, ['gameDateIso', 'gameDate']),
    stadiumName: firstString(source, ['stadium', 'stadiumName']),
    stadiumCity: firstString(source, ['stadiumCity']),
    stadiumState: firstString(source, ['stadiumState']),
    roofType: firstString(source, ['roofType', 'stadiumRoof']),
    byeWeek: options.byeWeek ?? firstInteger(source, ['byeWeek', 'ByeWeek']),
    gameStatus: firstString(source, ['gameStatus', 'status']),
    weatherCondition: firstString(source, ['weatherCondition', 'weather.condition']),
    temperatureF: firstNumber(source, ['temperatureF', 'tempF', 'weather.temperatureF']),
    windSpeedMph: firstNumber(source, ['windSpeedMph', 'windMph', 'weather.windSpeedMph']),
    precipitationType: firstString(source, ['precipitationType', 'weather.precipitationType']),
    precipitationChancePercent: firstNumber(source, ['precipitationChancePercent', 'weather.precipitationChancePercent']),
    weatherSource: firstString(source, ['weatherSource']),
    weatherUpdatedAtIso: firstIso(source, ['weatherUpdatedAt', 'weatherUpdatedAtIso']),
    providerFreshness: {
      status: firstString(source, ['kickoffTimeIso', 'kickoffTime', 'opponent', 'stadium']) ? 'available' : 'missing',
      updatedAtIso: firstIso(source, ['gameContextUpdatedAt', 'updatedAt', 'fetchedAt']),
      warnings: [],
    },
    providerFallback: {
      fallback: false,
      fields: [],
      labels: [],
    },
  })
}

export function buildNflRedraftGameContextFromProductView(
  view: UnifiedPlayerProductView,
): NflRedraftGameContext | null {
  if (String(view.unified.sport).toUpperCase() !== 'NFL') return null
  const displayMetadata = asRecord(view.display?.metadata)
  const merged = {
    ...displayMetadata,
    ...asRecord(view.unified.normalizedStats),
    ...asRecord(view.unified.normalizedProjections),
    ...asRecord(displayMetadata.gameContext),
    ...asRecord(view.unified.normalizedStats.gameContext),
    ...asRecord(view.unified.normalizedProjections.gameContext),
  }
  return buildFromMergedSource(merged, {
    teamAbbr: view.unified.teamAbbr ?? view.unified.team,
    byeWeek: view.byeWeek ?? finiteInteger(displayMetadata.byeWeek),
  })
}

export function buildNflRedraftGameContextFromWire(row: UnifiedPlayerWireDto): NflRedraftGameContext | null {
  if (row.nflRedraftGameContext) return row.nflRedraftGameContext
  if (String(row.sport).toUpperCase() !== 'NFL') return null
  const source = asRecord(row.product?.unified)
  const merged = {
    ...row.normalizedStats,
    ...row.normalizedProjections,
    ...source,
    ...asRecord(row.normalizedStats?.gameContext),
    ...asRecord(row.normalizedProjections?.gameContext),
  }
  return buildFromMergedSource(merged, {
    teamAbbr: row.team,
    byeWeek: row.product?.byeWeek ?? row.nflRedraftPlayerMetadata?.byeWeek ?? null,
  })
}
