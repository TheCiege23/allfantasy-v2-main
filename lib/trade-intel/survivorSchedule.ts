/**
 * What a PUBLISHED elimination schedule does to value. PURE.
 *
 * ── 🛑 WHY `guillotineHorizon` IS NOT ENOUGH, MEASURED RATHER THAN ASSERTED ─────────────────
 * `lib/trade-intel/guillotine.ts` assumes ONE chop per week from here to the end, which makes
 * expected weeks alive `(T−1)/2`. That is exactly right for a league that chops one team a week
 * forever, and it is the honest default when a league has published nothing else.
 *
 * A survivor-style league publishes its whole schedule in advance, and the schedule is not flat.
 * Survivor All-Stars Guillotine (22 teams, 2026) runs one elimination a week for ten weeks, then
 * TWO a week for three weeks — "The Gauntlet" — then one a week, then a final week with no
 * elimination at all.
 *
 * ⚠ THE EFFECT WAS MEASURED TWICE, BECAUSE THE FIRST MEASUREMENT CONFLATED TWO CAUSES. Comparing
 * this module against `guillotineHorizon` directly gives 12.9 points at week 11 — but ~3.8 of
 * those points are an off-by-one between the two functions (below), not the Gauntlet. Re-run with
 * the SAME maths and only the schedule changed — a flat 22-team, one-a-week season against the
 * real week list — the Gauntlet's own cost is:
 *
 *     wk   this schedule   flat 22-team   the flat schedule overprices by
 *      9          0.529          0.594                            6.6 pts
 *     10          0.463          0.540                            7.7 pts
 *     11          0.395          0.485                            9.1 pts   <- worst, a 19% overprice
 *     12          0.355          0.429                            7.3 pts
 *     13          0.321          0.370                            4.9 pts
 *
 * Expected weeks played from week one: 10.14 against 10.82. The error peaks in the three weeks
 * before the Gauntlet, which is exactly when a manager is deciding whether to spend the rest of
 * their FAAB — the model cannot see the cliff coming, so it is most wrong where it matters most.
 *
 * 🛑 AND A SEPARATE, STRUCTURAL DIFFERENCE FROM `guillotineHorizon`, WORTH KNOWING BEFORE YOU
 * COMPARE THE TWO: it uses `(T−1)/2`, which does NOT count the week you are currently playing;
 * summing the survival curve gives `(T+1)/2`, which does. The gap is zero at a full field and
 * grows as the field shrinks — on a flat 12-team league, 0.014 at week 2 and 0.154 at the last
 * week, where it says a lone survivor has zero weeks left and he plainly has one. So the two
 * functions' ABSOLUTE `expectedWeeksAlive` are not interchangeable. Their self-relative
 * multipliers are comparable in shape, and that is the only comparison this module claims.
 *
 * ⚠ THE CORRECTION IS NOT A TUNED CONSTANT. It reads the league's own published week list. There
 * is no free parameter here to get wrong — if the schedule is right, the horizon is right.
 *
 * ── 🛑 AND IT REFUSES RATHER THAN ASSUMING ─────────────────────────────────────────────────
 * A league with no published schedule gets `null`, not a flat schedule invented on its behalf.
 * The caller should fall back to `guillotineHorizon`, which is honest about being an assumption.
 * Manufacturing a schedule here would produce a confident number from nothing — the same failure
 * `scoringFit` refuses when it cannot read a league's reception rule.
 */

/** Teams still alive at the START of a week, for every scored week of the season. */
export interface SurvivorSchedule {
  id: string
  label: string
  /** Week number → teams alive at the start of that week. Must be non-increasing. */
  aliveByWeek: Readonly<Record<number, number>>
}

export interface SurvivorHorizon {
  week: number
  teamsAlive: number
  /** Teams eliminated at the end of this week. Zero on a placement week. */
  chopsThisWeek: number
  /** P(you are eliminated this week), under the league's own "lowest score goes" premise. */
  hazard: number
  /** P(a week-one team is still alive now). */
  survivalFromStart: number
  /** Weeks you can still expect to PLAY, counting this one, given you are alive now. */
  expectedWeeksAlive: number
  /**
   * What an asset acquired NOW is worth against the same asset in week one. Self-relative, so it
   * needs no cross-format baseline — the same property that let the guillotine model exist.
   */
  multiplier: number
  basis: string
}

