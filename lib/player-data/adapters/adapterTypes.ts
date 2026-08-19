/**
 * Shared options for player-data adapters (no HTTP; DB/cache rows only).
 */

import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'
import type { ProviderFallbackDiagnostics } from '@/lib/player-data/providerFallbackDiagnostics'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { NflRedraftPlayerDisplayMetadata } from '@/lib/player-data/nflRedraftPlayerMetadata'
import type { NflRedraftPlayerIntelligence } from '@/lib/player-data/nflRedraftPlayerIntelligence'
import type { NflRedraftGameContext } from '@/lib/player-data/nflRedraftGameContext'
import type { NflRedraftLiveScoringContext } from '@/lib/player-data/nflRedraftLiveScoringContext'

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
  /** Display-safe canonical NFL redraft media/metadata; no provider ids or payloads. */
  canonicalPlayerMetadata?: NflRedraftPlayerDisplayMetadata | null
  /** Display-safe canonical NFL redraft projections, rankings, injuries, news, and freshness. */
  canonicalPlayerIntelligence?: NflRedraftPlayerIntelligence | null
  /** Display-safe canonical NFL schedule, opponent, stadium, and weather context. */
  canonicalGameContext?: NflRedraftGameContext | null
  /** Display-safe canonical NFL live stats, scoring refresh, and stat correction context. */
  canonicalLiveScoringContext?: NflRedraftLiveScoringContext | null
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics
}
