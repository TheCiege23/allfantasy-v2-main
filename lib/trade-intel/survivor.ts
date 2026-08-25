/**
 * Survivor: where a trade partner's tribe decides whether the deal helps you,
 * and where the merge inverts what "good" means.
 *
 * Twenty managers in four tribes of five. The lowest-scoring TRIBE attends
 * Tribal Council; post-merge it is individual and the weekly TOP scorer takes
 * Immunity. Nine to twelve idols are seeded randomly after the draft from a pool
 * of twenty powers, one-time use, TRADEABLE, and almost all of them expire at
 * the merge.
 *
 * Four things here are unlike every other format in this repo:
 *
 * ⚠ TRADING WITH A TRIBEMATE AND TRADING WITH A RIVAL ARE DIFFERENT
 * TRANSACTIONS. Pre-merge you go to Tribal only if your TRIBE scores lowest, so
 * strengthening a tribemate strengthens you — a "losing" trade inside your own
 * tribe can still be correct. Strengthening another tribe is the reverse. No
 * value chart can see the difference and it is the single largest factor here.
 *
 * ⚠ THE MERGE INVERTS THE ADVICE. Before it you need your tribe not to finish
 * LAST, which rewards a floor. After it the weekly top scorer takes Immunity,
 * which rewards a CEILING. The same roster is well built for one and badly built
 * for the other, and the switch happens on a known date.
 *
 * ⚠ IDOLS DECAY TO A CLIFF, NOT TO ZERO GRADUALLY. Pre-merge-only powers are
 * worth their full effect right up to the merge and exactly nothing after it, so
 * their value falls with the weeks left to use them. Two of the twenty convert
 * instead of expiring, which gives those two a floor nothing else has.
 *
 * ⚠ AND A STEAL IDOL IS WORTH WHAT IT CAN TAKE. "Triple Steal — steal 3 players
 * from any one roster" is priceable against the actual rosters in the league:
 * it is worth the best three players on the best roster you are allowed to
 * target, which is a real number rather than an item tier.
 */

/** Idol powers with a directly stated numeric effect. */
export const IDOL_POINTS = {
  'points surge': 20,
  'clutch': 10,
  'score shield': 10,
  'convert idol → points': 25,
} as const

/** Idol powers denominated in FAAB. */
export const IDOL_FAAB = {
  'faab bounty': 100,
  'convert idol → faab': 150,
} as const

/**
 * The two powers that survive the merge by converting rather than expiring.
 *
 * ⚠ THESE ARE THE ONLY IDOLS WITH A FLOOR. Everything else in the pool is
 * pre-merge-only and is worth nothing the moment the merge lands, so an idol
 * held too long is a wasted asset — which is exactly the mistake a manager makes
 * when they are saving it for the right moment.
 */
export const CONVERTING_IDOLS = ['convert idol → faab', 'convert idol → points'] as const

export type IdolHorizon = {
  weeksToMerge: number
  /** 1 with the whole pre-merge stretch left, approaching 0 at the merge. */
  usabilityMultiplier: number
  /** True when this power converts instead of expiring. */
  hasFloor: boolean
  basis: string
}

/**
 * How much of an idol's value is still reachable.
 *
 * Linear in the weeks left rather than modelled: a one-time power is worth the
 * chance you find a week to use it well, and with more weeks you find a better
 * one. Stated as the simple thing it is rather than dressed up.
 */
export function idolHorizon(args: {
  weeksToMerge: number
  /** Total pre-merge weeks, so "how much is left" has a denominator. */
  preMergeWeeks: number
  /** Lowercased power name, to spot the two that convert. */
  power?: string | null
}): IdolHorizon | null {
  const { weeksToMerge, preMergeWeeks } = args
  if (preMergeWeeks <= 0 || weeksToMerge < 0 || weeksToMerge > preMergeWeeks) return null

  const power = (args.power ?? '').toLowerCase()
  const hasFloor = CONVERTING_IDOLS.some((c) => power.includes(c.replace('convert idol → ', '')))
  const usabilityMultiplier = weeksToMerge / preMergeWeeks

  return {
    weeksToMerge,
    usabilityMultiplier,
    hasFloor,
    basis: hasFloor
      ? `${weeksToMerge} week${
          weeksToMerge === 1 ? '' : 's'
        } to the merge. This is one of the two idols that CONVERTS rather than expiring, so it keeps a floor even unused — it is the one you can safely sit on.`
      : weeksToMerge === 0
        ? 'The merge has landed. Pre-merge idols are already worth nothing — this cannot be used and cannot be traded for value.'
        : `${weeksToMerge} of ${preMergeWeeks} pre-merge week${
            preMergeWeeks === 1 ? '' : 's'
          } left. This power expires AT the merge and does not convert, so it is worth about ${Math.round(
            usabilityMultiplier * 100,
          )}% of what it was at the draft. Saving it for the perfect moment is how it becomes worth nothing.`,
  }
}