/**
 * 🛑 THE PREMISE, STATED SO IT CAN BE ARGUED WITH: every team still alive is equally likely to be
 * the one eliminated. That is this league's own rule — "the only way you'll be eliminated is being
 * the lowest scoring team" — with no claim about who is good. It is the identical premise
 * `guillotineHorizon` already makes, so the two differ in SCHEDULE, never in model.
 *
 * ⚠ It follows that P(alive at week w) is just `alive[w] / alive[first]`, which is what makes this
 * computable from the week list alone and needs no simulation.
 */
function weeksOf(schedule: SurvivorSchedule): number[] {
  return Object.keys(schedule.aliveByWeek)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
}

/** Null when the schedule is unusable, so a malformed one cannot quietly produce a price. */
export function validateSchedule(schedule: SurvivorSchedule | null | undefined): string | null {
  if (!schedule) return 'no schedule'
  const weeks = weeksOf(schedule)
  if (weeks.length < 2) return 'a schedule needs at least two weeks'
  let prev = Number.POSITIVE_INFINITY
  for (const w of weeks) {
    const alive = schedule.aliveByWeek[w]
    if (typeof alive !== 'number' || !Number.isFinite(alive) || alive < 1) return `week ${w} has no usable team count`
    if (alive > prev) return `week ${w} has MORE teams alive than the week before — eliminations do not reverse`
    prev = alive
  }
  return null
}

/**
 * The horizon at a given week, or null when the schedule cannot answer.
 *
 * ⚠ `week` MUST be a week the schedule lists. A week outside it is not clamped to the nearest
 * one: clamping week 30 to week 17 would answer a question about a season that has ended, and the
 * caller cannot tell that from a real answer.
 */
export function survivorHorizon(
  schedule: SurvivorSchedule | null | undefined,
  week: number,
): SurvivorHorizon | null {
  if (validateSchedule(schedule) !== null) return null
  const s = schedule as SurvivorSchedule
  const weeks = weeksOf(s)
  if (!weeks.includes(week)) return null

  const teamsAlive = s.aliveByWeek[week]
  const first = s.aliveByWeek[weeks[0]]
  const idx = weeks.indexOf(week)
  const next = idx + 1 < weeks.length ? s.aliveByWeek[weeks[idx + 1]] : teamsAlive
  const chopsThisWeek = teamsAlive - next

  /* Weeks you still get to play, conditional on being alive now. */
  const remaining = (from: number) => {
    const alive0 = s.aliveByWeek[from]
    let sum = 0
    for (const w of weeks) if (w >= from) sum += s.aliveByWeek[w] / alive0
    return sum
  }

  const expectedWeeksAlive = remaining(week)
  const atStart = remaining(weeks[0])
  const multiplier = atStart > 0 ? expectedWeeksAlive / atStart : 0

  const basis =
    chopsThisWeek === 0
      ? `Week ${week}: ${teamsAlive} left and nobody goes home — this is the last word.`
      : `Week ${week}: ${teamsAlive} of ${first} left, ${chopsThisWeek} going home this week ` +
        `(${Math.round((chopsThisWeek / teamsAlive) * 100)}% chance it is you). About ` +
        `${expectedWeeksAlive.toFixed(1)} more weeks of football, so anything you buy now is worth ` +
        `roughly ${Math.round(multiplier * 100)}% of what it was worth in week one.`

  return {
    week,
    teamsAlive,
    chopsThisWeek,
    hazard: chopsThisWeek / teamsAlive,
    survivalFromStart: teamsAlive / first,
    expectedWeeksAlive,
    multiplier,
    basis,
  }
}

/**
 * The share of your REMAINING survival-weighted weeks that fall on or after a rule change.
 *
 * 🛑 THIS IS WHY A CHART CANNOT PRICE THIS LEAGUE'S QUARTERBACKS. The market chart is fetched with
 * ONE `numQbs`, and Survivor All-Stars adds a SUPERFLEX spot at Week 9 — so a 1QB chart is wrong
 * for weeks 9-17 and a superflex chart is wrong for weeks 1-8. Whichever you pick is wrong for
 * half the season. It is the same shape as the per-position reception weight `scoringFit` handles,
 * reached through the schedule rather than the scoring settings.
 *
 * ⚠ AND IT IS A BIG NUMBER, NOT A ROUNDING ONE. Measured on the live chart pairs that differ only
 * in `numQbs` (nine of them cached in prod, `dynasty:*:1qb:*` against `dynasty:*:2qb:*`): the top
 * quarterbacks are worth **+79% to +98%** more under superflex, median rank gain +36 to +39, Josh
 * Allen #18 → #1. The control holds — the top receivers move between -3% and +1%, so the
 * difference really is the quarterback rule and not two unrelated charts.
 *
 * ⚠ WEIGHTED BY SURVIVAL, NOT BY CALENDAR. Nine of seventeen weeks are superflex weeks, but a
 * week you are unlikely to reach is worth less than one you will certainly play, so counting weeks
 * would overstate the back half for exactly the managers deciding whether to buy a quarterback.
 *
 * Returns null on an unusable schedule or a week it does not list — never a default share.
 */
