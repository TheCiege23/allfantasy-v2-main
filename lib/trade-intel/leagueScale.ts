/**
 * What changes when a league is not twelve teams.
 *
 * Every price in this product is a TWELVE-TEAM price. `ingestPlayerValues`
 * fetches four FantasyCalc combinations and all four are `numTeams=12`; only
 * `numQbs` varies. That is defensible for a 10- or 14-team league and it falls
 * apart in a 32-team one, in two directions at once:
 *
 * ⚠ PICKS ARE MASSIVELY OVERVALUED. A "1st-round pick" is not a quantity of
 * talent, it is a position in a queue. The 28th pick of a 32-team rookie draft
 * is the 28th player off the board — which in twelve-team terms is a THIRD
 * rounder. Priced off a 12-team chart as "a 1st", it is worth several times what
 * it should be, and every deal that ships picks into a deep league is quietly
 * lopsided. This is the single largest pricing error in a big league and nothing
 * in the product accounted for it.
 *
 * ⚠ STARTERS ARE UNDERVALUED, for the mirror reason. With 32 teams the waiver
 * wire is empty by construction: there are roughly as many startable NFL
 * players at most positions as there are starting slots. Losing a starter is not
 * a downgrade to the next man, it is a downgrade to nothing. `positionScarcity`
 * measures that empirically, which is why it needs no separate model here — but
 * its "replaceable" threshold has to scale, and it now does.
 *
 * ⚠ AND A WHOLE MARKET IS MISSING. FantasyCalc prices offence and picks. It does
 * not price defenders. In a league that starts IDP — which describes most deep
 * leagues, because that is how they find enough startable players — a large
 * share of every roster and many trades are being valued at null. That is not a
 * modelling choice we made; it is a hole in the only market feed we have, and a
 * trade screen has to say so rather than grade half a deal and call it fair.
 */

/** Positions the market feed can actually price. Everything else is unpriced. */
const PRICED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

/** Slot names that are not a playing position. */
const NON_PLAYING = new Set(['BN', 'IR', 'TAXI', 'RES', 'BENCH'])

/** The league size every stored price and pick chart is denominated in. */
export const BASELINE_TEAM_COUNT = 12

export type Scrutiny = 'shallow' | 'standard' | 'deep' | 'very-deep'

/**
 * At or below this many teams, the league is shallow enough that replacement
 * stops being a constraint at all.
 *
 * ⚠ THE ERRORS INVERT AT THIS END, THEY DO NOT DISAPPEAR. Deep leagues
 * overvalue picks and undervalue starters. Shallow leagues do the exact
 * opposite: late-round picks are far better than their round name suggests
 * (a 4-team 5th is the 17th player off the board, a 12-team 2.05), and depth
 * players are worth close to nothing in trade because the other manager can
 * replace them from a waiver wire holding most of the NFL.
 *
 * ⚠ MEASURED IN ROSTERED PLAYERS, NOT TEAMS. Twenty teams on eight-man rosters
 * is shallower than twelve teams on twenty-five.
 */

export type LeagueScale = {
  teamCount: number
  startingSlots: number
  /** Startable slots across the whole league, so demand is visible. */
  leagueWideSlots: number
  scrutiny: Scrutiny
  /**
   * Starting slots whose positions the market feed cannot price at all.
   * In an IDP league this is most of the defensive lineup.
   */
  unpricedSlots: number
  unpricedPositions: string[]
  notes: string[]
}

