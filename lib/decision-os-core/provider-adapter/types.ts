/**
 * Decision OS Core — ProviderAdapter contract (Phase 1).
 *
 * Generalizes `lib/providers/providerFallbackPolicy.ts`'s existing `DataDomain` ×
 * `ProviderName` model — already the best-shaped abstraction in the codebase for
 * this problem (sport-independent domains, sport-conditional fallback chains).
 * This contract does not invent a new provider philosophy; it wraps the existing
 * fallback policy so callers can resolve a provider by domain/sport through a
 * registry instead of importing `providerFallbackPolicy` directly.
 *
 * See docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §13.3 / §15.
 */

/** == existing DataDomain in lib/providers/providerFallbackPolicy.ts */
export type DataDomain =
  | 'player_profile'
  | 'player_images'
  | 'team_profile'
  | 'team_logos'
  | 'player_stats'
  | 'team_stats'
  | 'projections'
  | 'live_scoring'
  | 'injuries'
  | 'schedules'
  | 'games'
  | 'adp'
  | 'ai_adp'
  | 'rookie_experience'
  | 'waiver_value'
  | 'trade_value'
  | 'roster_context'
  | 'lineup_context'

/** == existing ProviderName in lib/providers/providerFallbackPolicy.ts */
export type ProviderName =
  | 'rolling_insights'
  | 'thesportsdb'
  | 'clearsports'
  | 'sleeper'
  | 'allfantasy_internal'

export interface ProviderAdapter {
  providerName: ProviderName
  supportedSports: string[]
  supportedDomains: DataDomain[]
  /** Returns null on miss so callers can fall through the existing fallback chain. */
  fetch<T>(domain: DataDomain, sport: string, params: Record<string, unknown>): Promise<T | null>
}

/** Thrown by registry resolution when a provider has no registered adapter. */
export class UnknownProviderAdapterError extends Error {
  constructor(public readonly providerName: string) {
    super(`No ProviderAdapter registered for provider: ${providerName}`)
    this.name = 'UnknownProviderAdapterError'
  }
}
