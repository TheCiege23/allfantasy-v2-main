/**
 * Decision OS Core — SportAdapter factory built from existing sport data (Phase 1).
 *
 * Thin wrapper only: derives a `SportAdapter` from the existing `SportConfigFull`
 * registry (`lib/sportConfig`) and, where one exists, the existing redraft
 * `SportAdapter` (`lib/redraft/sportAdapters`) for stat parsing / lock time.
 * No sport config is modified or duplicated — this reads the same data other
 * code already reads.
 */

import type { SportConfigFull } from '@/lib/sportConfig/types'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { tryGetSportAdapter } from '@/lib/redraft/sportAdapters'
import type { SportAdapter } from '../types'
import type { CompetitionStructure, ScheduleUnit } from '../../primitives/types'

function deriveScheduleUnit(config: SportConfigFull): ScheduleUnit {
  const lock = (config.lineupLockType || config.lineupFrequency || '').toLowerCase()
  if (lock.includes('daily') || lock === 'per_event' || lock.includes('per_match')) return 'slate'
  return 'week'
}

function deriveCompetitionStructure(_config: SportConfigFull): CompetitionStructure {
  // Every SportConfigFull entry today models a season-long fantasy format;
  // non-season-long structures (single_slate, best_of_n_series) have no
  // config source yet and are intentionally not fabricated here.
  return 'season_long_h2h'
}

/**
 * Only NFL has a wired provider data-coverage signal today (see
 * `SportAdapter.tracksProviderDataCoverage`'s doc comment). This is the single
 * declared place that fact lives — deliberately not derived from any
 * `SportConfigFull` field, since no such field exists yet for any sport.
 */
function deriveTracksProviderDataCoverage(config: SportConfigFull): boolean {
  return config.sport === 'NFL'
}

/**
 * Builds a SportAdapter for any sport present in `lib/sportConfig`'s registry.
 * Returns null (never throws) when the sport has no config — safe, deterministic
 * degradation matching the Canonical World's "null over fabrication" convention.
 */
export function buildSportAdapterFromConfig(sport: string): SportAdapter | null {
  const config = tryGetSportConfig(sport)
  if (!config) return null

  const legacyAdapter = tryGetSportAdapter(sport)

  return {
    sport: config.sport,
    scheduleUnit: deriveScheduleUnit(config),
    competitionStructure: deriveCompetitionStructure(config),
    rosterSlotCategories: Array.from(new Set(config.defaultRosterSlots.map((s) => s.key))),
    scoringStatVocabulary: config.scoringCategories.map((c) => c.key),
    supportsIDP: config.supportsIDP,
    tracksProviderDataCoverage: deriveTracksProviderDataCoverage(config),
    parseRawStats(raw: Record<string, number>): Record<string, number> {
      if (legacyAdapter) return legacyAdapter.parseRawStats(raw)
      const vocabulary = new Set(config.scoringCategories.map((c) => c.key))
      const parsed: Record<string, number> = {}
      for (const key of vocabulary) parsed[key] = raw[key] ?? 0
      return parsed
    },
    getLineupLockTime(gameTimeIso: string): Date {
      if (legacyAdapter) return legacyAdapter.getLineupLockTime(config.sport, gameTimeIso)
      return new Date(gameTimeIso)
    },
  }
}
