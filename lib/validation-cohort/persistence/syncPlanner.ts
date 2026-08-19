/**
 * Fantasy OS Suite — Phase V8.1: incremental synchronization planner (pure).
 *
 * Decides, per discovered league, whether to import it — enforcing the core policy:
 *   - completed (non-current) seasons are IMMUTABLE → imported once, then skipped (overlap prevention);
 *   - the current season is refreshed incrementally on each run.
 * A customer request must never trigger a full rebuild; this planner is only invoked by the explicit
 * internal import workflow, and it always skips already-persisted immutable seasons.
 */
import type { DiscoveredLeague } from '../types'

export type SyncAction = 'import' | 'skip-immutable' | 'refresh-current'

export type SyncDecision = {
  leagueReference: string
  season: string
  action: SyncAction
  reason: string
}

export type SyncPlan = {
  decisions: SyncDecision[]
  toImport: DiscoveredLeague[]
  skippedCount: number
}

/** Is a season completed (immutable) relative to the current season? Lexical compare works for YYYY. */
export function isCompletedSeason(season: string, currentSeason: string): boolean {
  return season < currentSeason
}

/**
 * Build a sync plan. `alreadyStored` is the set of league references already persisted (from the store),
 * used to skip immutable seasons already imported.
 */
export function planSync(
  leagues: DiscoveredLeague[],
  alreadyStored: Set<string>,
  currentSeason: string,
): SyncPlan {
  const decisions: SyncDecision[] = []
  const toImport: DiscoveredLeague[] = []

  for (const league of leagues) {
    const completed = isCompletedSeason(league.season, currentSeason)
    if (completed) {
      if (alreadyStored.has(league.leagueReference)) {
        decisions.push({
          leagueReference: league.leagueReference,
          season: league.season,
          action: 'skip-immutable',
          reason: 'completed season already imported (immutable) — overlap prevented',
        })
        continue
      }
      decisions.push({
        leagueReference: league.leagueReference,
        season: league.season,
        action: 'import',
        reason: 'completed season not yet imported — import once',
      })
      toImport.push(league)
    } else {
      decisions.push({
        leagueReference: league.leagueReference,
        season: league.season,
        action: 'refresh-current',
        reason: 'current season — incremental refresh',
      })
      toImport.push(league)
    }
  }

  const skippedCount = decisions.filter((d) => d.action === 'skip-immutable').length
  return { decisions, toImport, skippedCount }
}
