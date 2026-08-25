/**
 * Where a team stands, and what that means for how it should be trading.
 *
 * ⚠ A TRADE IS NOT GOOD OR BAD IN THE ABSTRACT. A 3-7 team in week 10 sending
 * its quarterback out for two firsts and three young starters is doing the
 * correct thing. The 9-1 team on the other side is also doing the correct thing.
 * A grader that prices the assets and stops has graded half the question, and it
 * will tell the seller they lost a trade they were right to make.
 *
 * ⚠ AND THE BUBBLE IS THE HARD CASE, NOT THE EASY ONE. At 6-5 in week 12 either
 * decision can end a season: buy and miss the playoffs and you have spent next
 * year for nothing; sell and back into a run you could have won. That is a real
 * dilemma and it does not have a right answer. The honest thing is to name it,
 * not to resolve it — an engine that confidently tells a bubble team to sell is
 * inventing certainty nobody has.
 *
 * Pure arithmetic on standings. No projections, no simulation, no odds model.
 */

export type Posture = 'contending' | 'bubble' | 'selling' | 'unknown'

export type ContentionState = {
  rank: number | null
  teamCount: number
  playoffSpots: number | null
  wins: number
  losses: number
  ties: number
  /** Regular-season weeks still to play, when the season length is known. */
  weeksRemaining: number | null
  /**
   * Wins behind the last qualifying team. Negative means they are inside the
   * line. Null when we do not know how many teams qualify.
   */
  gamesBackOfLine: number | null
  posture: Posture
  /** One sentence, in a manager's language. Always present. */
  basis: string
}

/**
 * Inside this many wins of the cut line, with games still to play, is a bubble.
 *
 * ⚠ A PRESENTATION BAND, NOT A PROBABILITY. It decides which sentence a manager
 * reads; nothing multiplies by it. One win covers the common case where a single
 * head-to-head result flips the seeding.
 */
const BUBBLE_WINDOW = 1.5

export function assessContention(args: {
  /** Standings, best first. Rank is position in this array when not supplied. */
  standings: Array<{ teamId: string; wins: number; losses: number; ties: number; rank?: number | null }>
  teamId: string
  playoffSpots: number | null
  seasonWeeks: number | null
  /** The week about to be played. */
  currentWeek: number | null
}): ContentionState | null {
  const { standings, teamId, playoffSpots, seasonWeeks, currentWeek } = args
  if (standings.length === 0) return null

  const idx = standings.findIndex((t) => t.teamId === teamId)
  if (idx < 0) return null
  const me = standings[idx]!
  const rank = me.rank ?? idx + 1
  const teamCount = standings.length

  const weeksRemaining =
    seasonWeeks != null && currentWeek != null ? Math.max(0, seasonWeeks - currentWeek + 1) : null

  /*
   * The cut line is the LAST qualifying team's win total. Comparing against the
   * team immediately above you is the mistake — you do not need to pass them,
   * you need to pass whoever currently holds the final spot.
   */
  const winsOf = (t: { wins: number; ties: number }) => t.wins + t.ties * 0.5
  const lineTeam =
    playoffSpots != null && playoffSpots > 0 && playoffSpots <= teamCount
      ? standings[playoffSpots - 1]
      : null
  const gamesBackOfLine = lineTeam ? winsOf(lineTeam) - winsOf(me) : null

  let posture: Posture = 'unknown'
  let basis = 'we cannot tell where this team stands'

  if (playoffSpots == null) {
    basis = 'this league did not tell us how many teams make the playoffs, so nobody is on the bubble'
  } else if (gamesBackOfLine == null) {
    basis = 'the playoff cut line could not be located in these standings'
  } else if (weeksRemaining != null && weeksRemaining <= 0) {
    posture = rank <= playoffSpots ? 'contending' : 'selling'
    basis =
      rank <= playoffSpots
        ? `the regular season is over and they are in at ${rank} of ${teamCount}`
        : `the regular season is over and they missed at ${rank} of ${teamCount}`
  } else if (
    weeksRemaining != null &&
    gamesBackOfLine > weeksRemaining
  ) {
    /*
     * Mathematically out: they cannot reach the line even by winning out while
     * the team on it loses out. This is the one branch that is a fact rather
     * than a judgement, and it is the strongest sell signal there is.
     */
    posture = 'selling'
    basis = `they are ${gamesBackOfLine} back of the last playoff spot with ${weeksRemaining} to play — they cannot get there`
  } else if (gamesBackOfLine <= -BUBBLE_WINDOW) {
    posture = 'contending'
    basis = `${rank} of ${teamCount} and ${Math.abs(gamesBackOfLine)} clear of the cut line`
  } else if (Math.abs(gamesBackOfLine) <= BUBBLE_WINDOW) {
    posture = 'bubble'
    basis =
      weeksRemaining != null
        ? `${rank} of ${teamCount}, within a game of the cut line with ${weeksRemaining} to play — either direction is a real risk`
        : `${rank} of ${teamCount}, within a game of the cut line`
  } else {
    posture = 'selling'
    basis = `${rank} of ${teamCount}, ${gamesBackOfLine} back of the last playoff spot`
  }

  return {
    rank,
    teamCount,
    playoffSpots,
    wins: me.wins,
    losses: me.losses,
    ties: me.ties,
    weeksRemaining,
    gamesBackOfLine,
    posture,
    basis,
  }
}

/**
 * What this posture says about a deal that sends present value out for future
 * value, or the reverse.
 *
 * ⚠ RETURNS A SENTENCE, NOT A MULTIPLIER, AND THAT IS DELIBERATE. Nobody can put
 * a number on "you are 3-7, the future is worth more to you" without inventing
 * a discount rate — and the right rate differs per manager, per league, per how
 * much they care about this season. What an engine CAN do is refuse to grade a
 * correct rebuild as a loss, and say why.
 *
 * `futureLean` is positive when the deal moves value toward the future.
 */
export function postureNote(args: {
  state: ContentionState
  /** Positive when the side is acquiring picks and youth; negative for win-now. */
  futureLean: number
}): string | null {
  const { state, futureLean } = args
  if (state.posture === 'unknown' || futureLean === 0) return null

  const buying = futureLean < 0

  if (state.posture === 'selling') {
    return buying
      ? `They are ${state.basis}. Buying present help here spends next year on a season that is already gone.`
      : `They are ${state.basis}. Trading this season for future assets is the right shape of deal for them, whatever the raw values say.`
  }

  if (state.posture === 'contending') {
    return buying
      ? `They are ${state.basis}. Paying future value for present help is what a contending window is for.`
      : `They are ${state.basis}. Selling present value out of a contending season is a real cost, not a free upgrade.`
  }

  /*
   * The bubble. Named, not resolved — see the note at the top of this file.
   * Telling a 6-5 team what to do is inventing certainty nobody has.
   */
  return `They are ${state.basis}. ${
    buying
      ? 'Buying now bets the next two years on making a run they are not yet in.'
      : 'Selling now writes off a season they are still alive in.'
  } There is no right answer here — it is a judgement about how much this year is worth to them.`
}
