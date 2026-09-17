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
   * Provider-stated keys first. `playoffSettings.playoffTeams` is written by the import normalizer
   * and falls back to a FORMAT default when the provider gave no count, so it ranks last.
   */
  const declared = firstNum(
    s.playoff_teams,
    s.playoff_team_count,
    ...blocks.map((b) => b.playoff_team_count),
    ...blocks.map((b) => b.playoffTeams),
  )

  const valid = declared != null && declared >= 2 && declared <= teamCount
  const playoffTeams = valid ? Math.floor(declared!) : Math.min(DEFAULT_PLAYOFF_TEAMS, Math.max(2, teamCount))
  const playoffTeamsSource: FormatSource = valid ? 'league' : 'default'

  /*
   * Byes. An explicit count wins; an explicit "no byes" wins; otherwise the standard bracket gap.
   * Sleeper states nothing and runs the standard bracket (six teams → the top two sit out), which is
   * why the fallback is `standardByes` rather than zero.
   */
  const explicitByes = firstNum(...blocks.map((b) => b.first_round_byes), ...blocks.map((b) => b.firstRoundByes), s.first_round_byes)
  const topSeedByes = blocks.map((b) => b.topSeedByes).find((v) => typeof v === 'boolean') as boolean | undefined
  const byeRule = blocks.map((b) => b.bye_rules).find((v) => typeof v === 'string') as string | undefined

  let byeTeams: number
  let byeSource: FormatSource
  if (explicitByes != null && explicitByes >= 0 && explicitByes < playoffTeams) {
    byeTeams = Math.floor(explicitByes)
    byeSource = 'league'
  } else if (topSeedByes === false || byeRule === 'none' || byeRule === 'no_byes') {
    byeTeams = 0
    byeSource = 'league'
  } else {
    byeTeams = standardByes(playoffTeams)
    byeSource = 'standard'
  }

  const end = firstNum(...blocks.map((b) => b.regularSeasonEndWeek))
  const start = firstNum(
    ...blocks.map((b) => b.playoffStartWeek),
    ...blocks.map((b) => b.playoff_start_week),
    s.playoff_start_week,
    s.playoff_week_start,
  )
  const regularSeasonEndWeek = end != null && end > 0 ? end : start != null && start > 1 ? start - 1 : null

  return { playoffTeams, playoffTeamsSource, byeTeams, byeSource, regularSeasonEndWeek }
}
