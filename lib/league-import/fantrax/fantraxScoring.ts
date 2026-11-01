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
 * single bucket where this codebase keeps distinct roles: one "two point conversions scored"
 * category against rush/rec; passing conversions are a separate category, and one "return touchdowns" against kick and
 * punt returns. Fanning the value out to each is the only reading that scores a
 * player correctly; picking one would silently zero the other two.
 */
const CATEGORY_KEYS: Record<string, string[]> = {
  INDIVIDUAL_DOUBLES: ['double'],
  INDIVIDUAL_HIT_BY_PITCHES: ['hbp'],
  INDIVIDUAL_HOME_RUNS: ['hr'],
  INDIVIDUAL_RBIS: ['rbi'],
  INDIVIDUAL_RUNS_SCORED: ['r'],
  INDIVIDUAL_SINGLES: ['single'],
  INDIVIDUAL_STOLEN_BASES: ['sb'],
  INDIVIDUAL_TRIPLES: ['triple'],
  INDIVIDUAL_WALKS: ['bb'],
  INDIVIDUAL_EARNED_RUNS_ALLOWED: ['er'],
  INDIVIDUAL_INNINGS_PITCHED: ['ip'],
  INDIVIDUAL_LOSSES: ['l'],
  INDIVIDUAL_QUALITY_STARTS: ['qs'],
  INDIVIDUAL_SAVES: ['sv'],
  INDIVIDUAL_STRIKE_OUTS_PITCHED: ['so'],
  INDIVIDUAL_WINS: ['w'],
  INDIVIDUAL_PASSING_YARDS: ['pass_yd'],
  INDIVIDUAL_PASSING_TOUCHDOWNS: ['pass_td'],
  INDIVIDUAL_RUSHING_YARDS: ['rush_yd'],
  INDIVIDUAL_RUSHING_TOUCHDOWNS: ['rush_td'],
  INDIVIDUAL_RECEIVING_YARDS: ['rec_yd'],
  INDIVIDUAL_RECEIVING_TOUCHDOWNS: ['rec_td'],
  INDIVIDUAL_RECEPTIONS: ['rec'],
  INDIVIDUAL_FUMBLES_RECOVERED_TOUCHDOWNS_OFFENSE: ['fum_rec_td'],
  INDIVIDUAL_TWO_POINT_CONVERSIONS_SCORES: ['rush_2pt', 'rec_2pt'],
  INDIVIDUAL_TWO_POINT_CONVERSIONS_PASSES: ['pass_2pt'],
  INDIVIDUAL_RETURN_TOUCHDOWNS: ['kr_td', 'pr_td'],
}

/**
 * ⚠ THE SAME CODE MEANS DIFFERENT STATS IN DIFFERENT SPORTS, SO THESE GROUPS ARE READ FIRST.
 * `INDIVIDUAL_SAVES` is a baseball save in an MLB league and a goalie save in an NHL one, and
 * `INDIVIDUAL_ASSISTS` / `INDIVIDUAL_BLOCKS` exist in basketball and hockey alike. Each scoring
 * group says which sport (and side of the ball) its codes belong to. Keys are each sport's own
 * vocabulary: Sleeper's for football (what `importedNflScoring` reads), the native engine's for
 * basketball and hockey. Codes and groups are from real public leagues captured 2026-10-26 —
 * tests/fixtures/fantrax/{nba,nhl,nfl}-public-2026.json.
 */
