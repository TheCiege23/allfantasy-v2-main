/**
 * Shared options for player-data adapters (no HTTP; DB/cache rows only).
 */

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

