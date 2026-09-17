/**
 * Season Outlook — how big the playoff field is, how many seeds skip round one, and when the regular
 * season ends. Pure; no I/O.
 *
 * 🛑 THE READER THIS REPLACES READ A KEY NO IMPORT WRITES. `seasonOutlook.ts` looked for
 * `settings.playoff.playoffTeams`. Measured 2026-09-17 on the production copy (65-league account):
 * **zero** leagues carry a `settings.playoff` object. Sleeper rows carry `playoff_teams` and
 * `playoffSettings.playoffTeams`; native and manual rows carry `playoffSettings`, `playoff_settings`
 * and `playoff_structure`. So every league was simulated with the six-team default — including a
 * 16-team league whose field is eight — and the page printed "top 6 make it" beside it.
 *
 * ⚠ THE `League.playoffTeams` COLUMN IS NOT READ, ON PURPOSE. It defaults to 4 in the schema and no
 * importer sets it, so on an imported league it is a default that looks like a fact
 * (`career.ts` records the same trap). Same for `playoffStartWeek`, which defaults to 14.
 *
 * Every value here says where it came from, because the assumptions panel prints it.
 */

import { standardByes } from './outlookSim'

export type FormatSource = 'league' | 'standard' | 'default'

export type PlayoffFormat = {
  playoffTeams: number
  playoffTeamsSource: FormatSource
  byeTeams: number
  byeSource: FormatSource
  /** Last regular-season week, when the league states one. Games after it are playoff games. */
  regularSeasonEndWeek: number | null
}

/** Used when a league declares no playoff field at all. */
export const DEFAULT_PLAYOFF_TEAMS = 6

type Obj = Record<string, unknown>

function asObj(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : null
}

function firstNum(...values: unknown[]): number | null {
  for (const v of values) {
    const n = num(v)
    if (n != null) return n
  }
  return null
}

export function readPlayoffFormat(settings: unknown, teamCount: number): PlayoffFormat {
  const s = asObj(settings) ?? {}
  const blocks = [s.playoffSettings, s.playoff_settings, s.playoff_structure, s.playoff].map(asObj).filter(
    (b): b is Obj => b != null,
  )

  /*
   * ⚠ THE STANDINGS BOARD READS THROUGH THIS FUNCTION (`standingsModel.readStandingsRules`), so the
   * "top N make it" line and these odds can never name different fields for one league. Change the
   * order here and both screens move together:
   * `playoffSettings.playoffTeams`, then `playoff_teams`, then `playoff_team_count`.
   *
   * Measured on production 2026-09-17 before settling it: on 290 Sleeper leagues the block and the
   * flat keys never disagree. The only disagreements are two manual 8-team leagues holding flat
   * `playoff_team_count: 6` beside `playoffSettings.playoffTeams: 4` — and 4 is what the league's
   * own playoff runtime plays (it reads the column, which says 4 there). Block-first is right for
   * both; the flat 6 is the import default.
   */
  const declared = firstNum(
    asObj(s.playoffSettings)?.playoffTeams,
    s.playoff_teams,
    s.playoff_team_count,
    ...blocks.map((b) => b.playoff_team_count),
    ...blocks.map((b) => b.playoffTeams),
  )

  const valid = declared != null && declared >= 2 && declared <= teamCount
  const playoffTeams = valid ? Math.floor(declared!) : Math.min(DEFAULT_PLAYOFF_TEAMS, Math.max(2, teamCount))
  const playoffTeamsSource: FormatSource = valid ? 'league' : 'default'

  /*
   * Byes: the standard bracket gap (six teams → the top two sit out), which is what Sleeper runs
   * and what the standings board prints. A stated `first_round_byes` can only LOWER it — the same
   * rule the native playoff runtime applies (`canonicalNflRedraftPlayoffRuntime.resolveSettings`
   * takes min(configured, gap)), because a bracket cannot give more byes than its size leaves.
   * `topSeedByes` is not read: the runtime does not read it either, and a third interpretation is
   * how two screens come to disagree.
   */
  const gap = standardByes(playoffTeams)
  const explicitByes = firstNum(...blocks.map((b) => b.first_round_byes), ...blocks.map((b) => b.firstRoundByes), s.first_round_byes)

  let byeTeams = gap
  let byeSource: FormatSource = 'standard'
  if (explicitByes != null && explicitByes >= 0) {
    byeTeams = Math.min(Math.floor(explicitByes), gap)
    byeSource = 'league'
  }

  /*
   * A week of 0 is UNSET, not week zero — 43 Sleeper leagues store `playoff_start_week: 0` — so it is
   * skipped and the next key is tried, rather than stopping the search on it.
   */
  const positive = (...values: unknown[]) => firstNum(...values.map((v) => (num(v) ?? 0) > 0 ? v : null))
  const end = positive(...blocks.map((b) => b.regularSeasonEndWeek))
  const start = positive(
    ...blocks.map((b) => b.playoffStartWeek),
    ...blocks.map((b) => b.playoff_start_week),
    s.playoff_start_week,
    s.playoff_week_start,
  )
  /*
   * Last resort: `regular_season_length`, the ONLY regular-season statement ESPN, Fantrax and
   * Fleaflicker imports carry (production 2026-09-17: 6 ESPN leagues at 13/14/17, and one each on the
   * other two). Without it every paired week of theirs counted as regular season. The standings
   * board gets it through this function too.
   */
  const length = positive(s.regular_season_length)
  const regularSeasonEndWeek = end != null ? end : start != null && start > 1 ? start - 1 : length

  return { playoffTeams, playoffTeamsSource, byeTeams, byeSource, regularSeasonEndWeek }
}
