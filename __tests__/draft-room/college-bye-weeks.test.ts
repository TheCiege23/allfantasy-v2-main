/**
 * College football bye weeks (2026-11-20), from CFBD's stored schedule through the college-name
 * crosswalk. Shapes taken from the real 2026 schedule: week 14 holds no stored games, week 15 is
 * Army–Navy only, Navy has two byes, and "Illinois" / "Illinois College" share a loose key.
 */
import { describe, expect, it } from 'vitest'
import {
  attachCollegeByeWeeks,
  buildCollegeByeIndex,
  collegeByeWeekFor,
  collegeByeWeeksFor,
  type CollegeScheduleRow,
} from '@/lib/draft-room/collegeByeWeeks'

const kickoff = (week: number) => new Date(Date.UTC(2026, 8, 5 + (week - 1) * 7, 20)).toISOString()
const game = (week: number, home: string, away: string): CollegeScheduleRow => ({ week, homeTeam: home, awayTeam: away, startTime: kickoff(week) })

// Every week 1-13 has games; nothing in 14; Army-Navy alone in 15.
const schedule: CollegeScheduleRow[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13].map((w) => game(w, 'Georgia', `Opp G${w}`)), // bye 8
  ...[1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13].map((w) => game(w, 'Navy', `Opp N${w}`)), // byes 3, 11
  game(15, 'Army', 'Navy'),
  ...[1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((w) => game(w, 'Boise State', `Opp B${w}`)), // bye 7; season ends wk 12
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((w) => game(w, 'Illinois', `Opp I${w}`)),
  ...[1, 2, 3, 5, 6, 7, 8, 9, 10, 11].map((w) => game(w, 'Illinois College', `Opp IC${w}`)), // D-III, bye 4
  ...[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13].map((w) => game(w, 'Ole Miss', `Opp O${w}`)), // bye 9
]
const index = buildCollegeByeIndex(schedule)
const preseason = new Date('2026-08-01T00:00:00Z')

describe('college bye weeks', () => {
  it("finds each school's byes from formal roster names", () => {
    expect(collegeByeWeeksFor(index, 'University of Georgia')).toEqual([8])
    expect(collegeByeWeeksFor(index, 'United States Naval Academy')).toEqual([3, 11])
    expect(collegeByeWeeksFor(index, 'Boise State University')).toEqual([7])
    expect(collegeByeWeeksFor(index, 'University of Mississippi')).toEqual([9])
  })

  it('never calls an empty week a bye (week 14 has no stored games)', () => {
    // Navy's last game is week 15, so 14 sits inside its span — but nobody plays week 14.
    expect(collegeByeWeeksFor(index, 'Navy')).not.toContain(14)
  })

  it('does not count weeks after the season ends as byes', () => {
    expect(collegeByeWeeksFor(index, 'Boise State')).not.toContain(13)
  })

  it('keeps Illinois and Illinois College apart', () => {
    expect(collegeByeWeeksFor(index, 'University of Illinois')).toEqual([])
    expect(collegeByeWeeksFor(index, 'Illinois College')).toEqual([4])
  })

  it('shows the next bye still to come, else the first', () => {
    expect(collegeByeWeekFor(index, 'Navy', preseason)).toBe(3)
    expect(collegeByeWeekFor(index, 'Navy', new Date(Date.UTC(2026, 9, 1)))).toBe(11) // October: week 3 has passed
    expect(collegeByeWeekFor(index, 'Navy', new Date(Date.UTC(2026, 11, 20)))).toBe(3) // all passed: the first
  })

  it('leaves an unknown school blank rather than guessing', () => {
    expect(collegeByeWeekFor(index, 'Jacksonville University', preseason)).toBeNull()
    expect(collegeByeWeekFor(index, null, preseason)).toBeNull()
  })
})

describe('attachCollegeByeWeeks', () => {
  it('sets college rows, replaces an NFL-looked-up bye, and leaves pro rows alone', () => {
    const rows = [
      { name: 'College QB', poolType: 'college', school: 'University of Georgia', team: 'Georgia', byeWeek: null },
      // A school read as an NFL club ("Tennessee" -> Titans) carries a wrong bye: replaced.
      { name: 'Vol', poolType: 'college', team: 'Ole Miss', byeWeek: 10 },
      { name: 'Unknown school', poolType: 'college', team: 'Jacksonville University', byeWeek: 6 },
      { name: 'Pro', poolType: 'pro', team: 'KC', byeWeek: 10 },
    ]
    const out = attachCollegeByeWeeks(rows, index, (r) => r.poolType === 'college', preseason)
    expect(out.map((r) => r.byeWeek)).toEqual([8, 9, null, 10])
    expect(out[3]).toBe(rows[3])
  })
})
