/**
 * AF Projections — per-game → rest-of-season conversion. PURE.
 *
 * ── 🛑 THE ONE PLACE THIS MULTIPLICATION MAY HAPPEN ─────────────────────────────────────────
 * `AFProjectionSnapshot.afProjection` is PER GAME. `normalizedPlayerValue` expects a REST-OF-SEASON
 * total. Getting that wrong understates every player by ~17×, and does it silently — measured:
 *
 *     elite WR, 19.5/game     per-game fed in →  532      correctly converted →  9050
 *     RB1,      18.0/game     per-game fed in →  538      correctly converted →  9149
 *     mid TE,    9.2/game     per-game fed in →  239      correctly converted →  4066
 *
 * No zero, no NaN, no thrown error. Every wrong value is a plausible mid-tier price, which is why
 * this cannot be an inline `* 17` at a read site. One named, tested function, or the first caller
 * to forget produces a number nobody can distinguish from a right one.
 *
 * ── WHY THE SNAPSHOT STORES BOTH UNITS ──────────────────────────────────────────────────────
 * The per-game figure is the league-agnostic truth; the rest-of-season total depends on WHEN you
 * ask and on where the league's season ends. Storing only ROS would bake one league's playoff
 * structure into a row every league reads — the same mistake `rescoreForLeague` exists to undo for
 * IDP. Storing only per-game would push the multiplication out to every consumer, which is the
 * 17× trap above.
 *
 * So: store per-game as canonical, store ROS at a stated horizon for consumers that do not know
 * the league, and carry `rosWeeksRemaining` so a league-aware consumer can recover the per-game
 * rate and re-project onto its own horizon. Same shape as the IDP `componentAmounts` pattern.
 */

/**
 * Last week a fantasy season typically pays out — championship week in the common Sleeper/ESPN
 * default (playoffs weeks 15–17).
 *
 * ⚠ A DEFAULT, NOT A LAW, AND THE REASON `rosWeeksRemaining` IS PERSISTED. Leagues really do end
 * in week 16, and Four Horsemen runs its championship across weeks 16–17. A consumer that knows
 * its league's final week should call {@link weeksRemaining} with it rather than trusting this.
 */
export const DEFAULT_FANTASY_FINAL_WEEK = 17

/** First week of an NFL regular season. Used only to reject nonsense week numbers. */
const FIRST_WEEK = 1
/** Nothing sane asks about a week beyond this; guards against a bad upstream value. */
const MAX_WEEK = 25

export interface WeeksRemainingInput {
  /** The week about to be played. A projection FOR week 5 means weeks 5..final remain. */
  currentWeek: number | null | undefined
  /** Last week this league scores. Defaults to {@link DEFAULT_FANTASY_FINAL_WEEK}. */
  finalWeek?: number | null
  /**
   * The player's bye week, when known.
   *
   * ⚠ NOT COSMETIC. A player with a bye still ahead of him plays one FEWER game than the calendar
   * suggests. Across a 13-week remaining window that is a ~7.7% overstatement of his rest-of-season
   * total, applied to every player whose bye has not yet passed and to none whose has — so it does
   * not cancel out, it systematically over-values exactly half the league at any moment mid-season.
   */
  byeWeek?: number | null
}

/**
 * How many games remain, counting `currentWeek` itself and excluding a bye still ahead.
 *
 * Returns null rather than a number when the week is unusable — a caller that cannot say what week
 * it is has no business projecting a rest-of-season total, and 0 would read as "the season is over".
 */
export function weeksRemaining(input: WeeksRemainingInput): number | null {
  const current = input.currentWeek
  if (current == null || !Number.isFinite(current)) return null
  if (current < FIRST_WEEK || current > MAX_WEEK) return null

  const final = Number.isFinite(input.finalWeek as number)
    ? (input.finalWeek as number)
    : DEFAULT_FANTASY_FINAL_WEEK
  if (final < FIRST_WEEK || final > MAX_WEEK) return null

  // Inclusive of the current week: projecting FOR week 5 with a final week of 17 is 13 games.
  let weeks = final - Math.floor(current) + 1
  if (weeks <= 0) return 0

  const bye = input.byeWeek
  if (bye != null && Number.isFinite(bye) && bye >= Math.floor(current) && bye <= final) {
    weeks -= 1
  }
  return Math.max(0, weeks)
}

