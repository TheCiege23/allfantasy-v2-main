/**
 * How much a season is worth — the tunable half of the ranking.
 *
 * ⚠ NOTHING HERE IS STORED. `managerCareerFacts` records what happened; this
 * decides what it was worth, at read time. Every number below is expected to
 * change, and changing one must never rewrite a fact. That separation is why a
 * weight can be argued about without corrupting the history everyone has
 * already compared.
 *
 * The owner's rule, in their words: winning a hard league carries the most
 * weight; competing in one carries "a slight reward because you are taking the
 * risk and putting yourself on the line", and money on the line earns a little
 * extra. So the shape is a small participation base, a paid-league bump, and a
 * win multiplier that scales with how hard the league actually is.
 */

/** What a manager actually did. A boolean champion flag cannot express these. */
export type Achievement =
  | 'competed'
  /** Zombie: outlasted the Horde for a full season. Not a championship. */
  | 'survived'
  /** Tournament: reached a named round without winning it. */
  | 'advanced'
  | 'made_playoffs'
  | 'champion'

/**
 * What we know about the league a season was played in.
 *
 * `teamCount` is the league's own size. For a tournament that is the SHELL
 * league, not the field — see `fieldSize`.
 */
export type LeagueContext = {
  leagueType: string
  teamCount: number
  /**
   * Total teams competing for the same prize, when a league is one shard of a
   * larger contest.
   *
   * ⚠ THE KING BUFFALO TOURNAMENT IS ~240 TEAMS ACROSS 20 SHELL LEAGUES. Read
   * as a 12-team league it looks easier than a 20-team zombie league, which
   * inverts the truth: winning it means surviving the top-64 cut and then seven
   * single-elimination rounds across three separate drafts.
   */
  fieldSize?: number | null
  /** Zombie Universe rung: gamma < beta < alpha. Each is earned by surviving the last. */
  tier?: 'gamma' | 'beta' | 'alpha' | null
  /** Real money at stake. The owner asked for a small bump; risk is the reason. */
  isPaid?: boolean
}

/**
 * Base difficulty per format.
 *
 * ⚠ THESE ARE OPINIONS, NOT MEASUREMENTS, and they are the first thing to tune.
 * The ordering encodes the owner's stated view: a specialty league where the
 * game actively fights you outranks a standard redraft.
 */
export const FORMAT_DIFFICULTY: Record<string, number> = {
  redraft: 1.0,
  dynasty: 1.2, // multi-year roster construction, but a familiar game
  guillotine: 1.6, // the field shrinks weekly; every week is an elimination
  zombie: 1.8, // opponents convert to a coordinated horde hunting you
  tournament: 1.9, // survive a cut, then single elimination, re-drafting twice
  survivor: 1.8,
  unknown: 1.0,
}

/** Surviving Alpha is the top of a three-year climb, and priced like it. */
const TIER_MULTIPLIER: Record<string, number> = { gamma: 1.0, beta: 1.25, alpha: 1.6 }

/**
 * Field size, heavily damped.
 *
 * ⚠ SIZE IS AN INPUT TO DIFFICULTY, NOT DIFFICULTY. The owner was explicit that
 * a 22-team zombie league may be harder than a 150-team tournament. A linear
 * term would make headcount dominate everything and reproduce exactly the error
 * they warned about, so this is logarithmic and capped: a 240-team field is
 * worth meaningfully more than a 12-team one, not twenty times more.
 */
function fieldFactor(ctx: LeagueContext): number {
  const size = Math.max(ctx.fieldSize ?? ctx.teamCount ?? 12, 2)
  const factor = 1 + Math.log2(size / 12) * 0.15
  return Math.min(Math.max(factor, 0.85), 1.5)
}

/** What each achievement is worth before difficulty is applied. */
const ACHIEVEMENT_BASE: Record<Achievement, number> = {
  competed: 1,
  made_playoffs: 3,
  advanced: 5,
  survived: 10,
  champion: 12,
}

export type SeasonScore = {
  points: number
  difficulty: number
  achievement: Achievement
  /** Every term that produced the number, so "why am I a 9?" is answerable. */
  breakdown: Record<string, number>
}

/**
 * Score one season.
 *
 * Returns the components alongside the total on purpose. A rank a user cannot
 * interrogate is a rank they will not trust, and this is a product whose whole
 * claim is that the numbers are verifiable.
 */
export function scoreSeason(achievement: Achievement, ctx: LeagueContext): SeasonScore {
  const format = FORMAT_DIFFICULTY[ctx.leagueType] ?? FORMAT_DIFFICULTY.unknown
  const tier = ctx.tier ? (TIER_MULTIPLIER[ctx.tier] ?? 1) : 1
  const field = fieldFactor(ctx)
  const difficulty = format * tier * field

  const base = ACHIEVEMENT_BASE[achievement]
  // Money on the line: a small, flat bump for exposure, not a scaling term.
  // Risk is the justification, so it applies to competing as much as winning.
  const paid = ctx.isPaid ? 1 : 0

  /*
   * Difficulty multiplies the ACHIEVEMENT, so a hard league rewards winning far
   * more than showing up — which is the rule as stated. Competing in a zombie
   * league still beats competing in a redraft, but only slightly.
   */
  const points = base * difficulty + paid

  return {
    points: Math.round(points * 100) / 100,
    difficulty: Math.round(difficulty * 1000) / 1000,
    achievement,
    breakdown: {
      achievementBase: base,
      formatDifficulty: format,
      tierMultiplier: tier,
      fieldFactor: Math.round(field * 1000) / 1000,
      paidBonus: paid,
    },
  }
}
