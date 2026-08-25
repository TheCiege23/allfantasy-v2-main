/**
 * The Zombie Universe: where the tradeable assets include items with exact
 * point values, and half the league legally cannot trade at all.
 *
 * Rules per the Beta Level 2025 document. Twenty teams — one Whisperer and
 * nineteen Survivors — on EIGHT-man rosters (1 superflex, 4 flex, 3 bench).
 * Beat by a Whisperer or a Zombie and you join the Horde.
 *
 * Four things invert the normal model, and every one of them is computable:
 *
 * ⚠ REPLACEMENT IS FREE AND INSTANT. There are no waivers at all — only free
 * agents, addable at will, "EVEN DURING GAMES". Twenty teams × eight spots is
 * 160 players rostered, so most of the NFL is available to anyone fast enough.
 * A depth player therefore has almost no trade value: the other manager can
 * simply add a comparable body for nothing. Only genuinely scarce players move
 * the needle, and FAAB does not exist to be valued.
 *
 * ⚠ THE COUNTERPARTY POOL SHRINKS AND NEVER GROWS. Zombie teams cannot trade.
 * Every infection permanently removes a trading partner, and being infected
 * removes YOUR ability to trade for the rest of the season. The right time to
 * make a deal is always earlier than it feels.
 *
 * ⚠ SERUMS AND WEAPONS ARE ASSETS WITH PUBLISHED POINT VALUES, and they price
 * exactly rather than approximately — see below.
 *
 * ⚠ AND A LOPSIDED TRADE CAN BE REVERSED. Two thirds of an eight-hour league
 * poll undoes it. The commissioner's own reasoning: "a lopsided trade can have
 * a HUGE effect on league results with roster size as small as it is." A deal
 * that grades as one-sided here is not just bad value, it is at real risk of
 * not standing.
 */

/** Weapon tiers and their weekly bonus, from the rules document. */
export const WEAPON_POINTS = {
  knife: 4,
  axe: 6,
  bow: 8,
  gun: 10,
} as const

/** The bomb is one-time and SUPPRESSES your weapons in the week it is used. */
export const BOMB_POINTS = 35

/** Only your best two weapons count in any given week. */
export const WEAPONS_COUNTED = 2

/** A serum is +10, single use, and only against a Zombie. */
export const SERUM_POINTS = 10

export type WeaponTier = keyof typeof WEAPON_POINTS

/**
 * What acquiring a weapon is actually worth, given what you already hold.
 *
 * ⚠ THE TOP-TWO RULE IS THE WHOLE VALUATION. A weapon pays its bonus every week
 * you hold it, but only your best two count — so a knife is worth 4 a week to a
 * manager holding nothing and worth EXACTLY ZERO to one already holding a gun
 * and a bow. The same item, two managers, and the honest price differs by all of
 * it. A model that priced weapons by tier would be wrong in the most common
 * case, which is a manager who already has some.
 */
export function weaponAcquisitionValue(args: {
  /** Weapons already held, as point values. */
  held: number[]
  /** Weapon being acquired, as a point value. */
  incoming: number
  /** Scoring periods left in the season. */
  weeksRemaining: number
}): { pointsPerWeek: number; totalPoints: number; basis: string } {
  const { incoming, weeksRemaining } = args
  const top = (xs: number[]) =>
    [...xs].sort((a, b) => b - a).slice(0, WEAPONS_COUNTED).reduce((a, b) => a + b, 0)

  const before = top(args.held)
  const after = top([...args.held, incoming])
  const pointsPerWeek = after - before
  const totalPoints = pointsPerWeek * Math.max(0, weeksRemaining)

  return {
    pointsPerWeek,
    totalPoints,
    basis:
      pointsPerWeek === 0
        ? `This weapon is worth nothing to you — only your top two count and you already hold two better ones. It is worth ${incoming} a week to somebody holding fewer.`
        : `Worth ${pointsPerWeek} points a week for the ${weeksRemaining} week${
            weeksRemaining === 1 ? '' : 's'
          } left, about ${totalPoints} points in total. Only your top two weapons count, so that is the improvement to your best pair, not the weapon's face value.`,
  }
}

/**
 * What a bomb is worth, which is not 35.
 *
 * ⚠ USING IT SUPPRESSES YOUR OTHER WEAPONS THAT WEEK, so the real gain is 35
 * minus whatever your top two would have given you anyway. A manager holding a
 * gun and a bow nets 17, not 35 — and a model quoting the face value overstates
 * it by double for exactly the managers most likely to be offered one.
 */
