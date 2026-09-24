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
}

export type MedianOutcome = 'W' | 'L' | 'T'

export type WeeklyMedianResult = {
  week: number
  median: number
  outcomes: Map<string, MedianOutcome>
}

export function isMatchupComplete(row: Pick<MedianMatchupRow, 'status' | 'lineupSnapshots'>): boolean {
  if (row.status === 'final' || row.status === 'completed') return true
  const snapshot = row.lineupSnapshots
  const scoring =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).redraftScoring
      : null
  return Boolean(scoring && typeof scoring === 'object' && (scoring as Record<string, unknown>).isComplete === true)
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
