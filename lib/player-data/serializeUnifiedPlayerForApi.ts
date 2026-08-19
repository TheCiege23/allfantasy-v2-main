/**
 * JSON-safe wire format for `/api/.../players`, roster enrichment, and AI payloads.
 */

import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { NormalizedCollegeClass } from '@/lib/draft-room/collegeClass'
import type { ProviderFallbackDiagnostics } from '@/lib/player-data/providerFallbackDiagnostics'
import { getTeamLogo } from '@/lib/players/getTeamLogo'
import { safeTeamDefenseDisplayName } from '@/lib/redraft/teamDefenseIdentity'
import {
  buildNflRedraftCanonicalPlayer,
  type NflRedraftCanonicalPlayer,
} from '@/lib/player-data/nflRedraftCanonicalPlayer'
import {
  buildNflRedraftPlayerMetadataFromCanonicalPlayer,
  type NflRedraftPlayerDisplayMetadata,
} from '@/lib/player-data/nflRedraftPlayerMetadata'
import {
  buildNflRedraftPlayerIntelligenceFromCanonicalPlayer,
  type NflRedraftPlayerIntelligence,
} from '@/lib/player-data/nflRedraftPlayerIntelligence'
import {
  buildNflRedraftGameContextFromProductView,
  type NflRedraftGameContext,
} from '@/lib/player-data/nflRedraftGameContext'
import {
  buildNflRedraftLiveScoringContextFromProductView,
  type NflRedraftLiveScoringContext,
} from '@/lib/player-data/nflRedraftLiveScoringContext'

export type UnifiedPlayerWireDto = {
  id: string
  name: string
  position: string | null
  team: string | null
  sport: string
  headshotUrl: string | null
  imageUrl: string | null
  teamLogoUrl: string | null
  injuryStatus: string | null
  fantasyPointsPerGame: number | null
  projectedPoints: number | null
  adp: number | null
  aiAdp: number | null
  aiAdpSampleSize: number | null
  /** Normalized bucket (freshman, sophomore, …) */
  collegeClass: NormalizedCollegeClass | string
  collegeClassLabel: string | null
  soccerLeague: string | null
  nflRookieIsRookie: boolean | null
  nflRookieSource: string | null
  lowConfidence: boolean
  profileSource: string | null
  statsSource: string | null
  projectionsSource: string | null
  normalizedStats: Record<string, unknown>
  normalizedProjections: Record<string, unknown>
  /** Canonical NFL redraft player snapshot for draft, roster, waiver, trade, and matchup projections. */
  nflRedraft?: NflRedraftCanonicalPlayer | null
  /** Display-safe NFL redraft media/metadata snapshot with no provider-specific ids or payloads. */
  nflRedraftPlayerMetadata?: NflRedraftPlayerDisplayMetadata | null
  /** Display-safe NFL redraft projections, rankings, injuries, news, and freshness metadata. */
  nflRedraftPlayerIntelligence?: NflRedraftPlayerIntelligence | null
  /** Display-safe NFL redraft schedule, opponent, stadium, and weather context. */
  nflRedraftGameContext?: NflRedraftGameContext | null
  /** Display-safe NFL redraft live stats, scoring refresh, and stat correction context. */
  nflRedraftLiveScoringContext?: NflRedraftLiveScoringContext | null
  /** Nested snapshot for AI / advanced clients */
  product: {
    unified: UnifiedPlayerProductView['unified']
    yearsExp: number | null
    isRookie?: boolean
    byeWeek?: number | null
  }
  /** Present when rows came from `getNormalizedPlayerData` with diagnostics enabled */
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics
}

export type { ProviderFallbackDiagnostics }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanString(source[key])
    if (value) return value
  }
  return null
}

export function serializeUnifiedPlayerForApi(entry: UnifiedPlayerProductView): UnifiedPlayerWireDto {
  const u = entry.unified
  const displayAssets =
    entry.display?.assets && typeof entry.display.assets === 'object'
      ? (entry.display.assets as { teamLogoUrl?: string | null })
      : null
  const teamLogoUrl =
    displayAssets?.teamLogoUrl ?? getTeamLogo(u.teamAbbr ?? u.team, String(u.sport))
  const nflRedraft = buildNflRedraftCanonicalPlayer(entry, { teamLogoUrl })
  const nflRedraftPlayerMetadata = nflRedraft
    ? buildNflRedraftPlayerMetadataFromCanonicalPlayer(nflRedraft)
    : null
  const nflRedraftPlayerIntelligence = nflRedraft
    ? buildNflRedraftPlayerIntelligenceFromCanonicalPlayer(nflRedraft, {
        adpSource: u.adpSource,
        aiAdp: u.aiAdp,
        aiAdpSampleSize: u.aiAdpSampleSize,
        trendLabel: firstString(
          { ...asRecord(u.normalizedStats), ...asRecord(u.normalizedProjections) },
          ['trendLabel', 'playerTrendLabel', 'trend', 'trendingDirection'],
        ),
      })
    : null
  const nflRedraftGameContext = buildNflRedraftGameContextFromProductView(entry)
  const nflRedraftLiveScoringContext = buildNflRedraftLiveScoringContextFromProductView(entry)
  const diag: ProviderFallbackDiagnostics | undefined =
    'providerFallbackDiagnostics' in entry && entry.providerFallbackDiagnostics
      ? (entry.providerFallbackDiagnostics as ProviderFallbackDiagnostics)
      : undefined
  return {
    id: u.playerId,
    // Team defenses are named from their canonical id (e.g. nfl:def:KC → "KC
    // Defense") even when the normalized-player foundation has no entry — reusable
    // across all league types; offensive names pass through untouched.
    name: safeTeamDefenseDisplayName(u.playerId, u.fullName),
    position: u.position || null,
    team: u.teamAbbr ?? u.team,
    sport: String(u.sport),
    headshotUrl: u.headshotUrl,
    imageUrl: u.headshotUrl,
    teamLogoUrl,
    injuryStatus: u.injuryStatus,
    fantasyPointsPerGame: u.fantasyPointsPerGame,
    projectedPoints: u.projectedPoints,
    adp: u.adp,
    aiAdp: u.aiAdp,
    aiAdpSampleSize: u.aiAdpSampleSize,
    collegeClass: u.collegeClass,
    collegeClassLabel: u.collegeClassRaw,
    soccerLeague: u.soccerLeague,
    nflRookieIsRookie: u.nflRookie?.isRookie ?? null,
    nflRookieSource: u.nflRookie?.source ?? null,
    lowConfidence: u.lowConfidence,
    profileSource: u.profileSource,
    statsSource: u.statsSource,
    projectionsSource: u.projectionsSource,
    normalizedStats: u.normalizedStats,
    normalizedProjections: u.normalizedProjections,
    ...(nflRedraft ? { nflRedraft } : {}),
    ...(nflRedraftPlayerMetadata ? { nflRedraftPlayerMetadata } : {}),
    ...(nflRedraftPlayerIntelligence ? { nflRedraftPlayerIntelligence } : {}),
    ...(nflRedraftGameContext ? { nflRedraftGameContext } : {}),
    ...(nflRedraftLiveScoringContext ? { nflRedraftLiveScoringContext } : {}),
    product: {
      unified: u,
      yearsExp: entry.yearsExp ?? null,
      isRookie: entry.isRookie,
      byeWeek: entry.byeWeek ?? null,
    },
    ...(diag ? { providerFallbackDiagnostics: diag } : {}),
  }
}