export function assessLeagueScale(args: {
  teamCount: number
  /** The league's `roster_positions`. */
  starters: unknown
}): LeagueScale | null {
  const { teamCount } = args
  if (!Array.isArray(args.starters) || args.starters.length === 0 || teamCount < 2) return null

  const slots = args.starters
    .map((x) => String(x).toUpperCase().trim())
    .filter((x) => x && !NON_PLAYING.has(x))

  const unpriced = slots.filter((s) => {
    /* A flex slot is priced if anything eligible for it is priced. */
    if (s.includes('FLEX') || s === 'SF') return s.startsWith('IDP') || s.startsWith('DEF_')
    return !PRICED_POSITIONS.has(s)
  })

  /*
   * ⚠ DEPTH IS ROSTER SPOTS, NOT TEAMS. This branched on team count and was
   * WRONG, and a real league proved it: a Zombie Universe league has TWENTY
   * teams and an eight-man roster — 1 superflex, 4 flex, 3 bench. That is 160
   * players rostered league-wide, FEWER than a normal 12-team league with 25
   * spots, so the waiver pool is enormous and replacement is trivial. Calling it
   * "very deep" on team count alone would have inverted every conclusion:
   * telling a manager that starters are irreplaceable in the one format where
   * you can add a free agent mid-game.
   *
   * Team count still drives the PICK conversion, because a round really is
   * teamCount picks. The two questions want different numbers.
   */
  const leagueWideRosterSpots = teamCount * args.starters.length

  /*
   * Calibrated against real leagues rather than round numbers:
   *   12 x 25 = 300   a normal league          -> standard
   *   32 x 21 = 672   deep IDP                 -> very-deep
   *   20 x  8 = 160   Zombie Universe          -> shallow
   *    4 x 13 =  52   four-manager league      -> shallow
   */
  const scrutiny: Scrutiny =
    leagueWideRosterSpots >= 600
      ? 'very-deep'
      : leagueWideRosterSpots >= 400
        ? 'deep'
        : leagueWideRosterSpots <= 250
          ? 'shallow'
          : 'standard'

  const notes: string[] = []
  if (teamCount !== BASELINE_TEAM_COUNT) {
    notes.push(
      `Every stored price is a ${BASELINE_TEAM_COUNT}-team price. This is a ${teamCount}-team league, so picks are converted to their ${BASELINE_TEAM_COUNT}-team equivalent before they are valued.`,
    )
  }
  if (scrutiny === 'deep' || scrutiny === 'very-deep') {
    notes.push(
      `${teamCount} teams hold ${args.starters.length} players each — ${leagueWideRosterSpots} rostered league-wide. Replacement is far worse here than the market assumes, so a starter is harder to replace and a pick is worth less than its round suggests.`,
    )
  }

  if (scrutiny === 'shallow') {
    /*
     * ⚠ THE SAME ERROR, RUNNING THE OTHER WAY. With this few teams the waiver
     * wire holds most of the league, so depth is close to free and the round
     * number on a pick understates it badly — a round here is only a handful of
     * players, so picks stay valuable far deeper into the draft than the label
     * suggests.
     */
    const perRound = teamCount
    const fifthOverall = 4 * perRound + 1
    notes.push(
      `Only ${teamCount} teams, so a round is ${perRound} picks. A ${teamCount}-team 5th is the ${ordinal(
        fifthOverall,
      )} player off the board — still an early-second in the 12-team terms our prices use. Late-round picks are worth far more here than their round name suggests.`,
    )
    notes.push(
      `Only ${leagueWideRosterSpots} players are rostered across the whole league (${teamCount} teams × ${args.starters.length} spots), so most of the NFL is unrostered. Depth players cost their market price on paper and close to nothing in practice, because the other side can replace them from free agency.`,
    )
  }
  if (unpriced.length > 0) {
    notes.push(
      `${unpriced.length} of ${slots.length} starting slots are positions our market feed does not price (${[
        ...new Set(unpriced),
      ].join(', ')}). Any deal involving them is graded on the half we can see.`,
    )
  }

  return {
    teamCount,
    startingSlots: slots.length,
    leagueWideSlots: teamCount * slots.length,
    scrutiny,
    unpricedSlots: unpriced.length,
    unpricedPositions: [...new Set(unpriced)],
    notes,
  }
}

export type PickEquivalent = {
  /** Absolute selection number in this league's draft. */
  overall: number
  /** The round it would fall in a 12-team draft. */
  baselineRound: number
  /** The slot within that round. */
  baselineSlot: number
  /** True when the league is already the baseline size and nothing moved. */
  unchanged: boolean
  basis: string | null
}

/**
 * Convert a pick in THIS league to the pick it is equivalent to in a 12-team
 * league, so a 12-team-priced chart can value it honestly.
 *
 * ⚠ THE CONVERSION IS ON OVERALL SELECTION, WHICH IS THE ONLY THING THAT
 * TRANSFERS. "Round 1" means twelve players are gone in one league and
 * thirty-two in another; the number of players taken before you is the same
 * quantity in both. A 32-team 1.28 is overall 28, which is a 12-team 3.04.
 *
 * This cuts both ways and is not a way of talking picks down: an 8-team league's
 * 2.02 is overall 10, a 12-team 1.10, and worth MORE than its round implies.
 */
export function toBaselinePick(args: {
  round: number
  /** Slot within the round. */
  slot: number
  teamCount: number
}): PickEquivalent {
  const { round, slot, teamCount } = args
  const overall = (round - 1) * teamCount + slot

  const baselineRound = Math.ceil(overall / BASELINE_TEAM_COUNT)
  const baselineSlot = overall - (baselineRound - 1) * BASELINE_TEAM_COUNT

  const unchanged = teamCount === BASELINE_TEAM_COUNT
  return {
    overall,
    baselineRound,
    baselineSlot,
    unchanged,
    basis: unchanged
      ? null
      : `${round}.${String(slot).padStart(2, '0')} in a ${teamCount}-team league is the ${ordinal(
          overall,
        )} player off the board — a ${baselineRound}.${String(baselineSlot).padStart(
          2,
          '0',
        )} in the ${BASELINE_TEAM_COUNT}-team terms every stored price uses`,
  }
}

/**
 * How many startable free agents make a position genuinely replaceable.
 *
 * ⚠ SCALES WITH LEAGUE SIZE, BECAUSE "PLENTY" DOES. Four spare kickers is plenty
 * in a 12-team league and thin across 32 teams. Set to a third of the league
 * rather than all of it: the question is whether a manager who needs one can get
 * one, not whether every manager could simultaneously.
 */
export function replaceableThreshold(teamCount: number): number {
  return Math.max(4, Math.ceil(teamCount / 3))
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