/**
 * Rest-of-season points from a per-game rate.
 *
 * Returns null — never 0 — when either input is unusable. A 0 here would enter the value engine as
 * a real projection meaning "worthless", and `normalizedPlayerValue` would then fall through to its
 * market-value branch or price the player at nothing. "We could not compute this" and "this player
 * will score nothing" must not share a representation.
 */
export function rosFromPerGame(
  perGame: number | null | undefined,
  weeks: number | null | undefined,
): number | null {
  /*
   * ⚠ A NEGATIVE RATE IS A REAL PROJECTION, NOT A MISSING ONE, AND THIS ONCE REFUSED THEM.
   *
   * The first version guarded `perGame < 0` alongside the null and non-finite checks, conflating
   * "negative" with "invalid". Measured on production after the fix shipped: 28 NFL rows carried a
   * `rosWeeksRemaining` but no `rosProjection`, and ALL 28 had a negative `afProjection` — min
   * -3.40, max -0.03, zero positives. Same perfect correlation in every other sport (MLB 54/54,
   * NCAAB 7/7, NHL 1/1).
   *
   * They are genuine: Braden Mann (P, -3.40), Mecole Hardman (WR, -2.00), Jamie Gillan (P, -1.25)
   * — punters and return men who lose more points than they gain under the scoring in use. "This
   * player will cost you ~58 points over the rest of the season" is information, and discarding it
   * at the storage layer threw it away.
   *
   * 🛑 AND THE REFUSAL MADE A DIAGNOSTIC LIE. `af_projection_rows_without_ros` means "rows exist
   * but predate the ROS columns". These rows are current and perfectly ROS-able; firing that
   * warning for them points the next reader at a migration problem that does not exist.
   *
   * Safe downstream, checked rather than assumed: `normalizedPlayerValue` gates on
   * `projection > 0` for `hasProjection`, so a negative falls through to the market-value branch,
   * and `base` is `Math.max(0, projection)`, so it can never produce a negative price.
   *
   * NEGATIVE WEEKS ARE STILL REFUSED — a negative horizon is nonsense rather than information.
   */
  if (perGame == null || !Number.isFinite(perGame)) return null
  if (weeks == null || !Number.isFinite(weeks) || weeks < 0) return null
  return Math.round(perGame * weeks * 100) / 100
}

/**
 * The inverse, for a consumer that holds a stored ROS total and wants to re-project it onto its
 * own league's horizon.
 *
 * ⚠ THIS IS THE WHOLE REASON `rosWeeksRemaining` IS A COLUMN. Without the divisor a stored total
 * cannot be reinterpreted, and a LOW total is indistinguishable from a LATE-SEASON one — a
 * snapshot written in week 3 covers 15 games and one written in week 14 covers 4, and both are
 * correct. Dividing by a remembered constant instead of the stored one is the 17× bug wearing a
 * different hat.
 */
export function perGameFromRos(
  ros: number | null | undefined,
  storedWeeks: number | null | undefined,
): number | null {
  if (ros == null || !Number.isFinite(ros)) return null
  if (storedWeeks == null || !Number.isFinite(storedWeeks) || storedWeeks <= 0) return null
  return Math.round((ros / storedWeeks) * 1000) / 1000
}

/**
 * Re-project a stored rest-of-season total onto a different horizon, in one step.
 *
 * Convenience over `perGameFromRos` + `rosFromPerGame`, so a caller cannot do half of it.
 */
export function reprojectRos(input: {
  storedRos: number | null | undefined
  storedWeeks: number | null | undefined
  targetWeeks: number | null | undefined
}): number | null {
  const perGame = perGameFromRos(input.storedRos, input.storedWeeks)
  if (perGame == null) return null
  return rosFromPerGame(perGame, input.targetWeeks)
}
