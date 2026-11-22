import type { FantraxLeagueInfo, FantraxScheduleRow, FantraxSeasonPosition } from './fantraxApi'

export const FANTRAX_RESULTS_REPORT_KEY = 'fantraxResultsReport'

type ResultCounts = { matchups: number; playoffMatchups: number; scoreTies: number }
export type FantraxResultPeriod = ResultCounts & { period: number; endsOn: string }
export type FantraxResultsReport = {
  season: number
  refreshedAt: string
  phase: FantraxSeasonPosition['state']
  periods: FantraxResultPeriod[]
}

const dateInEastern = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function easternDate(value: Date): string {
  const parts = new Map(dateInEastern.formatToParts(value).map((part) => [part.type, part.value]))
  return [parts.get('year'), parts.get('month'), parts.get('day')].join('-')
}

/** Called by the collector after a successful read, using the same rows it writes to the league. */
export function buildFantraxResultsReport(input: {
  season: number
  now: Date
  info: Pick<FantraxLeagueInfo, 'scoringPeriods'>
  position: FantraxSeasonPosition | null
  publishedRows: readonly FantraxScheduleRow[]
}): FantraxResultsReport | null {
  const { season, now, info, position, publishedRows } = input
  if (!position || !info.scoringPeriods?.length) return null
  const ended = new Map<number, string>()
  for (const period of info.scoringPeriods) {
    if (!period.endDate) continue
    const end = new Date(period.endDate)
    if (end.getTime() < now.getTime()) ended.set(period.number, easternDate(end))
  }

  const counts = new Map<number, FantraxResultPeriod>()
  for (const row of publishedRows) {
    const endsOn = ended.get(row.week)
    if (!endsOn || !row.played || !Number.isFinite(row.awayScore) || !Number.isFinite(row.homeScore)) continue
    const period = counts.get(row.week) ?? { period: row.week, endsOn, matchups: 0, playoffMatchups: 0, scoreTies: 0 }
    period.matchups++
    if (row.isPlayoff) period.playoffMatchups++
    if (row.awayScore === row.homeScore) period.scoreTies++
    counts.set(row.week, period)
  }

  return { season, refreshedAt: now.toISOString(), phase: position.state, periods: [...counts.values()].sort((a, b) => a.period - b.period) }
}

export function readFantraxResultsReport(settings: unknown, season: number | null): FantraxResultsReport | null {
  if (!settings || typeof settings !== 'object') return null
  const report = (settings as Record<string, unknown>)[FANTRAX_RESULTS_REPORT_KEY] as Partial<FantraxResultsReport> | undefined
  if (
    !report || typeof report.season !== 'number' || report.season !== season || typeof report.refreshedAt !== 'string' ||
    !Number.isFinite(Date.parse(report.refreshedAt)) ||
    (report.phase !== 'preseason' && report.phase !== 'in_progress' && report.phase !== 'complete') ||
    !Array.isArray(report.periods)
  ) return null

  const valid = report.periods.every((p) =>
    p && Number.isInteger(p.period) && p.period > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.endsOn) &&
    Number.isInteger(p.matchups) && p.matchups > 0 &&
    Number.isInteger(p.playoffMatchups) && p.playoffMatchups >= 0 && p.playoffMatchups <= p.matchups &&
    Number.isInteger(p.scoreTies) && p.scoreTies >= 0 && p.scoreTies <= p.matchups,
  )
  return valid ? { season: report.season, refreshedAt: report.refreshedAt, phase: report.phase, periods: report.periods } : null
}

export function fantraxMonthResults(periods: readonly FantraxResultPeriod[]): Array<ResultCounts & { month: string }> {
  const months = new Map<string, ResultCounts & { month: string }>()
  for (const period of periods) {
    const month = period.endsOn.slice(0, 7)
    const row = months.get(month) ?? { month, matchups: 0, playoffMatchups: 0, scoreTies: 0 }
    row.matchups += period.matchups
    row.playoffMatchups += period.playoffMatchups
    row.scoreTies += period.scoreTies
    months.set(month, row)
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month))
}
