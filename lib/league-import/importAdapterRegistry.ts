/**
 * Provider adapter registry — supported platforms and pipeline coverage.
 * Per-adapter instances: `LeagueImportRegistry` (`getAdapter`, `hasFullAdapter`, …).
 * Raw fetch + normalization: `ImportedLeagueNormalizationPipeline` + `adapters/*`.
 */

import type { ImportProvider } from '@/lib/league-import/types'

/** Platforms with first-class normalization (see `ImportedLeagueNormalizationPipeline`). */
export const FULL_PIPELINE_PROVIDERS: ImportProvider[] = ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']

