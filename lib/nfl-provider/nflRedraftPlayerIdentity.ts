import { normalizePosition, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import {
  buildNflRedraftProviderFreshness,
  toCanonicalNflRedraftProviderRecord,
  type CanonicalNflRedraftProviderRecord,
  type NflRedraftProviderFreshness,
  type NflRedraftProviderId,
} from './nflRedraftProviderFoundation'

export const NFL_REDRAFT_PLAYER_IDENTITY_MODEL_VERSION = 'nfl-redraft-player-identity-v1' as const

export const NFL_REDRAFT_PLAYER_IDENTITY_PROVIDERS = [
  'api_sports',
  'clearsports',
  'rolling_insights',
  'sportsdataio',
  'sleeper',
  'thesportsdb',
  'deterministic',
] as const satisfies readonly NflRedraftProviderId[]

export type NflRedraftPlayerIdentityProviderId = (typeof NFL_REDRAFT_PLAYER_IDENTITY_PROVIDERS)[number]

export type NflRedraftFantasyPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'SUPER_FLEX' | 'K' | 'DEF' | 'IDP'

export type NflRedraftPlayerActiveStatus =
  | 'active'
  | 'free_agent'
  | 'inactive'
  | 'injured_reserve'
  | 'practice_squad'
  | 'suspended'
  | 'unknown'

export type NflRedraftProviderPlayerIds = {
  allFantasyPlayerId: string
  primaryProviderId: NflRedraftPlayerIdentityProviderId
  providerPlayerId: string | null
  rollingInsightsId: string | null
  sportsDataIoId: string | null
  sleeperId: string | null
  theSportsDbId: string | null
  apiSportsId: string | null
  clearSportsId: string | null
  gsisId: string | null
  espnId: string | null
  yahooId: string | null
}

export type NflRedraftProviderTeamIds = {
  rollingInsightsTeamId: string | null
  sportsDataIoTeamId: string | null
  sleeperTeamId: string | null
  theSportsDbTeamId: string | null
  apiSportsTeamId: string | null
  clearSportsTeamId: string | null
}

export type NflRedraftPlayerIdentityCacheMetadata = {
  providerId: NflRedraftPlayerIdentityProviderId
  fetchedAtIso: string
  providerTimestampIso: string | null
  lastSuccessfulSyncAtIso: string | null
  freshness: NflRedraftProviderFreshness
  stale: boolean
  fallback: boolean
  warnings: string[]
}

export type NflRedraftCanonicalPlayerIdentity = {
  modelVersion: typeof NFL_REDRAFT_PLAYER_IDENTITY_MODEL_VERSION
  allFantasyPlayerId: string
  providerIds: NflRedraftProviderPlayerIds
  playerName: string
  preferredDisplayName: string
  team: string | null
  providerTeamIds: NflRedraftProviderTeamIds
  position: string | null
  fantasyPositions: NflRedraftFantasyPosition[]
  jerseyNumber: number | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  height: string | null
  weight: number | null
  age: number | null
  experience: number | null
  college: string | null
  byeWeek: number | null
  activeStatus: NflRedraftPlayerActiveStatus
  sourceProviderId: NflRedraftPlayerIdentityProviderId
  cache: NflRedraftPlayerIdentityCacheMetadata
}

export type NormalizeNflRedraftPlayerIdentityInput = {
  providerId: NflRedraftPlayerIdentityProviderId
  payload: Record<string, unknown>
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  now?: Date
  fallback?: boolean
}

type ProviderFieldCandidates = {
  playerId: string[]
  rollingInsightsId: string[]
  sportsDataIoId: string[]
  sleeperId: string[]
  theSportsDbId: string[]
  apiSportsId: string[]
  clearSportsId: string[]
  gsisId: string[]
  espnId: string[]
  yahooId: string[]
  firstName: string[]
  lastName: string[]
  fullName: string[]
  displayName: string[]
  team: string[]
  teamId: string[]
  position: string[]
  fantasyPositions: string[]
  jerseyNumber: string[]
  headshotUrl: string[]
  teamLogoUrl: string[]
  height: string[]
  weight: string[]
  age: string[]
  experience: string[]
  college: string[]
  byeWeek: string[]
  activeStatus: string[]
  updatedAt: string[]
}

const DEFAULT_IDENTITY_MAX_AGE_MINUTES = 1440

const PROVIDER_FIELD_CANDIDATES: Record<NflRedraftPlayerIdentityProviderId, ProviderFieldCandidates> = {
  api_sports: {
    playerId: ['id', 'player.id', 'playerId', 'apiSportsId'],
    rollingInsightsId: ['rollingInsightsId', 'rolling_insights_id'],
    sportsDataIoId: ['sportsDataIoId', 'sports_data_id'],
    sleeperId: ['sleeperId', 'sleeper_id'],
    theSportsDbId: ['theSportsDbId', 'thesportsdb_id'],
    apiSportsId: ['id', 'player.id', 'apiSportsId', 'api_sports_id'],
    clearSportsId: ['clearSportsId', 'clear_sports_id'],
    gsisId: ['gsisId', 'gsis_id'],
    espnId: ['espnId', 'espn_id'],
    yahooId: ['yahooId', 'yahoo_id'],
    firstName: ['firstName', 'first_name'],
    lastName: ['lastName', 'last_name'],
    fullName: ['name', 'player.name', 'fullName', 'playerName'],
    displayName: ['displayName', 'name', 'player.name'],
    team: ['team.name', 'team.abbreviation', 'teamAbbr', 'team'],
    teamId: ['team.id', 'teamId', 'providerTeamId'],
    position: ['position', 'group'],
    fantasyPositions: ['fantasyPositions', 'fantasy_positions', 'eligiblePositions'],
    jerseyNumber: ['number', 'jerseyNumber'],
    headshotUrl: ['image', 'player.image', 'headshotUrl', 'photoUrl'],
    teamLogoUrl: ['team.logo', 'teamLogoUrl'],
    height: ['height'],
    weight: ['weight'],
    age: ['age'],
    experience: ['experience', 'yearsExperience', 'years_exp'],
    college: ['college'],
    byeWeek: ['byeWeek', 'bye_week'],
    activeStatus: ['status', 'activeStatus'],
    updatedAt: ['updatedAt', 'updated_at', 'lastUpdated'],
  },
  clearsports: {
    playerId: ['id', 'playerId', 'clearSportsId'],
    rollingInsightsId: ['rollingInsightsId', 'rolling_insights_id'],
    sportsDataIoId: ['sportsDataIoId', 'sports_data_id'],
    sleeperId: ['sleeperId', 'sleeper_id'],
    theSportsDbId: ['theSportsDbId', 'thesportsdb_id'],
    apiSportsId: ['apiSportsId', 'api_sports_id'],
    clearSportsId: ['id', 'playerId', 'clearSportsId', 'clear_sports_id'],
    gsisId: ['gsisId', 'gsis_id'],
    espnId: ['espnId', 'espn_id'],
    yahooId: ['yahooId', 'yahoo_id'],
    firstName: ['firstName', 'first_name'],
    lastName: ['lastName', 'last_name'],
    fullName: ['name', 'fullName', 'playerName'],
    displayName: ['displayName', 'name'],
    team: ['teamAbbrev', 'team', 'team.abbrev'],
    teamId: ['teamId', 'team_id'],
    position: ['position', 'pos'],
    fantasyPositions: ['fantasyPositions', 'fantasy_positions', 'eligiblePositions'],
    jerseyNumber: ['number', 'jerseyNumber', 'jersey_number'],
    headshotUrl: ['imageUrl', 'image_url', 'headshot'],
    teamLogoUrl: ['teamLogoUrl', 'team.logo'],
    height: ['height'],
    weight: ['weight'],
    age: ['age'],
    experience: ['experience', 'yearsExperience', 'years_exp'],
    college: ['college'],
    byeWeek: ['byeWeek', 'bye_week'],
    activeStatus: ['status', 'activeStatus'],
    updatedAt: ['updatedAt', 'updated_at', 'lastUpdated'],
  },
  rolling_insights: {
    playerId: ['player_id', 'playerId', 'id', 'providerPlayerId'],
    rollingInsightsId: ['rollingInsightsId', 'rolling_insights_id', 'player_id', 'playerId', 'id'],
    sportsDataIoId: ['sportsDataIoId', 'sportsDataID', 'sportsdataio_id'],
    sleeperId: ['sleeperId', 'sleeper_id'],
    theSportsDbId: ['theSportsDbId', 'theSportsDbPlayerId', 'thesportsdb_id'],
    apiSportsId: ['apiSportsId', 'api_sports_id'],
    clearSportsId: ['clearSportsId', 'clear_sports_id'],
    gsisId: ['gsisId', 'gsis_id'],
    espnId: ['espnId', 'espn_id'],
    yahooId: ['yahooId', 'yahoo_id'],
    firstName: ['firstName', 'first_name'],
    lastName: ['lastName', 'last_name'],
    fullName: ['player', 'fullName', 'full_name', 'name', 'playerName'],
    displayName: ['displayName', 'display_name', 'preferredName', 'preferred_display_name'],
    team: ['team', 'teamAbbr', 'team_abbr', 'teamName'],
    teamId: ['team_id', 'teamId', 'providerTeamId'],
    position: ['position', 'positionCategory', 'position_category'],
    fantasyPositions: ['fantasyPositions', 'fantasy_positions', 'eligiblePositions'],
    jerseyNumber: ['number', 'jerseyNumber', 'jersey'],
    headshotUrl: ['headshotUrl', 'headshot_url', 'photoUrl', 'imageUrl', 'img'],
    teamLogoUrl: ['teamLogoUrl', 'team_logo_url', 'teamBadgeUrl'],
    height: ['height'],
    weight: ['weight'],
    age: ['age'],
    experience: ['experience', 'yearsExperience', 'years_exp'],
    college: ['college'],
    byeWeek: ['byeWeek', 'bye_week'],
    activeStatus: ['status', 'activeStatus', 'active_status', 'active'],
    updatedAt: ['updatedAt', 'updated_at', 'lastUpdated', 'last_updated'],
  },
  sportsdataio: {
    playerId: ['PlayerID', 'SportsDataID', 'playerId', 'id'],
    rollingInsightsId: ['RollingInsightsID', 'rollingInsightsId'],
    sportsDataIoId: ['PlayerID', 'SportsDataID', 'sportsDataIoId'],
    sleeperId: ['SleeperID', 'SleeperPlayerID', 'sleeperId'],
    theSportsDbId: ['TheSportsDbID', 'TheSportsDBID', 'theSportsDbId'],
    apiSportsId: ['ApiSportsID', 'apiSportsId'],
    clearSportsId: ['ClearSportsID', 'clearSportsId'],
    gsisId: ['GsisID', 'GSISID', 'Gsid', 'gsisId'],
    espnId: ['EspnID', 'ESPNID', 'espnId'],
    yahooId: ['YahooID', 'yahooId'],
    firstName: ['FirstName', 'firstName'],
    lastName: ['LastName', 'lastName'],
    fullName: ['Name', 'FullName', 'fullName'],
    displayName: ['DisplayName', 'ShortName', 'PreferredName', 'displayName'],
    team: ['Team', 'CurrentTeam', 'team'],
    teamId: ['TeamID', 'GlobalTeamID', 'teamId'],
    position: ['Position', 'FantasyPosition', 'position'],
    fantasyPositions: ['FantasyPositions', 'fantasyPositions'],
    jerseyNumber: ['Number', 'Jersey', 'jerseyNumber'],
    headshotUrl: ['PhotoUrl', 'PhotoURL', 'HeadshotUrl', 'headshotUrl'],
    teamLogoUrl: ['TeamLogoUrl', 'TeamLogoURL', 'teamLogoUrl'],
    height: ['Height', 'height'],
    weight: ['Weight', 'weight'],
    age: ['Age', 'age'],
    experience: ['Experience', 'YearsExperience', 'yearsExperience'],
    college: ['College', 'college'],
    byeWeek: ['ByeWeek', 'byeWeek'],
    activeStatus: ['Status', 'Active', 'active'],
    updatedAt: ['Updated', 'UpdatedAt', 'LastUpdated', 'lastUpdated'],
  },
  sleeper: {
    playerId: ['player_id', 'playerId', 'id'],
    rollingInsightsId: ['metadata.rollingInsightsId', 'rollingInsightsId', 'rolling_insights_id'],
    sportsDataIoId: ['metadata.sportsDataIoId', 'sportsDataIoId', 'sports_data_id'],
    sleeperId: ['player_id', 'sleeperId', 'sleeper_id'],
    theSportsDbId: ['metadata.theSportsDbId', 'theSportsDbId', 'thesportsdb_id'],
    apiSportsId: ['metadata.apiSportsId', 'apiSportsId', 'api_sports_id'],
    clearSportsId: ['metadata.clearSportsId', 'clearSportsId', 'clear_sports_id'],
    gsisId: ['gsis_id', 'gsisId', 'metadata.gsisId'],
    espnId: ['espn_id', 'espnId', 'metadata.espnId'],
    yahooId: ['yahoo_id', 'yahooId', 'metadata.yahooId'],
    firstName: ['first_name', 'firstName'],
    lastName: ['last_name', 'lastName'],
    fullName: ['full_name', 'search_full_name', 'name'],
    displayName: ['display_name', 'displayName'],
    team: ['team', 'team_abbr'],
    teamId: ['team_id', 'team'],
    position: ['position'],
    fantasyPositions: ['fantasy_positions', 'fantasyPositions'],
    jerseyNumber: ['number', 'jersey_number'],
    headshotUrl: ['metadata.image_url', 'image_url', 'headshotUrl', 'photoUrl'],
    teamLogoUrl: ['metadata.team_logo_url', 'teamLogoUrl'],
    height: ['height'],
    weight: ['weight'],
    age: ['age'],
    experience: ['years_exp', 'experience'],
    college: ['college'],
    byeWeek: ['bye_week', 'byeWeek'],
    activeStatus: ['active', 'status'],
    updatedAt: ['metadata.updated_at', 'updated_at', 'last_updated'],
  },
  thesportsdb: {
    playerId: ['idPlayer', 'playerId', 'id'],
    rollingInsightsId: ['strRollingInsightsID', 'rollingInsightsId'],
    sportsDataIoId: ['strSportsDataID', 'sportsDataIoId'],
    sleeperId: ['strSleeperID', 'sleeperId'],
    theSportsDbId: ['idPlayer', 'theSportsDbId'],
    apiSportsId: ['strAPISportsID', 'apiSportsId'],
    clearSportsId: ['strClearSportsID', 'clearSportsId'],
    gsisId: ['strGSISID', 'gsisId'],
    espnId: ['strESPNID', 'espnId'],
    yahooId: ['strYahooID', 'yahooId'],
    firstName: ['strFirstName', 'firstName'],
    lastName: ['strLastName', 'lastName'],
    fullName: ['strPlayer', 'strPlayerAlternate', 'name'],
    displayName: ['strPlayer', 'strPlayerShort'],
    team: ['strTeam', 'strTeam2', 'team'],
    teamId: ['idTeam', 'teamId'],
    position: ['strPosition', 'strSportPosition', 'position'],
    fantasyPositions: ['strFantasyPositions', 'fantasyPositions'],
    jerseyNumber: ['strNumber', 'number'],
    headshotUrl: ['strCutout', 'strRender', 'strThumb', 'strFanart1'],
    teamLogoUrl: ['strTeamBadge', 'strTeamLogo', 'teamLogoUrl'],
    height: ['strHeight', 'height'],
    weight: ['strWeight', 'weight'],
    age: ['intAge', 'age'],
    experience: ['intExperience', 'experience'],
    college: ['strCollege', 'college'],
    byeWeek: ['intByeWeek', 'byeWeek'],
    activeStatus: ['strStatus', 'strPlayerStatus', 'active'],
    updatedAt: ['dateModified', 'updatedAt'],
  },
  deterministic: {
    playerId: ['allFantasyPlayerId', 'playerId', 'id'],
    rollingInsightsId: ['rollingInsightsId'],
    sportsDataIoId: ['sportsDataIoId'],
    sleeperId: ['sleeperId'],
    theSportsDbId: ['theSportsDbId'],
    apiSportsId: ['apiSportsId'],
    clearSportsId: ['clearSportsId'],
    gsisId: ['gsisId'],
    espnId: ['espnId'],
    yahooId: ['yahooId'],
    firstName: ['firstName'],
    lastName: ['lastName'],
    fullName: ['fullName', 'name', 'playerName'],
    displayName: ['displayName', 'preferredDisplayName'],
    team: ['team', 'teamAbbr'],
    teamId: ['teamId'],
    position: ['position'],
    fantasyPositions: ['fantasyPositions'],
    jerseyNumber: ['jerseyNumber'],
    headshotUrl: ['headshotUrl'],
    teamLogoUrl: ['teamLogoUrl'],
    height: ['height'],
    weight: ['weight'],
    age: ['age'],
    experience: ['experience'],
    college: ['college'],
    byeWeek: ['byeWeek'],
    activeStatus: ['activeStatus', 'active'],
    updatedAt: ['updatedAt'],
  },
}

function pathValue(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = source
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function firstValue(source: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = pathValue(source, path)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function firstString(source: Record<string, unknown>, paths: string[]): string | null {
  const value = firstValue(source, paths)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const numeric = Number(value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function firstNumber(source: Record<string, unknown>, paths: string[]): number | null {
  return toNumberValue(firstValue(source, paths))
}

function firstIsoString(source: Record<string, unknown>, paths: string[]): string | null {
  const raw = firstString(source, paths)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

function slugPart(raw: string | null | undefined): string {
  return String(raw ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

function normalizeName(input: {
  fullName: string | null
  firstName: string | null
  lastName: string | null
  fallbackId: string | null
}): string {
  if (input.fullName) return input.fullName
  const combined = [input.firstName, input.lastName].filter(Boolean).join(' ').trim()
  if (combined) return combined
  return input.fallbackId ? `Unknown Player ${input.fallbackId}` : 'Unknown Player'
}

function normalizeActiveStatus(raw: unknown): NflRedraftPlayerActiveStatus {
  if (typeof raw === 'boolean') return raw ? 'active' : 'inactive'
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (['active', 'act', 'yes', 'true'].includes(value)) return 'active'
  if (['free agent', 'fa', 'free_agent'].includes(value)) return 'free_agent'
  if (['inactive', 'ina', 'out', 'false'].includes(value)) return 'inactive'
  if (['ir', 'injured reserve', 'injured_reserve', 'reserve/injured'].includes(value)) return 'injured_reserve'
  if (['practice squad', 'practice_squad', 'ps'].includes(value)) return 'practice_squad'
  if (['suspended', 'sus'].includes(value)) return 'suspended'
  return 'unknown'
}

function normalizeFantasyPosition(raw: string | null): NflRedraftFantasyPosition | null {
  const normalized = normalizePosition(raw)
  if (!normalized) return null
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(normalized)) return normalized as NflRedraftFantasyPosition
  if (['DL', 'LB', 'DB', 'EDGE'].includes(normalized)) return 'IDP'
  if (normalized === 'FLEX') return 'FLEX'
  if (normalized === 'SUPER_FLEX' || normalized === 'SUPERFLEX') return 'SUPER_FLEX'
  return null
}

function splitFantasyPositions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((entry) => String(entry))
  if (typeof raw === 'string') return raw.split(/[|,/;]/)
  return []
}

export function normalizeNflFantasyPositions(position: string | null, rawFantasyPositions?: unknown): NflRedraftFantasyPosition[] {
  const positions = splitFantasyPositions(rawFantasyPositions)
    .map((entry) => normalizeFantasyPosition(entry))
    .filter((entry): entry is NflRedraftFantasyPosition => Boolean(entry))
  const primary = normalizeFantasyPosition(position)
  if (primary) positions.unshift(primary)
  return Array.from(new Set(positions))
}

export function normalizeNflProviderPlayerId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}

export function normalizeNflProviderTeamAbbreviation(raw: unknown): string | null {
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null
  return normalizeTeamAbbrev(text)
}

export function normalizeNflProviderPosition(raw: unknown): string | null {
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null
  return normalizePosition(text)
}

export function normalizeNflHeadshotUrl(raw: unknown): string | null {
  return normalizeUrl(typeof raw === 'string' ? raw : null)
}

export function normalizeNflTeamLogoUrl(raw: unknown, _team: string | null): string | null {
  return normalizeUrl(typeof raw === 'string' ? raw : null)
}

export function normalizeNflProviderTeamIds(
  providerId: NflRedraftPlayerIdentityProviderId,
  payload: Record<string, unknown>,
): NflRedraftProviderTeamIds {
  const teamId = normalizeNflProviderPlayerId(firstValue(payload, PROVIDER_FIELD_CANDIDATES[providerId].teamId))
  return {
    rollingInsightsTeamId: providerId === 'rolling_insights' ? teamId : normalizeNflProviderPlayerId(firstValue(payload, ['rollingInsightsTeamId', 'rolling_insights_team_id'])),
    sportsDataIoTeamId: providerId === 'sportsdataio' ? teamId : normalizeNflProviderPlayerId(firstValue(payload, ['sportsDataIoTeamId', 'sportsDataTeamID'])),
    sleeperTeamId: providerId === 'sleeper' ? teamId : normalizeNflProviderPlayerId(firstValue(payload, ['sleeperTeamId'])),
    theSportsDbTeamId: providerId === 'thesportsdb' ? teamId : normalizeNflProviderPlayerId(firstValue(payload, ['theSportsDbTeamId', 'idTeam'])),
    apiSportsTeamId: providerId === 'api_sports' ? teamId : normalizeNflProviderPlayerId(firstValue(payload, ['apiSportsTeamId', 'api_sports_team_id'])),
    clearSportsTeamId: providerId === 'clearsports' ? teamId : normalizeNflProviderPlayerId(firstValue(payload, ['clearSportsTeamId', 'clear_sports_team_id'])),
  }
}

export function normalizeNflProviderPlayerIds(input: {
  providerId: NflRedraftPlayerIdentityProviderId
  payload: Record<string, unknown>
  allFantasyPlayerId?: string | null
}): NflRedraftProviderPlayerIds {
  const fields = PROVIDER_FIELD_CANDIDATES[input.providerId]
  const providerPlayerId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.playerId))
  const rollingInsightsId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.rollingInsightsId))
  const sportsDataIoId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.sportsDataIoId))
  const sleeperId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.sleeperId))
  const theSportsDbId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.theSportsDbId))
  const apiSportsId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.apiSportsId))
  const clearSportsId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.clearSportsId))
  const gsisId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.gsisId))
  const espnId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.espnId))
  const yahooId = normalizeNflProviderPlayerId(firstValue(input.payload, fields.yahooId))
  const allFantasyPlayerId =
    normalizeNflProviderPlayerId(input.allFantasyPlayerId) ??
    normalizeNflProviderPlayerId(firstValue(input.payload, ['allFantasyPlayerId', 'all_fantasy_player_id'])) ??
    buildAllFantasyPlayerId({
      providerId: input.providerId,
      providerPlayerId,
      playerName: firstString(input.payload, fields.fullName),
      team: firstString(input.payload, fields.team),
      position: firstString(input.payload, fields.position),
    })

  return {
    allFantasyPlayerId,
    primaryProviderId: input.providerId,
    providerPlayerId,
    rollingInsightsId,
    sportsDataIoId,
    sleeperId,
    theSportsDbId,
    apiSportsId,
    clearSportsId,
    gsisId,
    espnId,
    yahooId,
  }
}

