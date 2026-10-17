/** Opt-in, read-only check of the unapproved pilot proposal against a fresh RI schedule. */
import { describe, expect, it } from 'vitest'
import { verifySeasonCalendar } from '@/lib/tournament/seasonCalendarVerification'
import { nba2026PilotProposal } from '@/artifacts/tournament-nba-2026-pilot-proposal'

const live = process.env.TOURNAMENT_PILOT_CALENDAR_LIVE === '1' ? describe : describe.skip

live('2026–27 NBA pilot calendar', () => {
  it('matches the current provider slate and reports every excluded day', async () => {
    const report = await verifySeasonCalendar(nba2026PilotProposal())
    const excludedByDay = Object.entries(report.excludedGames.reduce<Record<string, number>>((counts, game) => {
      const day = game.startsAt.slice(0, 10)
      counts[day] = (counts[day] ?? 0) + 1
      return counts
    }, {})).sort(([a], [b]) => a.localeCompare(b))
    process.stdout.write(JSON.stringify({
      checkedAt: report.checkedAt, digest: report.digest, ready: report.ready,
      blockers: report.blockers, warnings: report.warnings, regularGames: report.regularGames,
      pendingGames: report.pendingGames, assignedGames: report.assignments.filter(a => a.period !== null).length,
      excludedGames: report.excludedGames.length, excludedByDay, periods: report.periods,
    }) + '\n')
    expect(report.ready).toBe(true)
    expect(report.regularGames).toBeGreaterThanOrEqual(1200)
    expect(report.pendingGames).toBeLessThanOrEqual(30)
  }, 45_000)
})
