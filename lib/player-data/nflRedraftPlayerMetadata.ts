import type {
  NflRedraftCanonicalPlayerIdentity,
  NflRedraftFantasyPosition,
  NflRedraftPlayerActiveStatus,
} from '@/lib/nfl-provider/nflRedraftPlayerIdentity'
import type { NflRedraftCanonicalPlayer, NflRedraftDataState } from '@/lib/player-data/nflRedraftCanonicalPlayer'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { normalizePosition, normalizeTeamAbbrev } from '@/lib/team-abbrev'

export const NFL_REDRAFT_PLAYER_METADATA_MODEL_VERSION = 'nfl-redraft-player-metadata-v1' as const

export type NflRedraftPlayerMediaFallbackKind =
  | 'none'
  | 'player-initials'
  | 'team-badge'
  | 'team-text-badge'
  | 'generic-player'

export type NflRedraftPlayerMediaMetadata = {
  url: string | null
  safeToRenderImage: boolean
  fallbackUrl: string | null
  fallbackKind: NflRedraftPlayerMediaFallbackKind
  fallbackLabel: string | null
  fallbackReason: string | null
}

export type NflRedraftProviderFreshnessMetadata = {
  status: NflRedraftDataState
  updatedAtIso: string | null
  ageMinutes: number | null
  maxAgeMinutes: number | null
  stale: boolean
  warnings: string[]
}

export type NflRedraftProviderFallbackMetadata = {
  fallback: boolean
  fields: string[]
  labels: string[]
}

export type NflRedraftPlayerDisplayMetadata = {
  modelVersion: typeof NFL_REDRAFT_PLAYER_METADATA_MODEL_VERSION
  displayName: string
  playerName: string
  teamAbbr: string | null
  position: string | null
  fantasyPositions: string[]
  jerseyNumber: number | null
  headshot: NflRedraftPlayerMediaMetadata
  teamLogo: NflRedraftPlayerMediaMetadata
  byeWeek: number | null
  activeStatus: NflRedraftPlayerActiveStatus | string | null
  providerFreshness: NflRedraftProviderFreshnessMetadata
  providerFallback: NflRedraftProviderFallbackMetadata
}

type BuildMetadataInput = {
  displayName: string | null
  playerName?: string | null
  teamAbbr?: string | null
  position?: string | null
  fantasyPositions?: Array<string | null | undefined>
  jerseyNumber?: number | null
  headshotUrl?: string | null
  headshotFallbackKind?: NflRedraftPlayerMediaFallbackKind
  headshotFallbackReason?: string | null
  teamLogoUrl?: string | null
  teamLogoFallbackKind?: NflRedraftPlayerMediaFallbackKind
  teamLogoFallbackReason?: string | null
  byeWeek?: number | null
  activeStatus?: NflRedraftPlayerActiveStatus | string | null
  providerFreshness?: Partial<NflRedraftProviderFreshnessMetadata>
  providerFallback?: Partial<NflRedraftProviderFallbackMetadata>
}

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase() || 'P'
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => cleanString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )
}

function mediaMetadata(input: {
  url: string | null | undefined
  fallbackKind: NflRedraftPlayerMediaFallbackKind
  fallbackLabel: string | null
  fallbackReason: string | null
}): NflRedraftPlayerMediaMetadata {
  const url = cleanString(input.url)
  const safeUrl = isHttpUrl(url) ? url : null
  return {
    url: safeUrl,
    safeToRenderImage: Boolean(safeUrl),
    fallbackUrl: null,
    fallbackKind: safeUrl ? 'none' : input.fallbackKind,
    fallbackLabel: safeUrl ? null : input.fallbackLabel,
    fallbackReason: safeUrl ? null : input.fallbackReason,
  }
}

function stateFromIdentity(status: string | null | undefined): NflRedraftDataState {
  if (status === 'fresh') return 'available'
  if (status === 'stale') return 'stale'
  if (status === 'missing') return 'missing'
  return 'unknown'
}

export function buildNflRedraftPlayerMetadata(input: BuildMetadataInput): NflRedraftPlayerDisplayMetadata {
  const playerName = cleanString(input.playerName) ?? cleanString(input.displayName) ?? 'Unknown Player'
  const displayName = cleanString(input.displayName) ?? playerName
  const teamAbbr = normalizeTeamAbbrev(input.teamAbbr)
  const position = normalizePosition(input.position)
  const fantasyPositions = uniqueStrings([position, ...(input.fantasyPositions ?? [])])
  const freshnessStatus = input.providerFreshness?.status ?? 'unknown'
  const freshnessWarnings = uniqueStrings(input.providerFreshness?.warnings ?? [])
  const fallbackFields = uniqueStrings(input.providerFallback?.fields ?? [])
  const fallbackLabels = uniqueStrings(input.providerFallback?.labels ?? fallbackFields)
  const fallback = input.providerFallback?.fallback ?? fallbackFields.length > 0

  return {
    modelVersion: NFL_REDRAFT_PLAYER_METADATA_MODEL_VERSION,
    displayName,
    playerName,
    teamAbbr,
    position,
    fantasyPositions,
    jerseyNumber: finiteNumber(input.jerseyNumber),
    headshot: mediaMetadata({
      url: input.headshotUrl,
      fallbackKind: input.headshotFallbackKind ?? 'player-initials',
      fallbackLabel: initialsForName(displayName),
      fallbackReason: input.headshotFallbackReason ?? 'Player headshot unavailable.',
    }),
    teamLogo: mediaMetadata({
      url: input.teamLogoUrl,
      fallbackKind: input.teamLogoFallbackKind ?? (teamAbbr ? 'team-text-badge' : 'none'),
      fallbackLabel: teamAbbr,
      fallbackReason: input.teamLogoFallbackReason ?? (teamAbbr ? 'Team logo unavailable; render team text badge.' : null),
    }),
    byeWeek: finiteNumber(input.byeWeek),
    activeStatus: input.activeStatus ?? null,
    providerFreshness: {
      status: freshnessStatus,
      updatedAtIso: input.providerFreshness?.updatedAtIso ?? null,
      ageMinutes: input.providerFreshness?.ageMinutes ?? null,
      maxAgeMinutes: input.providerFreshness?.maxAgeMinutes ?? null,
      stale: input.providerFreshness?.stale ?? freshnessStatus === 'stale',
      warnings: freshnessWarnings,
    },
    providerFallback: {
      fallback,
      fields: fallbackFields,
      labels: fallbackLabels,
    },
  }
}