export function shareOfRemainingFrom(
  schedule: SurvivorSchedule | null | undefined,
  week: number,
  changeWeek: number,
): number | null {
  if (validateSchedule(schedule) !== null) return null
  const s = schedule as SurvivorSchedule
  const weeks = weeksOf(s)
  if (!weeks.includes(week)) return null
  if (!Number.isFinite(changeWeek)) return null

  const alive0 = s.aliveByWeek[week]
  let total = 0
  let after = 0
  for (const w of weeks) {
    if (w < week) continue
    const weight = s.aliveByWeek[w] / alive0
    total += weight
    if (w >= changeWeek) after += weight
  }
  if (!(total > 0)) return null
  return after / total
}

/** The week Survivor All-Stars adds its SUPERFLEX spot. From the constitution, not inferred. */
export const SURVIVOR_ALL_STARS_SUPERFLEX_WEEK = 9

/**
 * Blend two chart values across a mid-season roster change, or null when it cannot tell.
 *
 * ⚠ RETURNS null RATHER THAN THE 1QB VALUE when the schedule cannot answer. Falling back to one
 * side would silently price half the season wrong and look like a real answer — the same refusal
 * `scoringFit` makes, and for the same reason.
 */
export function blendAcrossRosterChange(args: {
  schedule: SurvivorSchedule | null | undefined
  week: number
  changeWeek: number
  /** Value under the rules in force BEFORE the change. */
  before: number
  /** Value under the rules in force FROM the change onward. */
  after: number
}): { value: number; shareAfter: number; reason: string } | null {
  const share = shareOfRemainingFrom(args.schedule, args.week, args.changeWeek)
  if (share == null) return null
  if (!Number.isFinite(args.before) || !Number.isFinite(args.after)) return null

  const value = args.before * (1 - share) + args.after * share
  /*
   * ⚠ THESE TWO BRANCHES WERE THE WRONG WAY ROUND AND A TEST CAUGHT IT. `share` is the fraction of
   * your remaining season that falls ON OR AFTER the change, so share >= 1 means the change is
   * BEHIND you (everything left is under the new rules) and share <= 0 means it never arrives at
   * all. The value was always right; only the sentence was wrong — which is the kind of defect
   * that ships, because nobody diffs prose against a multiplier.
   */
  const pct = Math.round(share * 100)
  const reason =
    share >= 1
      ? `The week-${args.changeWeek} change is behind you — every week you have left is under it.`
      : share <= 0
        ? `The week-${args.changeWeek} change never arrives in the season you have left — priced entirely on the current rules.`
        : `${pct}% of the football you have left is under the week-${args.changeWeek} rules, so this is ` +
          `blended ${100 - pct}/${pct} rather than priced on either chart alone.`

  return { value: Math.round(value), shareAfter: share, reason }
}

/**
 * Survivor All-Stars Guillotine, 2026 — read off the constitution's own week list, not inferred.
 *
 *   W1–10   one elimination a week (Match Play / Tribe Champion), 22 → 13
 *   W11–13  The Gauntlet: TWO a week, one on each tribe, 12 → 8 → 6
 *   W14–16  merged, one a week, 6 → 4
 *   W17     three teams, no elimination — money placement
 */
export const SURVIVOR_ALL_STARS_2026: SurvivorSchedule = {
  id: 'survivor_all_stars_2026',
  label: 'Survivor All-Stars Guillotine (22 teams)',
  aliveByWeek: {
    1: 22, 2: 21, 3: 20, 4: 19, 5: 18, 6: 17, 7: 16, 8: 15, 9: 14, 10: 13,
    11: 12, 12: 10, 13: 8,
    14: 6, 15: 5, 16: 4,
    17: 3,
  },
}
