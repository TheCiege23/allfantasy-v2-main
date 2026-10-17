/** Commissioner-approved 2026–27 NBA pilot dates. Publication still requires a fresh provider check. */
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'

export function nba2026PilotProposal() {
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
    sourceUrl: 'https://pr.nba.com/2026-27-nba-regular-season-schedule/', scheduleReviewed: true,
    regularSeasonStartsAt: '2026-10-20T15:00:00.000Z', regularSeasonEndsAt: new Date(boundaries.at(-1)!).toISOString(),
    periods: Array.from({ length: 24 }, (_, i) => {
      const number = i + 1, start = number === 11 ? Date.parse('2026-12-31T15:00:00Z') : number === 21 ? Date.parse('2027-03-18T14:00:00Z') : boundaries[i]! + (number >= 22 ? 24 * hour : 0)
      const end = boundaries[i + 1]!
      return { number, startsAt: new Date(number === 1 ? Date.parse('2026-10-20T15:00:00Z') : start).toISOString(), endsAt: new Date(end).toISOString(), finalizesAt: new Date(end + 24 * hour).toISOString() }
    }),
    drafts: [
      { stage: 1, startsAt: '2026-10-19T22:00:00.000Z', completeBy: '2026-10-20T03:00:00.000Z' },
      { stage: 2, startsAt: '2026-12-30T23:00:00.000Z', completeBy: '2026-12-31T03:00:00.000Z' },
      { stage: 3, startsAt: '2027-03-17T22:00:00.000Z', completeBy: '2027-03-18T02:00:00.000Z' },
    ],
  }
  return config
}
