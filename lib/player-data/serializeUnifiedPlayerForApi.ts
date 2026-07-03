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

export function serializeUnifiedPlayerForApi(entry: UnifiedPlayerProductView): UnifiedPlayerWireDto {
  const u = entry.unified
  const displayAssets =
    entry.display?.assets && typeof entry.display.assets === 'object'
      ? (entry.display.assets as { teamLogoUrl?: string | null })
      : null
  const teamLogoUrl =
    displayAssets?.teamLogoUrl ?? getTeamLogo(u.teamAbbr ?? u.team, String(u.sport))
  const nflRedraft = buildNflRedraftCanonicalPlayer(entry, { teamLogoUrl })
  const diag =
    'providerFallbackDiagnostics' in entry && entry.providerFallbackDiagnostics
      ? entry.providerFallbackDiagnostics
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
    product: {
      unified: u,
      yearsExp: entry.yearsExp ?? null,
      isRookie: entry.isRookie,
      byeWeek: entry.byeWeek ?? null,
    },
    ...(diag ? { providerFallbackDiagnostics: diag } : {}),
  }
}
