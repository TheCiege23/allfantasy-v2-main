/**
 * AllFantasy AI Intelligence System — shared contracts for league context, health, and snapshots.
 */

export type IntelligenceChipState = 'connected' | 'degraded' | 'unavailable'

/** Aggregated integration health (real signals — not env-only). */
export type IntelligencePlatformHealth = {
  database: IntelligenceChipState
  sportsData: IntelligenceChipState
  news: IntelligenceChipState
  aiEngine: IntelligenceChipState
  /** Configured + cached player pipeline indicates live sports enrichment path. */
  rollingInsights: IntelligenceChipState
  clearSports: IntelligenceChipState
  computedAt: string
}

