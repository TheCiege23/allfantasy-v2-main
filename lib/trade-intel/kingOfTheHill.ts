/**
 * King of the Hill: a crown worth +10 a week, and the most violent single-week
 * downside in any format here.
 *
 * Week 1's top scorer takes the crown. The King scores +10 every week until he
 * LOSES — and when he does, he forfeits his top THREE scorers from that week to
 * waivers, where he has to bid against the league to get any of them back. That
 * week's top scorer takes the crown. It all stops when the playoffs start.
 *
 * ⚠ THE PENALTY IS THAT WEEK'S BOX SCORE, NOT YOUR THREE BEST PLAYERS, and the
 * difference matters. Lose in a week your studs busted and you shed the bench
 * pieces that happened to go off; lose in a week everything fired and you shed
 * your actual roster. So the King's worst outcome is scoring a lot and losing
 * anyway, which is the one result nobody plans for.
 *
 * ⚠ AND THE CROWN INVERTS THE USUAL CONCENTRATION ADVICE ONE MORE TIME. Across
 * this repo, concentration is priced as fragility. For the King it is worse than
 * that: three players is exactly what the penalty takes, so a roster whose value
 * sits in three men can be gutted in a single afternoon. Spreading value is
 * genuinely correct here — the opposite of Pirate, where the protection cap
 * rewards concentrating.
 */

/** Points the King adds to his total every week he holds the crown. */
export const CROWN_BONUS = 10

/** Players forfeited to waivers when the King loses. */
export const CROWN_PENALTY_PLAYERS = 3

export type CrownValue = {
  weeksRemaining: number
  /** Points the crown is worth if held to the playoffs. */
  maxPoints: number
  /** Points expected, given you keep it only until you lose. */
  expectedPoints: number
  basis: string
}

/**
 * What the crown is worth for the rest of the run.
 *
 * ⚠ EXPECTED, NOT MAXIMUM. Holding it to the playoffs is the ceiling and almost
 * nobody does — you keep it until you lose a matchup, so the honest figure is
 * the bonus times the weeks you expect to survive. At even odds that is two
 * weeks regardless of how many remain, the same geometric result as a single
 * elimination bracket. Quoting the maximum would overstate the crown by a factor
 * of four in mid-season.
 */
export function crownValue(args: {
  currentWeek: number
  /** First playoff week — the crown stops before it. */
  playoffStartWeek: number | null
  /** Odds the King keeps the crown in a given week. Defaults to even. */
  holdRate?: number
}): CrownValue | null {
  const { currentWeek, playoffStartWeek } = args
  if (playoffStartWeek == null || currentWeek < 1 || currentWeek >= playoffStartWeek) return null

  const weeksRemaining = playoffStartWeek - currentWeek
  const hold = Math.min(0.95, Math.max(0.05, args.holdRate ?? 0.5))

  /*
   * You bank this week for certain, then each further week only if you keep
   * winning: a geometric series in the hold rate, truncated at the playoffs.
   */
  let expectedWeeks = 0
  for (let k = 0; k < weeksRemaining; k += 1) expectedWeeks += Math.pow(hold, k)

  const maxPoints = CROWN_BONUS * weeksRemaining
  const expectedPoints = Math.round(CROWN_BONUS * expectedWeeks * 10) / 10

  return {
    weeksRemaining,
    maxPoints,
    expectedPoints,
    basis: `The crown is +${CROWN_BONUS} a week and there are ${weeksRemaining} weeks before the playoffs stop it — ${maxPoints} points if you never lose. You will lose, so the honest figure is about ${expectedPoints}: you bank this week and each one after only if you keep winning.`,
  }
}

export type CrownRisk = {
  /** What the three forfeited players are worth, in expectation. */
  exposedValue: number | null
  basis: string
}

/**
 * What losing the crown costs.
 *
 * ⚠ THE LARGEST SINGLE-EVENT ROSTER LOSS IN ANY FORMAT MODELLED HERE. Guillotine
 * ends your season; Pirate takes one player; this takes three at once and puts
 * them where the whole league can bid. The King is not risking a bad week, he is
 * risking his roster.
 *
 * Priced off the best three by VALUE as the expectation, because that is what
 * usually correlates with topping a box score — but the note says plainly that
 * the real rule is that week's scorers, since the two come apart exactly when a
 * manager most wants to know.
 */
export function crownRisk(args: { rosterValues: Array<number | null> }): CrownRisk | null {
  const priced = args.rosterValues.filter((v): v is number => typeof v === 'number' && v > 0)
  if (priced.length === 0) return null

  const top = [...priced].sort((a, b) => b - a).slice(0, CROWN_PENALTY_PLAYERS)
  const exposedValue = top.reduce((a, b) => a + b, 0)

  return {
    exposedValue,
    basis: `Lose while wearing the crown and you forfeit ${CROWN_PENALTY_PLAYERS} players to waivers — around ${exposedValue.toLocaleString()} of value if your best three are the ones who score, and you bid against the whole league to get any of them back. ⚠ The rule takes that WEEK'S top three scorers, not your three best players, so a big week that still ends in a loss is the worst possible outcome.`,
  }
}

/**
 * What beating the King is worth to everyone who is not the King.
 *
 * ⚠ THE CROWN IS ONLY HALF OF IT. Dethroning also dumps three of his players
 * onto waivers, and every manager in the league can bid. So a week where the
 * King looks beatable is a week to hold FAAB rather than spend it — the best
 * players of the season hit the wire in bursts, not steadily, and they only do
 * it when somebody topples him.
 */
export function dethroneNote(args: {
  /** True when the viewer is the current King. */
  viewerIsKing: boolean
  kingName?: string | null
}): string {
  const who = args.kingName ? args.kingName : 'the King'

  if (args.viewerIsKing) {
    return `You are wearing the crown. Every manager in this league is measuring their week against yours, and the week you slip they take ${CROWN_PENALTY_PLAYERS} of your players to the wire and bid on them. Trade for consistency over upside while you hold it.`
  }
  return `${who} holds the crown and the +${CROWN_BONUS}. Beating them is worth the crown AND puts ${CROWN_PENALTY_PLAYERS} of their players on waivers for the whole league to bid on — so hold FAAB for the week the King looks beatable. In this format the best players hit the wire in bursts, and only when somebody topples him.`
}

/**
 * The concentration correction, which runs opposite to Pirate.
 *
 * Stated explicitly because this repo now contains both rules, and applying the
 * wrong one is worse than applying neither: Pirate's protection cap rewards
 * stacking value into three men, and this format's penalty takes exactly three.
 */
export function crownConcentrationNote(args: { viewerIsKing: boolean }): string | null {
  if (!args.viewerIsKing) return null
  return `Spread value while you hold the crown. The penalty takes ${CROWN_PENALTY_PLAYERS} players, so a roster whose worth sits in three men can be gutted in one afternoon — this is the reverse of a Pirate league, where a protection cap makes concentrating into three the safe play.`
}
