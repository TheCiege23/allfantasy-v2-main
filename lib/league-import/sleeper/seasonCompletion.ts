import type { SleeperLeague } from '@/lib/sleeper-client'

/**
 * Is this season OVER — genuinely, not merely already imported?
 *
 * ── 🛑 THE GATE THIS EXISTS TO FIX FROZE THE SEASON PEOPLE ARE ACTUALLY PLAYING ─────────────
 *
 * `SleeperHistoricalDraftSyncService` and `SleeperHistoricalSeasonStateSyncService` both carried
 * a gate commented "a completed historical season's rows are stable". The comment describes a
 * season that has FINISHED. The code tested whether rows EXIST:
 *
 *     if (!args.force) {
 *       const existing = await prisma.X.findFirst({ where: { leagueId, season } })
 *       if (existing) { seasonsSkippedAlreadyComplete += 1; continue }
 *     }
 *
 * Three facts turn that gap into the bug:
 *
 *   1. `getSleeperHistoricalLeagueChain` starts at the CURRENT league and walks backwards via
 *      `previous_league_id`, so the chain's first element is the in-progress season.
 *   2. `SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0` is written with no completed-season guard.
 *   3. So importing a league mid-season writes a "season end" snapshot for a season that has not
 *      ended — and the gate then skips that season permanently, for every later run.
 *
 * The counter is literally named `seasonsSkippedAlreadyComplete` and increments for a season that
 * is not. A user's CURRENT roster, draft and standings froze at the moment they imported.
 *
 * ⚠ THIS IS A PRODUCT REQUIREMENT, NOT A CACHE TUNING KNOB. Past seasons are reference material —
 * they price trades, value players and feed storylines, and they must never be re-fetched because
 * they cannot change. The present season is what the user is living in and must never be stale.
 * A system that cannot tell the two apart shows someone last season's team and calls it today's.
 * The distinction has to be explicit, which is why this is a named predicate and not an inlined
 * `=== 'complete'` in three services that already disagree with each other.
 *
 * ── WHY `status` AND NOT A DATE ─────────────────────────────────────────────────────────────
 * Sleeper reports exactly four values — `pre_draft`, `drafting`, `in_season`, `complete` — and the
 * history chain already carries the whole `SleeperLeague` per season, so this costs no extra
 * request. A date heuristic ("is it past February?") would be a second implementation of a fact
 * the provider already states, and would be wrong for leagues that finish early, run long, or
 * never finish at all.
 *
 * ⚠ ABSENT OR UNRECOGNISED STATUS IS TREATED AS NOT COMPLETE, DELIBERATELY. The two failures are
 * not symmetric: refreshing a finished season costs one wasted provider call, while skipping a
 * live one shows a user stale data and is the failure this whole change exists to remove.
 */
export function isSleeperSeasonComplete(league: Pick<SleeperLeague, 'status'> | null | undefined): boolean {
  return league?.status === 'complete'
}

/**
 * Should a season's already-imported rows be left alone?
 *
 * Both conditions, in this order, because either alone is a bug that has already shipped:
 * `force` is the admin escape hatch, completion is the product rule, and row-existence is the
 * cheap check that was standing in for both.
 */
export function shouldSkipImportedSeason(args: {
  force: boolean | undefined
  league: Pick<SleeperLeague, 'status'> | null | undefined
}): boolean {
  if (args.force) return false
  return isSleeperSeasonComplete(args.league)
}
