/**
 * Shared options for player-data adapters (no HTTP; DB/cache rows only).
 */

import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'
import type { ProviderFallbackDiagnostics } from '@/lib/player-data/providerFallbackDiagnostics'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'

export type PlayerDataAdapterFlags = {
  includeStats?: boolean
  includeProjections?: boolean
  includeLive?: boolean
  includeInjuries?: boolean
  includeAdp?: boolean
  includeExperience?: boolean
  /** Dev / explicit QA — never default in user-facing stored state */
  includeProviderFallbackDiagnostics?: boolean
}

export type AdapterLeagueContext = {
  leagueId?: string | null
  sport?: string | null
  soccerLeague?: RollingInsightsSoccerLeagueCode | null
}

export type WithNormalizedLayers<T> = T & {
  /** Full unified view when built (draft pool, waivers, roster wire rows) */
  unifiedProductView?: UnifiedPlayerProductView
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics
}
