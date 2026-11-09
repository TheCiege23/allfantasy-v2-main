/**
 * An unplayed Sleeper week carries no points into the import, so it can never become a 0–0 tie.
 *
 * Sleeper returns every scheduled week with `points: 0`, and the bootstrap derives W/L/T from points, so
 * each unplayed week was stored as a TIE for every team (62,988 rows across 578 Sleeper leagues on a
 * production copy, 2026-11-09). Same fix the ESPN adapter has, judged on the week's own data because
 * Sleeper sends no "undecided" flag.
 */
import { describe, expect, it } from 'vitest'
import { SleeperScheduleMapper } from '@/lib/league-import/adapters/sleeper/SleeperScheduleMapper'

const m = (roster_id: number, matchup_id: number, points: number) => ({ roster_id, matchup_id, points })

const map = (weeks: { week: number; matchups: ReturnType<typeof m>[] }[]) =>
  SleeperScheduleMapper.map({ league: { season: '2026' }, matchupsByWeek: weeks } as never)

describe('Sleeper schedule: unplayed weeks', () => {
  it('a week where nobody has a point keeps its pairings and carries no points', () => {
    const [week] = map([{ week: 12, matchups: [m(1, 1, 0), m(2, 1, 0), m(3, 2, 0), m(4, 2, 0)] }])
    expect(week.matchups).toEqual([
      { roster_id_1: '1', roster_id_2: '2' },
      { roster_id_1: '3', roster_id_2: '4' },
    ])
  })

  it('a played week keeps every score, including a genuine 0 on one side', () => {
    const [week] = map([{ week: 8, matchups: [m(1, 1, 121.4), m(2, 1, 0), m(3, 2, 98), m(4, 2, 102.2)] }])
    expect(week.matchups).toEqual([
      { roster_id_1: '1', roster_id_2: '2', points_1: 121.4, points_2: 0 },
      { roster_id_1: '3', roster_id_2: '4', points_1: 98, points_2: 102.2 },
    ])
  })

  it('judges each week on its own data', () => {
    const weeks = map([
      { week: 9, matchups: [m(1, 1, 88.1), m(2, 1, 71)] },
      { week: 10, matchups: [m(1, 1, 0), m(2, 1, 0)] },
    ])
    expect(weeks.map((w) => 'points_1' in w.matchups[0]!)).toEqual([true, false])
  })
})