export function buildAllFantasyPlayerId(input: {
  providerId: NflRedraftPlayerIdentityProviderId
  providerPlayerId: string | null
  playerName?: string | null
  team?: string | null
  position?: string | null
}): string {
  if (input.providerPlayerId) return `af:nfl:${input.providerId}:${slugPart(input.providerPlayerId)}`
  return `af:nfl:name:${slugPart(input.playerName)}:${slugPart(normalizeTeamAbbrev(input.team))}:${slugPart(normalizePosition(input.position))}`
}

export function normalizeNflRedraftProviderPlayerIdentity(
  input: NormalizeNflRedraftPlayerIdentityInput,
): NflRedraftCanonicalPlayerIdentity {
  const fields = PROVIDER_FIELD_CANDIDATES[input.providerId]
  const now = input.now ?? new Date()
  const fetchedAtIso = input.fetchedAtIso ?? now.toISOString()
  const providerTimestampIso =
    input.sourceUpdatedAtIso ??
    firstIsoString(input.payload, fields.updatedAt) ??
    input.lastSuccessfulSyncAtIso ??
    null
  const lastSuccessfulSyncAtIso = input.lastSuccessfulSyncAtIso ?? providerTimestampIso ?? fetchedAtIso
  const providerIds = normalizeNflProviderPlayerIds({
    providerId: input.providerId,
    payload: input.payload,
  })
  const firstName = firstString(input.payload, fields.firstName)
  const lastName = firstString(input.payload, fields.lastName)
  const playerName = normalizeName({
    fullName: firstString(input.payload, fields.fullName),
    firstName,
    lastName,
    fallbackId: providerIds.providerPlayerId,
  })
  const preferredDisplayName = firstString(input.payload, fields.displayName) ?? playerName
  const team = normalizeNflProviderTeamAbbreviation(firstValue(input.payload, fields.team))
  const position = normalizeNflProviderPosition(firstValue(input.payload, fields.position))
  const fantasyPositions = normalizeNflFantasyPositions(position, firstValue(input.payload, fields.fantasyPositions))
  const providerTeamIds = normalizeNflProviderTeamIds(input.providerId, input.payload)
  const freshness = buildNflRedraftProviderFreshness({
    updatedAtIso: providerTimestampIso ?? lastSuccessfulSyncAtIso,
    maxAgeMinutes: DEFAULT_IDENTITY_MAX_AGE_MINUTES,
    now,
  })
  const warnings = buildIdentityWarnings({
    playerName,
    providerIds,
    team,
    position,
    fantasyPositions,
    freshness,
  })

  return {
    modelVersion: NFL_REDRAFT_PLAYER_IDENTITY_MODEL_VERSION,
    allFantasyPlayerId: providerIds.allFantasyPlayerId,
    providerIds,
    playerName,
    preferredDisplayName,
    team,
    providerTeamIds,
    position,
    fantasyPositions,
    jerseyNumber: firstNumber(input.payload, fields.jerseyNumber),
    headshotUrl: normalizeNflHeadshotUrl(firstValue(input.payload, fields.headshotUrl)),
    teamLogoUrl: normalizeNflTeamLogoUrl(firstValue(input.payload, fields.teamLogoUrl), team),
    height: firstString(input.payload, fields.height),
    weight: firstNumber(input.payload, fields.weight),
    age: firstNumber(input.payload, fields.age),
    experience: firstNumber(input.payload, fields.experience),
    college: firstString(input.payload, fields.college),
    byeWeek: firstNumber(input.payload, fields.byeWeek),
    activeStatus: normalizeActiveStatus(firstValue(input.payload, fields.activeStatus)),
    sourceProviderId: input.providerId,
    cache: {
      providerId: input.providerId,
      fetchedAtIso,
      providerTimestampIso,
      lastSuccessfulSyncAtIso,
      freshness,
      stale: freshness.status === 'stale',
      fallback: input.fallback === true,
      warnings,
    },
  }
}

