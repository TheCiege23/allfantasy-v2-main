/**
 * The week ESPN knocked a team out of an elimination league, from the records ESPN already gave us.
 *
 * 🛑 WHY (user request, 2026-11-18). ESPN "Washington Pro Knockout" knocked its owner out in week 8,
 * and the league list still read "52-56 · 11th · Matchup unavailable from ESPN". The 11th is ESPN's
 * order of the knocked-out (most recent first), not a standing, and nothing on file names the week:
 * no `WeeklyMatchup` rows exist for the league, so the score-based chop rule (`importedChopInference`)
 * has nothing to read.
 *
 * ⚠ THE RECORD IS THE CLOCK, AND ONLY UNDER ESPN'S OWN STATED RULES. With `scoringType:
 * WEEKLY_ALL_PLAY_POINTS` and `scoringEnhancementType: WEEKLY_ELIMINATION` (both in the league's stored
 * `espn_settings.scoringSettings`), each week every surviving team plays every other surviving team
 * once and one team goes. So in an N-team league week w adds N − w games, and a team that played k
 * weeks has exactly (N−1) + (N−2) + … + (N−k) games. Measured on that league (N = 18): 52-56 = 108
 * = 17 + … + 10, so 8 weeks; 0-17 is 1 week; 23-25 is 3; the survivors' 85-40 is 10. ESPN's own
 * KO'd table says weeks 8, 1, 3, and the survivors are on week 11.
 *
 * Refuses rather than guesses: any other scoring type, or a game count that is not exactly such a sum
 * (two chops in a week, a tie the rule did not expect), returns null and the row keeps its plain
 * record. So does a team level with the most-played teams, unless ESPN's rank places it below the
 * survivors (see `espnKnockoutWeek`).
 *
 * Pure.
 */

type Record3 = { wins: number; losses: number; ties: number }

const games = (r: Record3) => r.wins + r.losses + r.ties

/** Weeks k with (N−1) + (N−2) + … + (N−k) === `played`, or null when no k fits exactly. */
export function allPlayWeeks(played: number, size: number): number | null {
  if (!Number.isInteger(played) || !Number.isInteger(size) || size < 2 || played <= 0) return null
  let total = 0
  for (let k = 1; k < size; k++) {
    total += size - k
    if (total === played) return k
    if (total > played) return null
  }
  return null
}

/** ESPN's elimination-league rules as the league's stored settings state them, else null. */
export function espnAllPlayEliminationSize(settings: { scoringType?: unknown; enhancement?: unknown; size?: unknown }): number | null {
  if (settings.scoringType !== 'WEEKLY_ALL_PLAY_POINTS' || settings.enhancement !== 'WEEKLY_ELIMINATION') return null
  const size = Number(settings.size)
  return Number.isInteger(size) && size >= 2 ? size : null
}

/**
 * The week `me` was knocked out, or null when it is alive or the records cannot say. `league` is
 * every team's record in the league, `me` included.
 *
 * ⚠ THE LATEST WEEK'S KNOCKOUT HAS THE SURVIVORS' RECORD LENGTH. The team ESPN dropped after the last
 * completed week played that week too, so its games equal theirs (measured: "I Need FAAB $$, TRADES",
 * out in week 10, 59-66 = 125 games, the same as every survivor). The record alone cannot separate it,
 * so ESPN's rank does — it lists the survivors first (1–8 there) and the knocked-out after, most
 * recent first. Used only when exactly one team more than the survivor count reached the top week,
 * i.e. exactly one chop that week; anything else returns null.
 */
export function espnKnockoutWeek(args: {
  size: number
  me: Record3 & { currentRank?: number | null }
  league: ReadonlyArray<Record3>
}): number | null {
  const mine = allPlayWeeks(games(args.me), args.size)
  if (mine == null) return null
  const weeks = args.league.map((t) => allPlayWeeks(games(t), args.size))
  const most = Math.max(...weeks.map((w) => w ?? 0))
  if (mine < most) return mine
  const survivors = args.size - most
  const atTop = weeks.filter((w) => w === most).length
  const rank = args.me.currentRank
  if (atTop === survivors + 1 && rank != null && rank > survivors && rank <= atTop) return most
  return null
}
