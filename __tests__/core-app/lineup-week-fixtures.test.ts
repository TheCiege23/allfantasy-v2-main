import { describe, expect, it } from 'vitest'
import { indexFixturesByWeek, weekVerdict } from '@/lib/core-app/lineupWeekFixtures'

const at = (iso: string) => new Date(iso)
const g = (home: string, away: string, iso: string, week: number | null) => ({ homeTeam: home, awayTeam: away, startTime: at(iso), week })

describe('weekVerdict', () => {
  const index = indexFixturesByWeek([
    g('Chicago Bears', 'Philadelphia Eagles', '2026-09-29T00:15:00Z', 3),
    g('Chicago Bears', 'Philadelphia Eagles', '2026-09-29T00:15:00Z', null), // the unlabelled twin
    g('Washington Commanders', 'Dallas Cowboys', '2026-10-04T17:00:00Z', 4),
  ])

  it('plays: the club has a game left in the lineup week', () => {
    expect(weekVerdict(index, 'philadelphia eagles', 3)).toEqual({ verdict: 'plays', kickoff: at('2026-09-29T00:15:00Z') })
  })

  it('done: the club has no game left in the lineup week (played, or bye)', () => {
    expect(weekVerdict(index, 'washington commanders', 3)).toEqual({ verdict: 'done' })
  })

  /*
   * The whole week is behind the schedule (Tuesday, Sleeper still on the old week). The lineup
   * carries into the next week, so the verdict is that week's — measured 2026-09-29 on the App
   * Review account: an IR starter with a kickoff in 5 days was missing from Top decisions while
   * My Team and the triage rail both flagged him.
   */
  const tuesday = indexFixturesByWeek([
    g('Washington Commanders', 'Dallas Cowboys', '2026-10-04T17:00:00Z', 4),
    g('Miami Dolphins', 'New York Jets', '2026-10-04T20:05:00Z', 4),
    g('Miami Dolphins', 'Buffalo Bills', '2026-10-11T17:00:00Z', 5),
  ])

  it('plays: once the lineup week is over, a club with a game next week is still live, at that kickoff', () => {
    expect(weekVerdict(tuesday, 'miami dolphins', 3)).toEqual({ verdict: 'plays', kickoff: at('2026-10-04T20:05:00Z') })
  })

  it('done: once the lineup week is over, a club on bye NEXT week has nothing to fix', () => {
    expect(weekVerdict(tuesday, 'philadelphia eagles', 3)).toEqual({ verdict: 'done' })
  })

  it('unknown: a numbering mismatch (postseason week 1 vs Sleeper week 19) never erases alerts', () => {
    const playoffs = indexFixturesByWeek([g('Chicago Bears', 'Philadelphia Eagles', '2027-01-10T18:00:00Z', 1)])
    expect(weekVerdict(playoffs, 'philadelphia eagles', 19)).toEqual({ verdict: 'unknown' })
  })

  it('unknown: no week on the lineup, no club, or no labelled fixtures at all', () => {
    expect(weekVerdict(index, 'philadelphia eagles', null)).toEqual({ verdict: 'unknown' })
    expect(weekVerdict(index, null, 3)).toEqual({ verdict: 'unknown' })
    const unlabelled = indexFixturesByWeek([g('Chicago Bears', 'Philadelphia Eagles', '2026-09-29T00:15:00Z', null)])
    expect(weekVerdict(unlabelled, 'philadelphia eagles', 3)).toEqual({ verdict: 'unknown' })
  })
})