export function toCanonicalNflRedraftPlayerIdentityRecord(
  input: NormalizeNflRedraftPlayerIdentityInput,
): CanonicalNflRedraftProviderRecord<NflRedraftCanonicalPlayerIdentity> {
  const identity = normalizeNflRedraftProviderPlayerIdentity(input)
  return toCanonicalNflRedraftProviderRecord({
    providerId: input.providerId,
    providerRecordId: identity.providerIds.providerPlayerId ?? identity.allFantasyPlayerId,
    data: identity,
    fetchedAtIso: identity.cache.fetchedAtIso,
    sourceUpdatedAtIso: identity.cache.providerTimestampIso,
    maxAgeMinutes: identity.cache.freshness.maxAgeMinutes,
    fallback: identity.cache.fallback,
    warnings: identity.cache.warnings,
    now: input.now,
  })
}

export function normalizeRollingInsightsPlayerIdentity(
  payload: Record<string, unknown>,
  options: Omit<NormalizeNflRedraftPlayerIdentityInput, 'providerId' | 'payload'> = {},
): NflRedraftCanonicalPlayerIdentity {
  return normalizeNflRedraftProviderPlayerIdentity({ ...options, providerId: 'rolling_insights', payload })
}

export function normalizeSportsDataIoPlayerIdentity(
  payload: Record<string, unknown>,
  options: Omit<NormalizeNflRedraftPlayerIdentityInput, 'providerId' | 'payload'> = {},
): NflRedraftCanonicalPlayerIdentity {
  return normalizeNflRedraftProviderPlayerIdentity({ ...options, providerId: 'sportsdataio', payload })
}

