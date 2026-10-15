/** One-time 2026–27 pilot calendar review against the captured regular-season slate. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { assessSeasonCalendar, type CalendarGame } from '@/lib/tournament/seasonCalendarCoverage'
import { nba2026PilotProposal } from './tournament-nba-2026-pilot-proposal'

const capture = JSON.parse(readFileSync('artifacts/tournament-provider-samples/rolling-insights-schedule-2026-NBA.json', 'utf8')) as { rows: Array<Record<string, unknown>> }
const regular = capture.rows.filter(row => row.season_type === 'Regular Season')
const games: CalendarGame[] = regular.map(row => ({
  gameId: String(row.game_ID), startTime: new Date(String(row.game_time)).toISOString(), seasonType: 'regular',
  status: String(row.status ?? ''), replacedBy: null,
}))
const config = nba2026PilotProposal()
const report = assessSeasonCalendar(config, games)
const output = { config, report, sourceRows: capture.rows.length, regularRows: regular.length, scheduleSha256: createHash('sha256').update(JSON.stringify(capture.rows)).digest('hex') }
writeFileSync('artifacts/tournament-provider-samples/nba-2026-pilot-calendar-review.json', JSON.stringify(output, null, 2), { flag: 'wx' })
process.stdout.write(JSON.stringify({ ready: report.ready, blockers: report.blockers.slice(0, 12), blockerCount: report.blockers.length, warnings: report.warnings, regularGames: report.regularGames, pendingGames: report.pendingGames, assigned: report.assignments.filter(row => row.period != null).length, excluded: report.excludedGames.length, periods: report.periods.map(row => row.games), stage1Draft: config.rules.calendar.drafts[0] }) + '\n')
