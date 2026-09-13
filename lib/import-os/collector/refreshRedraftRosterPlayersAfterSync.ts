/**
 * Fantasy OS — bring `RedraftRosterPlayer` in line with the rosters a sync just rewrote.
 *
 * 🛑 THE GAP THIS CLOSES. The collector rewrites `Roster.playerData` on every due league, and
 * nothing followed it into `RedraftRosterPlayer`. A player who left a team on the platform kept
 * an active redraft row forever. Measured 2026-09-13: 1,261 active imported rows for players on
 * no list of their roster, 234 of them also active on another team in the same league, which
 * the waiver engine reads as "already rostered in this season" and denies the claim.
 *
 * ⚠ IT RUNS AFTER THE SYNC, BOUNDED, AND IT NEVER FAILS IT. Materializing a league took ~13s in
 * the 2026-09-13 backfill, and the collector gives each connection a 4-minute run inside a 300s
 * invocation. Doing this inline in `persistScope` would let an enrichment time out the sync it
 * rides on. So the store only RECORDS which leagues' rosters changed, and this pass works through
 * them afterwards, with a league cap and a time budget, swallowing each league's error — the same
 * contract as the profile and matchup passes in the cron route.
 *
 * ⚠ A LEAGUE PAST THE BOUND IS DEFERRED AND REPORTED, NOT DROPPED SILENTLY. It is refreshed the
 * next time its rosters change, or by `backfill:redraft-roster-players`; `deferred` in the result
 * is what makes a starved tick visible.
 */
import type { MaterializeResult } from '@/lib/league-runtime/materializeRedraftRosterPlayers'

export interface RefreshAfterSyncResult {
  /** Distinct leagues whose rosters the sync changed this tick. */
  changedLeagues: number
  refreshed: number
  /** Changed, but past the league cap or the time budget. */
  deferred: number
  playersDropped: number
  playersCreated: number
  playersRepaired: number
  errors: Array<{ leagueId: string; error: string }>
}

export interface RefreshAfterSyncInput {
  results: ReadonlyArray<{ rosterChangedLeagueIds?: readonly string[] }>
  maxLeagues: number
  budgetMs: number
  /** Injectable for tests. Default = the real materializer. */
  materialize?: (leagueId: string) => Promise<Pick<MaterializeResult, 'playersDropped' | 'playersCreated' | 'playersRepaired'>>
  /** Injectable for tests. */
  now?: () => number
}

async function defaultMaterialize(leagueId: string) {
  const { materializeRedraftRosterPlayersForLeague } = await import(
    '@/lib/league-runtime/materializeRedraftRosterPlayers'
  )
  return materializeRedraftRosterPlayersForLeague(leagueId)
}

export async function refreshRedraftRosterPlayersAfterSync(
  input: RefreshAfterSyncInput,
): Promise<RefreshAfterSyncResult> {
  const now = input.now ?? Date.now
  const materialize = input.materialize ?? defaultMaterialize
  const leagueIds = [...new Set(input.results.flatMap((r) => r.rosterChangedLeagueIds ?? []))]
  const out: RefreshAfterSyncResult = {
    changedLeagues: leagueIds.length,
    refreshed: 0,
    deferred: 0,
    playersDropped: 0,
    playersCreated: 0,
    playersRepaired: 0,
    errors: [],
  }

  const deadline = now() + Math.max(0, input.budgetMs)
  for (const [index, leagueId] of leagueIds.entries()) {
    if (index >= input.maxLeagues || now() >= deadline) {
      out.deferred = leagueIds.length - index
      break
    }
    try {
      const r = await materialize(leagueId)
      out.refreshed += 1
      out.playersDropped += r.playersDropped
      out.playersCreated += r.playersCreated
      out.playersRepaired += r.playersRepaired
    } catch (err) {
      out.errors.push({ leagueId, error: err instanceof Error ? err.message.slice(0, 160) : 'materialize failed' })
    }
  }
  return out
}
