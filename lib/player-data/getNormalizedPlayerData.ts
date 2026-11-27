/**
 * Normalized player rows for product surfaces — wraps `getPlayerDataForSurface`
 * with optional provider-fallback diagnostics (no extra HTTP).
 */

import {
  buildPlayerFallbackDiagnostics,
  type ProviderFallbackDiagnostics,
} from '@/lib/player-data/providerFallbackDiagnostics'
import {
  getPlayerDataForSurface,
  type GetPlayerDataForSurfaceInput,
} from '@/lib/player-data/getPlayerDataForSurface'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { PlayerDataSurface } from '@/lib/player-data/unifiedPlayerProductView'
import { hasNumericSoccerTeam, loadSoccerClubNames, soccerClubFor, type SoccerClub } from '@/lib/soccer/soccerClubNames'

export type NormalizedPlayerSurface = PlayerDataSurface

export type GetNormalizedPlayerDataInput = GetPlayerDataForSurfaceInput & {
  /** Adds `providerFallbackDiagnostics` for QA / dev overlays — never blocks core rows. */
  includeProviderFallbackDiagnostics?: boolean
}

export type { ProviderFallbackDiagnostics }

export type NormalizedPlayerDataRow = UnifiedPlayerProductView & {
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics
}

/**
 * Server-side: reads DB/cache via existing orchestration; surfaces should migrate incrementally.
 */
export async function getNormalizedPlayerData(
  input: GetNormalizedPlayerDataInput,
): Promise<NormalizedPlayerDataRow[]> {
  const { includeProviderFallbackDiagnostics, ...rest } = input
  const rows = await getPlayerDataForSurface(rest)
  // Soccer shows the club, not Rolling Insights' numeric club id (lib/soccer/soccerClubNames.ts).
  if (hasNumericSoccerTeam(rows)) {
    const clubs = await loadSoccerClubNames().catch(() => new Map<string, SoccerClub>())
    for (const row of rows) {
      if (String(row.sport).toUpperCase() !== 'SOCCER') continue
      const club = soccerClubFor(row.team, clubs)
      if (club) row.team = club.shortName ?? club.name
    }
  }

  return rows.map((u) => {
    if (!includeProviderFallbackDiagnostics) return { ...u }
    return {
      ...u,
      providerFallbackDiagnostics: buildPlayerFallbackDiagnostics(u, input.surface),
    }
  })
}