/**
 * What a steal idol is actually worth: the players it can take.
 *
 * ⚠ PRICED AGAINST REAL ROSTERS, NOT AS AN ITEM TIER. A Triple Steal aimed at a
 * league where the best roster's top three are worth 18,000 is a completely
 * different asset from the same idol in a league where they are worth 6,000.
 * Every other model would call both "a steal idol".
 *
 * `eligibleRosters` is the set the idol may legally target — the Single Steal
 * can only take from an opponent you beat last week, and passing the full league
 * for that power would overstate it substantially.
 */
export function stealIdolValue(args: {
  /** Each targetable roster's player values, best first is not required. */
  eligibleRosters: Array<{ label: string; playerValues: number[] }>
  /** How many players this power takes, all from ONE roster. */
  takes: number
}): { bestTarget: string; value: number; basis: string } | null {
  const { eligibleRosters, takes } = args
  if (eligibleRosters.length === 0 || takes < 1) return null

  let best: { label: string; value: number } | null = null
  for (const r of eligibleRosters) {
    const priced = r.playerValues.filter((v) => Number.isFinite(v) && v > 0)
    if (priced.length === 0) continue
    const take = [...priced].sort((a, b) => b - a).slice(0, takes)
    const value = take.reduce((a, b) => a + b, 0)
    if (!best || value > best.value) best = { label: r.label, value }
  }
  if (!best) return null

  return {
    bestTarget: best.label,
    value: best.value,
    basis: `Aimed at ${best.label} this takes about ${best.value.toLocaleString()} of value — the best ${takes} player${
      takes === 1 ? '' : 's'
    } on the best roster it can legally target. That is what this idol is worth in this league right now, and it moves every week as rosters do.`,
  }
}

export type TribeRelation = 'tribemate' | 'rival' | 'post-merge' | 'unknown'

/**
 * Whether this deal helps the tribe that keeps you out of Tribal Council.
 *
 * ⚠ THE LARGEST FACTOR IN A PRE-MERGE SURVIVOR TRADE AND NO CHART HAS IT. You
 * attend Tribal only if your TRIBE scores lowest, so points you hand a tribemate
 * still count for you. A deal that grades as a small loss can be correct inside
 * your own tribe and a clear mistake across tribes — the same players, the same
 * numbers, opposite conclusions.
 *
 * The catch, and it is worth saying out loud: the tribemate you strengthen is
 * also the person who votes at your Tribal. This does not resolve that, because
 * it cannot.
 */
export function tribeRelationNote(args: {
  relation: TribeRelation
  /** Positive when value is flowing away from the viewer. */
  valueOutFlow: boolean
}): string | null {
  const { relation, valueOutFlow } = args

  if (relation === 'post-merge') {
    return 'Post-merge there are no tribes — every point you hand over is a point working against you, and the weekly top scorer takes Immunity. Cooperative trades stop making sense here.'
  }
  if (relation === 'tribemate') {
    return valueOutFlow
      ? 'This is a TRIBEMATE. Your tribe attends Tribal only if it scores lowest, so points you give them still keep you out of Tribal — a deal that grades as a small loss can be correct here. The catch is that the person you just strengthened also votes at your Tribal.'
      : 'This is a TRIBEMATE. Taking value off them raises your score and lowers your tribe’s — you are more likely to win a vote you are also more likely to attend.'
  }
  if (relation === 'rival') {
    return valueOutFlow
      ? 'This is a RIVAL TRIBE. Every point you send over makes it likelier that YOUR tribe is the low scorer, so this deal has to win on value alone — there is no cooperative upside to fall back on.'
      : 'This is a RIVAL TRIBE. Value coming from another tribe helps you twice: your tribe’s total rises and theirs falls.'
  }
  return null
}

/**
 * The merge flips what a good roster is.
 *
 * ⚠ SAID BEFORE IT HAPPENS, NOT AFTER. Pre-merge you need your tribe not to
 * finish last, which rewards a reliable floor. Post-merge the weekly top scorer
 * takes Immunity, which rewards a ceiling. A manager who builds for one and
 * arrives at the other has built the wrong team on a known schedule — and this
 * is the one inversion in the whole model with a date attached.
 */
export function mergeInversionNote(args: {
  weeksToMerge: number
  /** How close to the merge is worth warning about. */
  horizonWeeks?: number
}): string | null {
  const horizon = args.horizonWeeks ?? 3
  if (args.weeksToMerge <= 0) {
    return 'Post-merge: Immunity goes to the weekly TOP scorer, so upside now wins and consistency no longer protects you. If this roster was built to avoid finishing last, it is built for the game that just ended.'
  }
  if (args.weeksToMerge > horizon) return null
  return `The merge is ${args.weeksToMerge} week${
    args.weeksToMerge === 1 ? '' : 's'
  } away and it inverts what a good roster is. Until then your TRIBE just needs to not score lowest, which rewards a floor; after it Immunity goes to the weekly top scorer, which rewards a ceiling. Trade for the game you are about to be playing, not the one you are in.`
}
