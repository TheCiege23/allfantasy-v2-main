/**
 * Phase 3.1 Rankings wiring — pure derivation of `LegacyEvidenceRecord` rows from
 * normalized Sleeper import data (schema-free; existing table).
 *
 * The aggregator (`LegacyEvidenceAggregator`) currently reads `legacyEvidenceRecord`
 * as its primary source, but that table is only seeded with defaults. Imports never
 * populate it, so imported Sleeper history doesn't move rank. This module derives
 * evidence rows from the normalized import result so imported facts count.
 *
 * ✅ EVERY PROVIDER, since 2026-09-12. This said "Sleeper only (per Phase 3.1 scope)",
 * and the scope was the whole reason — nothing in here was Sleeper-specific except a
 * hardcoded `sleeper:` prefix on `sourceReference`. Pure function → unit-testable.
 *
 * 🛑 ONE PRECONDITION HAD TO BE FIXED FIRST, AND IT WAS NOT IN THIS FILE. `championships`
 * is written for every `rank === 1`, so a provider whose adapter SYNTHESISES rank would
 * have had a title awarded to an arbitrary team in every league. Fleaflicker's adapter
 * used `rank: i + 1` (array position) until the same change that widened this gate.
 * ESPN, Yahoo, MFL and Fantrax were already safe: they use `team.rank ?? teams.length`,
 * so an unknown rank falls to LAST place and can never win anything.
 *
 * ⚠ Before extending this to a SEVENTH provider, check that adapter's `rank` the same
 * way. A rank that is really an array index is indistinguishable here from a real one.
 *
 * Evidence types written:
 *   - `championships`         (per season the roster finished rank=1)
 *   - `win_pct`               (single row per import: overall regular-season pct across seasons)
 *   - `playoff_appearances`   (per season the roster placed in the top `playoff_team_count`)
 *   - `staying_power`         (count of seasons in the previous_league_id chain — dynasty proxy)
 *
 * The values match the aggregator's conventions:
 *   - Percentage-like values are clamped 0..100.
 *   - Counts (championships / playoff appearances) are 1-per-row (aggregator averages count).
 *   - staying_power is emitted once as a single 0..100 value (seasons capped at 10).
 */

import type { NormalizedImportResult, NormalizedStandingsEntry } from '@/lib/league-import/types'

export interface DerivedEvidenceRow {
  entityType: string
  entityId: string
  sport: string
  evidenceType: string
  value: number
  sourceReference: string
}

interface Options {
  /**
   * Playoff team count from the imported league settings. When unknown, we skip
   * playoff-appearance rows rather than guess (`playoffTeamCount` can be inferred
   * from `NormalizedLeagueSettings.playoff_team_count`, defaulting when absent).
   */
  playoffTeamCount?: number | null
  /**
   * Number of historical seasons detected in the previous_league_id chain
   * (from `raw.previousSeasons`). Drives `staying_power`.
   */
  previousSeasonCount?: number
}

const clamp0to100 = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n)

/**
 * Derive `LegacyEvidenceRecord` rows for a single normalized import. Returns an
 * empty array when there is nothing to write; the caller is responsible for the
 * DB insert (kept out of this pure function for testability).
 */
export function deriveEvidenceRowsFromImport(
  normalized: NormalizedImportResult,
  options: Options = {},
): DerivedEvidenceRow[] {
  const sport = normalized.league.sport ?? 'nfl'
  /*
   * 🛑 THE PROVIDER WAS HARDCODED `sleeper:`, AND IT WAS THE ONLY PROVIDER-SPECIFIC
   * LINE IN THIS FILE. Every other input — standings, sport, league id — is produced
   * identically by all six adapters, so "Sleeper only (per Phase 3.1 scope)" in the
   * header above was a SCOPE decision, not a technical limit.
   *
   * ⚠ IT IS ALSO THE DE-DUPLICATION KEY. `importPersistenceService` clears previous
   * evidence by `sourceReference` before rewriting it, so a wrong prefix here would
   * either fail to clear a league's old rows (duplicates on every refresh) or clear
   * a DIFFERENT league's. Two leagues with the same numeric id on different providers
   * is not hypothetical — ESPN and Fleaflicker ids are both bare integers.
   */
  const sourceRef = `${normalized.source.source_provider}:${normalized.source.source_league_id}`
  const standings: NormalizedStandingsEntry[] = normalized.standings ?? []
  if (standings.length === 0 && (options.previousSeasonCount ?? 0) === 0) {
    return []
  }

  const rows: DerivedEvidenceRow[] = []

  // Per-team evidence. Uses `source_team_id` as the entity id so the aggregator can
  // resolve it against `LegacyEvidenceAggregator`'s `asKey(entityId)` lookup against
  // roster/platformUserId. This matches the aggregator's existing convention.
  for (const s of standings) {
    const entityId = s.source_team_id
    const games = (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0)
    if (games > 0) {
      const winPct = ((s.wins ?? 0) / games) * 100
      rows.push({
        entityType: 'ROSTER',
        entityId,
        sport,
        evidenceType: 'win_pct',
        value: clamp0to100(winPct),
        sourceReference: sourceRef,
      })
    }
    if ((s.rank ?? 0) === 1) {
      rows.push({
        entityType: 'ROSTER',
        entityId,
        sport,
        evidenceType: 'championships',
        // Aggregator averages values within a type, so per-championship rows use 100.
        value: 100,
        sourceReference: sourceRef,
      })
    }
    if (
      typeof options.playoffTeamCount === 'number' &&
      options.playoffTeamCount > 0 &&
      typeof s.rank === 'number' &&
      s.rank <= options.playoffTeamCount
    ) {
      rows.push({
        entityType: 'ROSTER',
        entityId,
        sport,
        evidenceType: 'playoff_appearances',
        value: 100,
        sourceReference: sourceRef,
      })
    }
  }

  // League-level staying_power (dynasty proxy): 10 seasons in the chain caps at 100.
  const prevSeasons = options.previousSeasonCount ?? 0
  if (prevSeasons > 0) {
    for (const s of standings) {
      rows.push({
        entityType: 'ROSTER',
        entityId: s.source_team_id,
        sport,
        evidenceType: 'staying_power',
        value: clamp0to100(prevSeasons * 10),
        sourceReference: sourceRef,
      })
    }
  }

  return rows
}
