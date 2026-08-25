/**
 * Tournament: where the roster has an expiry date and a player is worth about
 * two more games no matter how much bracket is left.
 *
 * The King Buffalo Invitational shape. Ten 12-team leagues per bracket compete
 * weeks 1–9 for 64 spots; the survivors REDRAFT into 16-team leagues for a
 * single-elimination run over weeks 11–17, with a second redraft before the
 * Elite Eight. Three drafts, no pick trading, and — in this tournament — no
 * trades at all.
 *
 * ⚠ IT IS BUILT ANYWAY, AND CAREFULLY, BECAUSE THE PLATFORM SPEC MAKES TRADING A
 * SETTING ("Trades: Disabled", waivers "configurable"). The moment a variant
 * turns it on, every intuition a manager carries in from a season league is
 * wrong here, and it is wrong in the same two directions every time.
 *
 * ⚠ THE ROSTER EXPIRES. "This roster only lasts to WEEK 9." After that everybody
 * redrafts and nothing you built carries forward. There is no future value in
 * this format at any point — not next season, not next month, not next round.
 * A player acquired in week 8 is worth one game and then he is somebody else's.
 *
 * ⚠ AND SINGLE ELIMINATION COMPRESSES EVERYTHING TO ABOUT TWO GAMES. With even
 * odds your expected number of remaining games is 2 − 2^−(R−1), which is 1.75
 * with three rounds left and 1.98 with seven. It never reaches 2. Seven weeks of
 * bracket does NOT mean seven weeks of value, and that is the single most
 * expensive misreading available in this format.
 */

export type TradingPolicy = {
  permitted: boolean
  basis: string
}

/**
 * Whether this tournament allows trades at all.
 *
 * ⚠ THE FIRST AND SOMETIMES ONLY ANSWER. Grading a trade in a tournament that
 * forbids them produces a confident verdict about a transaction that cannot
 * happen — worse than useless, because it implies the deal is available.
 */
export function tradingPolicy(args: { tradesEnabled: boolean | null }): TradingPolicy {
  if (args.tradesEnabled === false) {
    return {
      permitted: false,
      basis:
        'This tournament does not allow trades — rule 3, and draft pick trading is barred separately under rule 1. Nothing below is a deal you can actually make.',
    }
  }
  if (args.tradesEnabled === null) {
    return {
      permitted: false,
      basis:
        'We do not know whether this tournament allows trades. Most do not — confirm with the commissioner before building anything around a deal.',
    }
  }
  return {
    permitted: true,
    basis:
      'Trades are enabled in this tournament, which is unusual. Everything you are used to from a season league is priced differently here — see below.',
  }
}

export type RosterHorizon = {
  weeksOfUse: number
  basis: string
}

/**
 * How long you actually keep what you acquire.
 *
 * ⚠ THE REDRAFT IS THE EXPIRY, NOT THE END OF THE SEASON. Every stage of this
 * tournament ends in a redraft that returns everyone to zero, so a player's
 * whole value is the weeks between now and the next one. A manager pricing a
 * week-8 acquisition against the rest of the season is out by a factor of ten.
 */
export function rosterHorizon(args: {
  currentWeek: number
  /** The next week that dissolves rosters and redrafts. */
  nextRedraftWeek: number | null
}): RosterHorizon | null {
  const { currentWeek, nextRedraftWeek } = args
  if (nextRedraftWeek == null || currentWeek < 1) return null

  const weeksOfUse = Math.max(0, nextRedraftWeek - currentWeek)
  return {
    weeksOfUse,
    basis:
      weeksOfUse <= 0
        ? 'The redraft is this week. Anything you acquire now you keep for zero games — the roster dissolves before it plays.'
        : weeksOfUse === 1
          ? 'The redraft is next week, so anything you acquire is worth exactly ONE game. Not one week of a season — one game, and then everybody starts over.'
          : `You keep what you acquire for ${weeksOfUse} weeks, then everyone redrafts and it is gone. There is no carry-forward value in this format at all.`,
  }
}

export type BracketHorizon = {
  roundsRemaining: number
  /** Expected games you still play, under even odds. */
  expectedGames: number
  basis: string
}