export function buildNflRedraftPlayerMetadataFromIdentity(
  identity: NflRedraftCanonicalPlayerIdentity,
): NflRedraftPlayerDisplayMetadata {
  return buildNflRedraftPlayerMetadata({
    displayName: identity.preferredDisplayName,
    playerName: identity.playerName,
    teamAbbr: identity.team,
    position: identity.position,
    fantasyPositions: identity.fantasyPositions as NflRedraftFantasyPosition[],
    jerseyNumber: identity.jerseyNumber,
    headshotUrl: identity.headshotUrl,
    teamLogoUrl: identity.teamLogoUrl,
    byeWeek: identity.byeWeek,
    activeStatus: identity.activeStatus,
    providerFreshness: {
      status: stateFromIdentity(identity.cache.freshness.status),
      updatedAtIso: identity.cache.freshness.updatedAtIso,
      ageMinutes: identity.cache.freshness.ageMinutes,
      maxAgeMinutes: identity.cache.freshness.maxAgeMinutes,
      stale: identity.cache.stale,
      warnings: identity.cache.warnings,
    },
    providerFallback: {
      fallback: identity.cache.fallback || identity.cache.warnings.length > 0,
      fields: identity.cache.warnings,
      labels: identity.cache.warnings,
    },
  })
}

export function buildNflRedraftPlayerMetadataFromCanonicalPlayer(
  player: NflRedraftCanonicalPlayer,
): NflRedraftPlayerDisplayMetadata {
  return buildNflRedraftPlayerMetadata({
    displayName: player.displayName,
    playerName: player.fullName,
    teamAbbr: player.teamAbbr,
    position: player.fantasyPosition ?? player.position,
    fantasyPositions: player.rosterEligibility,
    jerseyNumber: player.jerseyNumber,
    headshotUrl: player.media.headshot.url,
    headshotFallbackKind: player.media.headshot.fallbackKind === 'team-badge' ? 'team-badge' : 'player-initials',
    headshotFallbackReason: player.fallbacks.find((fallback) => fallback.field === 'headshotUrl')?.reason ?? null,
    teamLogoUrl: player.media.teamLogo.url,
    teamLogoFallbackKind: player.media.teamLogo.fallbackKind === 'team-text-badge' ? 'team-text-badge' : 'none',
    teamLogoFallbackReason: player.fallbacks.find((fallback) => fallback.field === 'teamLogoUrl')?.reason ?? null,
    byeWeek: player.byeWeek,
    activeStatus: player.activeStatus,
    providerFreshness: {
      status: player.dataFreshness.staleWarnings.length ? 'stale' : player.dataFreshness.profile,
      updatedAtIso: player.lastUpdatedAt,
      ageMinutes: null,
      maxAgeMinutes: null,
      stale: player.dataFreshness.staleWarnings.length > 0,
      warnings: player.dataFreshness.staleWarnings,
    },
    providerFallback: {
      fallback: player.fallbacks.length > 0,
      fields: player.fallbacks.map((fallback) => fallback.field),
      labels: player.fallbacks.map((fallback) => `${fallback.field}: ${fallback.reason}`),
    },
  })
}

export function buildNflRedraftPlayerMetadataFromWire(
  row: UnifiedPlayerWireDto,
): NflRedraftPlayerDisplayMetadata | null {
  if (row.nflRedraftPlayerMetadata) return row.nflRedraftPlayerMetadata
  if (row.nflRedraft) return buildNflRedraftPlayerMetadataFromCanonicalPlayer(row.nflRedraft)
  if (String(row.sport).toUpperCase() !== 'NFL') return null
  return buildNflRedraftPlayerMetadata({
    displayName: row.name,
    playerName: row.name,
    teamAbbr: row.team,
    position: row.position,
    fantasyPositions: row.position ? [row.position] : [],
    jerseyNumber: null,
    headshotUrl: row.headshotUrl,
    teamLogoUrl: row.teamLogoUrl,
    byeWeek: row.product?.byeWeek ?? null,
    activeStatus: null,
    providerFreshness: {
      status: row.lowConfidence ? 'unknown' : 'available',
      updatedAtIso: null,
      warnings: row.lowConfidence ? ['Limited confidence player metadata.'] : [],
    },
    providerFallback: {
      fallback: row.lowConfidence,
      fields: row.lowConfidence ? ['playerMetadata'] : [],
      labels: row.lowConfidence ? ['Limited confidence player metadata.'] : [],
    },
  })
}
