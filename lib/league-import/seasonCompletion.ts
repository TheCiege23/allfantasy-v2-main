/** Anything carrying a provider's own league status — every adapter's normalized league does. */
export type SeasonStatusBearing = { status?: string | null } | null | undefined

/**
 * Is this season OVER — genuinely, not merely already imported?
 *
 * ⚠ PROVIDER-AGNOSTIC ON PURPOSE, AND IT DID NOT START THAT WAY. This was first written under
 * `sleeper/` and typed on `SleeperLeague`. Past-versus-present is a PRODUCT rule, not a Sleeper
 * one — every import has the same two kinds of season — so a per-provider copy would be the
 * "two implementations of one rule" bug CLAUDE.md already names.
 *
 * `'complete'` is already the shared vocabulary, which is why this works unchanged across all of
 * them. Four adapters normalise to it explicitly:
 *
 *     espn / fantrax / mfl / yahoo   status: raw.league.isFinished ? 'complete' : 'in_season'
 *     sleeper                        passes its own through: pre_draft|drafting|in_season|complete
 *     fleaflicker                    maps NO status — null, which is correctly not-complete
 *
 * `NormalizedLeague.status` is documented as the provider's own real status, `null` when the
 * provider genuinely doesn't report one and never a fabricated default. So the argument here is a
 * status-bearing shape, not any one provider's league type.
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
export function isSeasonComplete(league: SeasonStatusBearing): boolean {
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
  league: SeasonStatusBearing
}): boolean {
  if (args.force) return false
  return isSeasonComplete(args.league)
}
