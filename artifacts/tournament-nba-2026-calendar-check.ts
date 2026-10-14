/** One-time 2026–27 pilot calendar review against the captured regular-season slate. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { assessSeasonCalendar, type CalendarGame } from '@/lib/tournament/seasonCalendarCoverage'

const capture = JSON.parse(readFileSync('artifacts/tournament-provider-samples/rolling-insights-schedule-2026-NBA.json', 'utf8')) as { rows: Array<Record<string, unknown>> }
const regular = capture.rows.filter(row => row.season_type === 'Regular Season')
const games: CalendarGame[] = regular.map(row => ({
  gameId: String(row.game_ID), startTime: new Date(String(row.game_time)).toISOString(), seasonType: 'regular',
  status: String(row.status ?? ''), replacedBy: null,
}))
const config = defaultSeasonBlueprint('NBA')
config.name = '2026–27 NBA Tournament Pilot'
config.rules = defaultSeasonRules('NBA', 'nba_points')
config.redraftBufferHours = 12
const hour = 3_600_000
const first = Date.parse('2026-10-20T08:00:00Z')
const boundaries = Array.from({ length: 26 }, (_, i) => first + i * 7 * 24 * hour)
boundaries.splice(18, 1) // Feb 16–Mar 2 spans the All-Star break as one scoring period.
config.rules.calendar = {
  timezone: 'America/New_York', seasonLabel: '2026–27 NBA regular season',
  sourceUrl: 'https://www.nba.com/news/2026-27-nba-regular-season-schedule', scheduleReviewed: true,
  regularSeasonStartsAt: '2026-10-20T15:00:00.000Z', regularSeasonEndsAt: new Date(boundaries.at(-1)!).toISOString(),
  periods: Array.from({ length: 24 }, (_, i) => {
    const number = i + 1, start = boundaries[i]! + (number === 11 || number === 21 ? 48 * hour : number >= 22 ? 24 * hour : 0)
    const end = boundaries[i + 1]!
    return { number, startsAt: new Date(number === 1 ? Date.parse('2026-10-20T15:00:00Z') : start).toISOString(), endsAt: new Date(end).toISOString(), finalizesAt: new Date(end + 24 * hour).toISOString() }
  }),
  drafts: [
    { stage: 1, startsAt: '2026-10-19T22:00:00.000Z', completeBy: '2026-10-20T03:00:00.000Z' },
    { stage: 2, startsAt: new Date(boundaries[10]! + 24 * hour).toISOString(), completeBy: new Date(boundaries[10]! + 36 * hour).toISOString() },
    { stage: 3, startsAt: new Date(boundaries[20]! + 24 * hour).toISOString(), completeBy: new Date(boundaries[20]! + 36 * hour).toISOString() },
  ],
}
const report = assessSeasonCalendar(config, games)
const output = { config, report, sourceRows: capture.rows.length, regularRows: regular.length, scheduleSha256: createHash('sha256').update(JSON.stringify(capture.rows)).digest('hex') }
writeFileSync('artifacts/tournament-provider-samples/nba-2026-pilot-calendar-review.json', JSON.stringify(output, null, 2), { flag: 'wx' })
process.stdout.write(JSON.stringify({ ready: report.ready, blockers: report.blockers.slice(0, 12), blockerCount: report.blockers.length, warnings: report.warnings, regularGames: report.regularGames, pendingGames: report.pendingGames, assigned: report.assignments.filter(row => row.period != null).length, excluded: report.excludedGames.length, periods: report.periods.map(row => row.games), stage1Draft: config.rules.calendar.drafts[0] }) + '\n')
