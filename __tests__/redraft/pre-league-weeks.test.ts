import { describe, expect, it } from 'vitest'
import {
  countedStandingsMatchups,
  PRE_LEAGUE_MATCHUP_TYPE,
  preLeagueWeekNumbers,
  readPreLeagueWeeksCount,
} from '@/lib/redraft/preLeagueWeeksRules'
import { computeWeeklyMedianResults, medianEligibleRows } from '@/lib/redraft/medianGame'
import { medianGameTimingRefusal } from '@/lib/redraft/medianGameSwitch'

const m = (week: number, type: string, home: string, away: string, homeScore: number, awayScore: number) => ({
  id: `${week}-${home}`,
  week,
  type,
  homeRosterId: home,
  awayRosterId: away,
  homeScore,
  awayScore,
  status: 'final',
  isMedianMatchup: false,
})

// Week 10 was played before the draft; week 11 is the league's first real week.
const schedule = [
  m(10, PRE_LEAGUE_MATCHUP_TYPE, 'A', 'B', 120, 80),
  m(10, PRE_LEAGUE_MATCHUP_TYPE, 'C', 'D', 100, 90),
  m(11, 'regular', 'A', 'C', 70, 110),
  m(11, 'regular', 'B', 'D', 95, 60),
]

describe('pre-league weeks', () => {
  it('the toggle is off unless stored exactly true', () => {
    expect(readPreLeagueWeeksCount(null)).toBe(false)
    expect(readPreLeagueWeeksCount({})).toBe(false)
    expect(readPreLeagueWeeksCount({ pre_league_weeks_count: 'true' })).toBe(false)
    expect(readPreLeagueWeeksCount({ pre_league_weeks_count: true })).toBe(true)
  })

  it('off: standings see only the league’s own weeks', () => {
    const counted = countedStandingsMatchups(schedule, false)
    expect(counted.map((r) => r.week)).toEqual([11, 11])
  })

  it('on: pre-league weeks count, read as regular weeks', () => {
    const counted = countedStandingsMatchups(schedule, true)
    expect(counted).toHaveLength(4)
    expect(counted.every((r) => r.type === 'regular')).toBe(true)
  })

  it('on: the league median plays in pre-league weeks too; off: it does not', () => {
    const weeksWithMedian = (count: boolean) =>
      computeWeeklyMedianResults(medianEligibleRows(countedStandingsMatchups(schedule, count), { playoffStartWeek: 15, medianInPlayoffs: false })).map(
        (w) => w.week,
      )
    expect(weeksWithMedian(true)).toEqual([10, 11])
    expect(weeksWithMedian(false)).toEqual([11])
  })

  it('weeks before the first league week, none for a week-1 start', () => {
    expect(preLeagueWeekNumbers(11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(preLeagueWeekNumbers(1)).toEqual([])
  })

  it('[control] a final real week still locks the median switch — the query, not this rule, drops pre-league rows', () => {
    const real = schedule.filter((r) => r.type === 'regular')
    expect(medianGameTimingRefusal([{ season: 2026, status: 'active', schedule: real }])).not.toBeNull()
    const upcoming = real.map((r) => ({ ...r, status: 'scheduled' }))
    expect(medianGameTimingRefusal([{ season: 2026, status: 'active', schedule: upcoming }])).toBeNull()
  })
})