const GROUP_CATEGORY_KEYS: Record<string, Record<string, string[]>> = {
  BASKETBALL_PLAYER: {
    INDIVIDUAL_POINTS: ['pts'],
    INDIVIDUAL_REBOUNDS: ['reb'],
    INDIVIDUAL_ASSISTS: ['ast'],
    INDIVIDUAL_STEALS: ['stl'],
    INDIVIDUAL_BLOCKS: ['blk'],
    INDIVIDUAL_TURNOVERS: ['to'],
  },
  HOCKEY_SKATING: {
    INDIVIDUAL_GOALS: ['g'],
    INDIVIDUAL_ASSISTS: ['a'],
    INDIVIDUAL_SHOTS_ON_GOAL: ['sog'],
    INDIVIDUAL_POWER_PLAY_POINTS: ['ppp'],
    INDIVIDUAL_SHORT_HANDED_GOALS: ['shg'],
    INDIVIDUAL_HITS: ['hits'],
    INDIVIDUAL_BLOCKS: ['blks'],
    INDIVIDUAL_PENALTY_MINUTES: ['pim'],
  },
  HOCKEY_GOALIE: {
    INDIVIDUAL_GOALIE_WINS: ['g_win'],
    INDIVIDUAL_SAVES: ['g_sv'],
    INDIVIDUAL_GOALS_AGAINST: ['g_ga'],
    INDIVIDUAL_SHUTOUTS: ['g_so'],
    /* A goalie's assists and penalty minutes are the skater stats; the engine keeps one rule each. */
    INDIVIDUAL_ASSISTS: ['a'],
    INDIVIDUAL_PENALTY_MINUTES: ['pim'],
  },
  FOOTBALL_OFFENSE: {
    INDIVIDUAL_FUMBLES_LOST: ['fum_lost'],
    INDIVIDUAL_INTERCEPTIONS_THROWN: ['pass_int'],
  },
  FOOTBALL_KICKING: {
    INDIVIDUAL_EXTRA_POINTS_MADE: ['xpm'],
    INDIVIDUAL_FIELD_GOALS_MADE: ['fgm'],
  },
  /* The defence group scores individual defenders (the captured league starts DL / LB / DB). */
  FOOTBALL_DEFENSE: {
    INDIVIDUAL_TACKLES: ['idp_tkl'],
    INDIVIDUAL_TACKLES_FOR_LOSS: ['idp_tkl_loss'],
    INDIVIDUAL_SACKS_DEFENSIVE: ['idp_sack'],
    INDIVIDUAL_QB_HITS: ['idp_qb_hit'],
    INDIVIDUAL_PASSES_DEFENSED: ['idp_pass_def'],
    INDIVIDUAL_INTERCEPTIONS_CAUGHT: ['idp_int'],
    INDIVIDUAL_FUMBLES_FORCED: ['idp_ff'],
    INDIVIDUAL_FUMBLES_RECOVERED: ['idp_fum_rec'],
    INDIVIDUAL_BLOCKED_KICKS: ['idp_blk_kick'],
    INDIVIDUAL_INTERCEPTIONS_CAUGHT_TOUCHDOWNS: ['idp_def_td'],
    INDIVIDUAL_FUMBLES_RECOVERED_TOUCHDOWNS: ['idp_def_td'],
  },
}

/** Groups whose codes must never fall back to the baseball/football table above. */
const NO_FALLBACK_GROUP = /^(BASKETBALL|HOCKEY|SOCCER)_/

/** Position-specific reception values map to a bonus, keyed by position code. */
const RECEPTION_BONUS_BY_POSITION: Record<string, string> = {
  TE: 'bonus_rec_te',
}

type Config = {
  /** The scoring group's code (`BASKETBALL_PLAYER`, `HOCKEY_GOALIE`, …), copied onto each config. */
  group?: string
  points?: unknown
  position?: { shortName?: string; code?: string } | null
  scoringCategory?: { code?: string; name?: string; shortName?: string } | null
}

function readConfigs(info: FantraxLeagueInfo): Config[] {
  const system = info.scoringSystem as
    | { scoringCategorySettings?: Array<{ configs?: Config[]; group?: { code?: string } | null }> }
    | null
    | undefined
  return system?.scoringCategorySettings?.flatMap((s) => (s.configs ?? []).map((c) => ({ ...c, group: s.group?.code }))) ?? []
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
  const systemType = (info.scoringSystem as { type?: string } | undefined)?.type
  if (systemType && !systemType.includes('POINTS_BASED')) {
    return { rules: [], gaps: [`${systemType} is a category scoring format; native points scoring cannot reproduce it`] }
  }

  const defaultReception = configs.find(
    (c) =>
      c.scoringCategory?.code === 'INDIVIDUAL_RECEPTIONS' &&
      isDefaultPosition(c.position?.shortName ?? c.position?.code),
  )
  const defaultReceptionPoints = Number(defaultReception?.points)

  for (const config of configs) {
    const code = config.scoringCategory?.code
    const points = Number(config.points)
    if (!code) continue
    if (config.points == null || !Number.isFinite(points)) {
      gaps.push(`${config.scoringCategory?.name ?? code} has no verified points weight`)
      continue
    }

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

    const group = config.group ?? ''
    const keys =
      GROUP_CATEGORY_KEYS[group]?.[code] ?? (NO_FALLBACK_GROUP.test(group) ? undefined : CATEGORY_KEYS[code])
    if (!keys) {
      gaps.push(`${config.scoringCategory?.name ?? code} has no equivalent here, so it is not scored`)
      continue
    }
    for (const key of keys) {
      /* Two source categories feeding one rule (a goalie's and a skater's penalty minutes) keep
         the first value; a disagreement is reported rather than silently averaged. */
      const existing = rules.find((r) => r.stat_key === key)
      if (existing) {
        if (existing.points_value !== round(points)) {
          gaps.push(`${config.scoringCategory?.name ?? code} is worth ${round(points)} here but shares one rule worth ${existing.points_value}`)
        }
        continue
      }
      rules.push({ stat_key: key, points_value: round(points) })
    }
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
