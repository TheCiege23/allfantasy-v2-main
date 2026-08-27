/**
 * Fantrax's scoring settings, in the stat keys the rest of this codebase uses.
 *
 * ⚠ READ `scoringCategorySettings`, NEVER `scoringCategories`. The same response
 * carries both, and the compact one is WRONG in a way that looks fine. It is
 * keyed by SHORT NAME, and short names collide — measured on a real league:
 *
 *     compact  YDS: 0.1          (one entry)
 *     actual   passing yards     0.04
 *              receiving yards   0.1
 *              rushing yards     0.1
 *
 * Three categories collapsed into one, keeping the wrong number. Scoring passing
 * yards at 0.1 instead of 0.04 is 2.5x, roughly 240 points a season on a
 * 4,000-yard quarterback — enough to reorder every valuation in the league, and
 * nothing about the output would look broken. `TD` collides three ways and `REC`
 * twice for the same reason.
 */

import type { FantraxLeagueInfo } from './fantraxApi'

export type FantraxScoringRule = { stat_key: string; points_value: number }

export type FantraxScoringResult = {
  rules: FantraxScoringRule[]
  /** Categories we could not place, named rather than dropped. */
  gaps: string[]
}

/**
 * Fantrax category code -> the stat key(s) it means here.
 *
 * ⚠ SOME ARE ONE-TO-MANY, AND THAT IS NOT A ROUNDING ERROR. Fantrax keeps a
 * single bucket where this codebase keeps three: one "two point conversions"
 * category against pass/rush/rec, and one "return touchdowns" against kick and
 * punt returns. Fanning the value out to each is the only reading that scores a
 * player correctly; picking one would silently zero the other two.
 */
const CATEGORY_KEYS: Record<string, string[]> = {
  INDIVIDUAL_PASSING_YARDS: ['pass_yd'],
  INDIVIDUAL_PASSING_TOUCHDOWNS: ['pass_td'],
  INDIVIDUAL_RUSHING_YARDS: ['rush_yd'],
  INDIVIDUAL_RUSHING_TOUCHDOWNS: ['rush_td'],
  INDIVIDUAL_RECEIVING_YARDS: ['rec_yd'],
  INDIVIDUAL_RECEIVING_TOUCHDOWNS: ['rec_td'],
  INDIVIDUAL_RECEPTIONS: ['rec'],
  INDIVIDUAL_FUMBLES_RECOVERED_TOUCHDOWNS_OFFENSE: ['fum_rec_td'],
  INDIVIDUAL_TWO_POINT_CONVERSIONS_SCORES: ['pass_2pt', 'rush_2pt', 'rec_2pt'],
  INDIVIDUAL_RETURN_TOUCHDOWNS: ['kr_td', 'pr_td'],
}

/** Position-specific reception values map to a bonus, keyed by position code. */
const RECEPTION_BONUS_BY_POSITION: Record<string, string> = {
  TE: 'bonus_rec_te',
}

type Config = {
  points?: unknown
  position?: { shortName?: string; code?: string } | null
  scoringCategory?: { code?: string; name?: string; shortName?: string } | null
}

function readConfigs(info: FantraxLeagueInfo): Config[] {
  const system = info.scoringSystem as
    | { scoringCategorySettings?: Array<{ configs?: Config[] }> }
    | null
    | undefined
  return system?.scoringCategorySettings?.flatMap((s) => s.configs ?? []) ?? []
}

/**
 * Turn a league's scoring settings into rules.
 *
 * ⚠ TE PREMIUM IS THE DIFFERENCE, NOT THE TOTAL. Fantrax states the whole value
 * for the position — 1.5 per reception for a tight end where everyone else gets
 * 1. `bonus_rec_te` is added ON TOP of `rec`, so writing 1.5 there would score
 * tight ends 2.5 a catch. The default is subtracted to get the 0.5 that is
 * actually the premium.
 */
export function fantraxScoringRules(info: FantraxLeagueInfo): FantraxScoringResult {
  const configs = readConfigs(info)
  const rules: FantraxScoringRule[] = []
  const gaps: string[] = []

  const defaultReception = configs.find(
    (c) =>
      c.scoringCategory?.code === 'INDIVIDUAL_RECEPTIONS' &&
      isDefaultPosition(c.position?.shortName ?? c.position?.code),
  )
  const defaultReceptionPoints = Number(defaultReception?.points)

  for (const config of configs) {
    const code = config.scoringCategory?.code
    const points = Number(config.points)
    if (!code || !Number.isFinite(points)) continue

    const position = config.position?.shortName ?? config.position?.code
    if (!isDefaultPosition(position)) {
      /* A per-position override. Only receptions have a home for one today. */
      if (code === 'INDIVIDUAL_RECEPTIONS' && position && RECEPTION_BONUS_BY_POSITION[position]) {
        const bonus = Number.isFinite(defaultReceptionPoints)
          ? points - defaultReceptionPoints
          : points
        if (bonus !== 0) {
          rules.push({ stat_key: RECEPTION_BONUS_BY_POSITION[position], points_value: round(bonus) })
        }
        continue
      }
      gaps.push(
        `${config.scoringCategory?.name ?? code} is scored differently for ${position}, and that per-position rule is not carried across`,
      )
      continue
    }

    const keys = CATEGORY_KEYS[code]
    if (!keys) {
      gaps.push(`${config.scoringCategory?.name ?? code} has no equivalent here, so it is not scored`)
      continue
    }
    for (const key of keys) rules.push({ stat_key: key, points_value: round(points) })
  }

  return { rules, gaps }
}

function isDefaultPosition(position: string | null | undefined): boolean {
  if (!position) return true
  const normalized = position.trim().toUpperCase()
  return normalized === 'DEFAULT' || normalized === '-1'
}

/** Fantrax sends 0.04 and 0.1 as floats; keep them exact rather than drifting. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
