import { readExtraMatchupRecord } from '@/lib/redraft/oddTeamExtraMatchupRules'

/**
 * League-median game: each week, every team also plays the week's median score.
 *
 * 🛑 THE SETTING EXISTED AND NOTHING COMPUTED IT. `League.medianGame` was offered in commissioner
 * settings and copied onto the season at draft, `scheduleEngine` generated median slots, and
 * `finalizeDraftToRedraftSeason` then filtered them out; standings skipped every row without an
 * opponent and nothing wrote `medianScore`. A league that turned it on played ordinary H2H.
 *
 * A week counts only once every head-to-head game in it is complete — the same rule standings use
 * for the games themselves — so a median is never taken over a half-scored week.
 */

export type MedianMatchupRow = {
  week: number
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number | null
  awayScore: number | null
  status: string | null
  lineupSnapshots?: unknown
  /** `RedraftMatchup.type`; a playoff, consolation or toilet-bowl type marks a playoff-phase game. */
  type?: string | null
  isMedianMatchup?: boolean | null
}

export type MedianOutcome = 'W' | 'L' | 'T'

export type WeeklyMedianResult = {
  week: number
  median: number
  outcomes: Map<string, MedianOutcome>
}

export function isMatchupComplete(row: Pick<MedianMatchupRow, 'status' | 'lineupSnapshots'>): boolean {
  // isComplete means every starter has a stat row, including live rows. Only
  // the period finalizer can certify the slate and its correction window.
  return row.status === 'final' || row.status === 'completed'
}

/**
 * `League.settings` key: does the league median keep playing in playoff weeks?
 *
 * ⚠ OFF UNLESS THE COMMISSIONER TURNS IT ON. The playoffs are win or go home, so a second result
 * against the median means nothing there. Only a stored `true` counts as on; a missing key, a stale
 * settings blob or any other value is off.
 */
export const MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY = 'median_game_in_playoffs'

export function readMedianGameInPlayoffs(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as Record<string, unknown>)[MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY] === true
}

const PLAYOFF_PHASE_TYPE = /playoff|consolation|toilet|championship|third_place/i

/**
 * Is `week` a playoff-phase week by number: on or after the playoff start? A season without a usable
 * playoff start week has no playoff phase by week number (rows can still mark one by their type).
 */
export function isPlayoffPhaseWeek(week: number, playoffStartWeek: number | null | undefined): boolean {
  const start = Number(playoffStartWeek)
  return Number.isInteger(start) && start >= 1 && week >= start
}

/**
 * The rows a median may be taken over. With the league median off in the playoffs (the default),
 * every playoff-phase week is dropped whole — every team in it, in the bracket or not — so no median
 * result is produced, counted or stored for it. Regular-season weeks are untouched.
 */
export function medianEligibleRows<T extends Pick<MedianMatchupRow, 'week' | 'type'>>(
  rows: readonly T[],
  opts: { playoffStartWeek: number | null | undefined; medianInPlayoffs: boolean },
): T[] {
  if (opts.medianInPlayoffs) return [...rows]
  const playoffWeeks = new Set<number>()
  for (const row of rows) {
    if (PLAYOFF_PHASE_TYPE.test(String(row.type ?? '')) || isPlayoffPhaseWeek(row.week, opts.playoffStartWeek)) {
      playoffWeeks.add(row.week)
    }
  }
  return rows.filter((row) => !playoffWeeks.has(row.week))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Median results for every week whose head-to-head games are all complete.
 *
 * A team on a bye plays the median too when its bye row carries a completed score; if the bye
 * was never scored it sits that median out rather than being judged on a zero.
 */
export function computeWeeklyMedianResults(rows: readonly MedianMatchupRow[]): WeeklyMedianResult[] {
  const byWeek = new Map<number, MedianMatchupRow[]>()
  for (const row of rows) {
    const list = byWeek.get(row.week) ?? []
    list.push(row)
    byWeek.set(row.week, list)
  }

  const results: WeeklyMedianResult[] = []
  for (const [week, weekRows] of [...byWeek.entries()].sort(([a], [b]) => a - b)) {
    const games = weekRows.filter((r) => r.awayRosterId)
    if (games.length === 0 || !games.every(isMatchupComplete)) continue

    const scores = new Map<string, number>()
    for (const g of games) {
      scores.set(g.homeRosterId, Number(g.homeScore ?? 0))
      scores.set(g.awayRosterId!, Number(g.awayScore ?? 0))
    }
    for (const bye of weekRows.filter((r) => !r.awayRosterId)) {
      if (isMatchupComplete(bye) && !scores.has(bye.homeRosterId)) {
        scores.set(bye.homeRosterId, Number(bye.homeScore ?? 0))
      }
    }
    if (scores.size < 2) continue

    const m = median([...scores.values()])
    const outcomes = new Map<string, MedianOutcome>()
    for (const [rosterId, score] of scores) {
      outcomes.set(rosterId, score > m ? 'W' : score < m ? 'L' : 'T')
    }
    results.push({ week, median: Math.round(m * 100) / 100, outcomes })
  }
  return results
}

export type ByeWeekMedianCredit = { week: number; rosterId: string; median: number }

/**
 * Points-for credit for a team on a bye: the week's median team score.
 *
 * In an odd-team league one team sits out each regular-season week (a row with no `awayRosterId`). It
 * used to score 0 points for that week, so every bye cost it a week of points for — the first
 * tiebreaker after record — through no result of its own. It is now credited the median of the scores
 * of the teams that played head-to-head that week. Points for only: a bye is no game, so no win, loss or
 * points against.
 *
 * Credited only once every head-to-head game of the week is complete (the median's own rule, so a credit
 * is never taken over a half-scored week), only in regular-season weeks (playoff-phase weeks are dropped
 * as `medianEligibleRows` drops them), and never for a bye row carrying an extra matchup
 * (lib/redraft/oddTeamExtraMatchupRules.ts): that team played a game, and its own score already counts.
 * The bye team's own score, when its row was scored for the league median, is not part of the median it
 * is credited — it played no one.
 */
export function byeWeekMedianCredits(
  rows: readonly MedianMatchupRow[],
  opts: { playoffStartWeek: number | null | undefined },
): ByeWeekMedianCredit[] {
  const eligible = medianEligibleRows(rows, { playoffStartWeek: opts.playoffStartWeek, medianInPlayoffs: false })
  const byWeek = new Map<number, MedianMatchupRow[]>()
  for (const row of eligible) {
    if (row.isMedianMatchup) continue
    const list = byWeek.get(row.week) ?? []
    list.push(row)
    byWeek.set(row.week, list)
  }
  const credits: ByeWeekMedianCredit[] = []
  for (const [week, weekRows] of [...byWeek.entries()].sort(([a], [b]) => a - b)) {
    const games = weekRows.filter((r) => r.awayRosterId)
    if (games.length === 0 || !games.every(isMatchupComplete)) continue
    const played = new Set<string>()
    const scores: number[] = []
    for (const g of games) {
      played.add(g.homeRosterId)
      played.add(g.awayRosterId!)
      scores.push(Number(g.homeScore ?? 0), Number(g.awayScore ?? 0))
    }
    const m = Math.round(median(scores) * 100) / 100
    for (const bye of weekRows) {
      if (bye.awayRosterId || played.has(bye.homeRosterId)) continue
      if (readExtraMatchupRecord(bye.lineupSnapshots)) continue
      if (credits.some((c) => c.week === week && c.rosterId === bye.homeRosterId)) continue
      credits.push({ week, rosterId: bye.homeRosterId, median: m })
    }
  }
  return credits
}
