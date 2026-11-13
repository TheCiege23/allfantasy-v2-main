/**
 * Soccer creation pipeline — MLS vs European competition data feeds.
 * Persisted on `League.settings.soccer_pipeline` (and optional top-level create payload).
 */

export type SoccerPipeline = 'mls' | 'euro'

export function isSoccerPipeline(value: unknown): value is SoccerPipeline {
  return value === 'mls' || value === 'euro'
}