export function bombValue(args: { held: number[] }): { netPoints: number; basis: string } {
  const top = [...args.held].sort((a, b) => b - a).slice(0, WEAPONS_COUNTED)
  const suppressed = top.reduce((a, b) => a + b, 0)
  const netPoints = BOMB_POINTS - suppressed

  return {
    netPoints,
    basis:
      suppressed === 0
        ? `A bomb is a one-time ${BOMB_POINTS} points and you hold no weapons it would suppress, so it is worth the full ${BOMB_POINTS}.`
        : `A bomb is ${BOMB_POINTS} one-time points, but using it cancels your weapons that week. You would give up ${suppressed}, so the real gain is ${netPoints}.`,
  }
}

/**
 * What a serum is worth, which RISES as the season runs.
 *
 * ⚠ THE OPPOSITE OF EVERY OTHER FORMAT IN THIS REPO. A serum is +10 only
 * against a Zombie, so it is dead weight in week one when almost nobody is
 * infected and it is close to a guaranteed +10 once the Horde has taken most of
 * the league. In guillotine a trade decays toward zero as the season runs; here
 * this particular asset appreciates.
 */
export function serumValue(args: {
  /** Teams currently in the Horde, including the Whisperer. */
  zombieCount: number
  /** Teams in the league. */
  teamCount: number
}): { expectedPoints: number; oddsOfUse: number; basis: string } | null {
  const { zombieCount, teamCount } = args
  if (teamCount < 2 || zombieCount < 0 || zombieCount > teamCount) return null

  /*
   * Chance a given week's opponent is a Zombie. Approximated as the Horde's
   * share of the teams you could be drawn against — the real schedule is fixed
   * and randomised, so this is the honest expectation rather than a lookup.
   */
  const oddsOfUse = Math.min(1, zombieCount / Math.max(1, teamCount - 1))
  const expectedPoints = SERUM_POINTS * oddsOfUse

  return {
    expectedPoints: Math.round(expectedPoints * 10) / 10,
    oddsOfUse,
    basis:
      zombieCount === 0
        ? 'A serum is +10 against a Zombie, and there are none yet. It is worth nothing this week and more every week the Horde grows.'
        : `${zombieCount} of ${teamCount} teams are infected, so a serum is roughly ${Math.round(
            oddsOfUse * 100,
          )}% likely to find a Zombie opponent — about ${
            Math.round(expectedPoints * 10) / 10
          } expected points, rising every week the Horde grows.`,
  }
}

/**
 * How many managers you can still legally trade with, and what that is worth
 * knowing.
 *
 * ⚠ THIS ONLY EVER GOES DOWN. Zombies cannot trade, infection is permanent
 * within a season, and the moment you are infected you cannot trade either. So
 * the option to make a deal is a wasting asset held by both sides at once, and
 * "we can always do this later" is false in a way it is not in any other format.
 */
export function tradeWindow(args: {
  survivors: number
  /** Whether the Whisperer is still uninfected — they can trade. */
  whispererActive: boolean
  teamCount: number
}): { partners: number; basis: string } | null {
  const { survivors, teamCount } = args
  if (teamCount < 2 || survivors < 0 || survivors > teamCount) return null

  /* Everyone who can legally trade, minus yourself. */
  const partners = Math.max(0, survivors + (args.whispererActive ? 1 : 0) - 1)

  return {
    partners,
    basis:
      partners === 0
        ? 'There is nobody left in this league who can legally trade. Zombies cannot make deals, and the Horde has everyone.'
        : `${partners} team${
            partners === 1 ? '' : 's'
          } in this league can still legally trade — Zombies cannot. That number only ever falls, and it reaches zero for you the week you are infected, so a deal you are considering for "later" may not have a later.`,
  }
}

/**
 * Whether this deal is lopsided enough to be at real risk of reversal.
 *
 * ⚠ NOT A FAIRNESS OPINION, A PROCEDURAL WARNING. Two thirds of an eight-hour
 * league poll reverses a trade here, and the commissioner's stated reason is
 * that small rosters magnify a one-sided deal. A manager should know before
 * agreeing that the trade may simply not stand — that is different information
 * from "you are winning this trade", and more actionable.
 */
const VETO_RISK_PCT = 25

export function vetoRiskNote(args: {
  /** Percentage difference between the two sides, as the console computes it. */
  percentDiff: number | null
}): string | null {
  if (args.percentDiff == null) return null
  if (Math.abs(args.percentDiff) < VETO_RISK_PCT) return null
  return `This deal is about ${Math.abs(
    Math.round(args.percentDiff),
  )}% one-sided. In this league a trade the commissioner flags goes to an eight-hour poll and two thirds can reverse it — small rosters make a lopsided deal matter more here, so expect scrutiny even if both managers are happy.`
}