export function normalizeSleeperPlayerIdentity(
  payload: Record<string, unknown>,
  options: Omit<NormalizeNflRedraftPlayerIdentityInput, 'providerId' | 'payload'> = {},
): NflRedraftCanonicalPlayerIdentity {
  return normalizeNflRedraftProviderPlayerIdentity({ ...options, providerId: 'sleeper', payload })
}

export function normalizeTheSportsDbPlayerIdentity(
  payload: Record<string, unknown>,
  options: Omit<NormalizeNflRedraftPlayerIdentityInput, 'providerId' | 'payload'> = {},
): NflRedraftCanonicalPlayerIdentity {
  return normalizeNflRedraftProviderPlayerIdentity({ ...options, providerId: 'thesportsdb', payload })
}

export function normalizeApiSportsPlayerIdentity(
  payload: Record<string, unknown>,
  options: Omit<NormalizeNflRedraftPlayerIdentityInput, 'providerId' | 'payload'> = {},
): NflRedraftCanonicalPlayerIdentity {
  return normalizeNflRedraftProviderPlayerIdentity({ ...options, providerId: 'api_sports', payload })
}

export function normalizeClearSportsPlayerIdentity(
  payload: Record<string, unknown>,
  options: Omit<NormalizeNflRedraftPlayerIdentityInput, 'providerId' | 'payload'> = {},
): NflRedraftCanonicalPlayerIdentity {
  return normalizeNflRedraftProviderPlayerIdentity({ ...options, providerId: 'clearsports', payload })
}

function buildIdentityWarnings(input: {
  playerName: string
  providerIds: NflRedraftProviderPlayerIds
  team: string | null
  position: string | null
  fantasyPositions: NflRedraftFantasyPosition[]
  freshness: NflRedraftProviderFreshness
}): string[] {
  const warnings: string[] = []
  if (!input.providerIds.providerPlayerId) warnings.push('Provider player ID missing; AllFantasy ID was derived from player attributes.')
  if (input.playerName === 'Unknown Player' || input.playerName.startsWith('Unknown Player ')) warnings.push('Player name missing from provider payload.')
  if (!input.team) warnings.push('Team missing or unmapped.')
  if (!input.position) warnings.push('Position missing or unmapped.')
  if (input.fantasyPositions.length === 0) warnings.push('Fantasy positions missing or unmapped.')
  if (input.freshness.status === 'missing') warnings.push('Provider freshness timestamp missing.')
  if (input.freshness.status === 'stale') warnings.push('Provider identity data is stale.')
  return warnings
}
