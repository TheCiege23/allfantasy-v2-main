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

  return rows.map((u) => {
    if (!includeProviderFallbackDiagnostics) return { ...u }
    return {
      ...u,
      providerFallbackDiagnostics: buildPlayerFallbackDiagnostics(u, input.surface),
    }
  })
}