/**
 * Expected games left in a single-elimination bracket.
 *
 * ⚠ 2 − 2^−(R−1), AND IT NEVER REACHES TWO. You are guaranteed this round, then
 * each further one at half the previous chance. Three rounds left is 1.75
 * expected games; seven is 1.98. The derivation is a geometric series, not a
 * tuned constant, and the conclusion is worth stating plainly because it is so
 * unintuitive: how deep the bracket runs barely changes what a player is worth
 * to you.
 */
export function bracketHorizon(args: { roundsRemaining: number }): BracketHorizon | null {
  const R = args.roundsRemaining
  if (!Number.isFinite(R) || R < 1) return null

  const expectedGames = 2 - Math.pow(2, -(R - 1))
  /*
   * ⚠ ROUNDED DOWN, NOT TO NEAREST. At twenty rounds the true expectation is
   * 1.999998 and rounding to nearest would report it as 2.00 — contradicting
   * the one claim this function exists to make. A reported number must not
   * overstate the games you expect to play.
   */
  const rounded = Math.floor(expectedGames * 100) / 100

  return {
    roundsRemaining: R,
    expectedGames: rounded,
    basis:
      R === 1
        ? 'One round left: win or the season ends. Anything you acquire plays exactly once.'
        : `${R} rounds remain, but single elimination means you expect about ${rounded} more games — you are guaranteed this one and each further round only at half the chance of the last. Seven weeks of bracket is not seven weeks of value.`,
  }
}

/**
 * FAAB that is about to be taken away from you.
 *
 * ⚠ A RESET MAKES UNSPENT BUDGET WORTHLESS ON A DEADLINE. The rules issue "New
 * FAAB for Tournament Weeks 12–17", so whatever is left of the old budget dies
 * at the boundary. Holding it back for a rainy day is a strategy that ends with
 * the money evaporating — and it is the same instinct that makes managers save
 * idols past the merge in Survivor.
 */
export function faabResetNote(args: {
  currentWeek: number
  /** The week a fresh budget is issued and the old one dies. */
  resetWeek: number | null
  /** Unspent budget, when we know it. */
  remaining?: number | null
}): string | null {
  const { currentWeek, resetWeek } = args
  if (resetWeek == null || currentWeek >= resetWeek) return null

  const weeksLeft = resetWeek - currentWeek
  const amount = args.remaining != null ? `Your $${args.remaining} ` : 'Any unspent FAAB '
  return `${amount}expires at the week ${resetWeek} reset, ${weeksLeft} week${
    weeksLeft === 1 ? '' : 's'
  } away — a fresh budget is issued for the tournament rounds. Budget you do not spend before then is simply lost, so it costs nothing to use it now.`
}

/**
 * What a bye costs inside a short window.
 *
 * ⚠ A BYE IS A ROUNDING ERROR OVER A SEASON AND A DISASTER OVER NINE WEEKS. The
 * rules say it outright — "Pay attention to BYE WEEKS. This roster only lasts to
 * WEEK 9." A player with a week 7 bye in a window ending at week 9 gives you two
 * games out of three, and in the bracket a bye is not a cost at all: it is
 * elimination, because you cannot field him and you do not get a next week.
 */
export function byeCostInWindow(args: {
  byeWeek: number | null
  currentWeek: number
  /** Last week this roster survives. */
  windowEndWeek: number
  /** True once a lost game ends the run. */
  singleElimination: boolean
}): string | null {
  const { byeWeek, currentWeek, windowEndWeek } = args
  if (byeWeek == null || byeWeek < currentWeek || byeWeek > windowEndWeek) return null

  const games = Math.max(0, windowEndWeek - currentWeek + 1)
  if (games <= 0) return null

  if (args.singleElimination) {
    return `He is off in week ${byeWeek}, which falls inside the bracket. In single elimination a bye is not a cost you absorb — it is a week you field a hole and go home, so plan the round around it or do not acquire him.`
  }

  const lost = 1
  return `He is off in week ${byeWeek} and this roster only lasts to week ${windowEndWeek}. That is ${lost} of your ${games} remaining game${
    games === 1 ? '' : 's'
  } — a bye is a rounding error over a full season and a real cost over a window this short.`
}
