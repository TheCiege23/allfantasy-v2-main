/**
 * @vitest-environment node
 *
 * The league sync keeps the season being played current in `dw_matchup_facts`.
 *
 * Production 2026-11-20 (NFL week 11): 519 of 547 in-season Sleeper leagues had no stored score
 * past weeks 6 to 10, because the only writer was a rotation that had jammed, while the league sync
 * held every played week and wrote it to `team_performances` only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    matchupFact: {
      findMany: db.findMany,
      deleteMany: (a: unknown) => ({ op: 'delete', args: a, run: () => db.deleteMany(a) }),
      createMany: (a: unknown) => ({ op: 'create', args: a, run: () => db.createMany(a) }),
    },
    $transaction: (ops: Array<{ run: () => unknown }>) => {
      db.transaction(ops)
      return Promise.all(ops.map((o) => o.run()))
    },
  },
}))

import {
  matchupFactsFromSchedule,
  weeksNeedingRewrite,
  writeCurrentSeasonMatchupFacts,
  type CurrentSeasonMatchupFact,
} from '@/lib/league-import/sleeper/currentSeasonMatchupFacts'
import { SleeperScheduleMapper } from '@/lib/league-import/adapters/sleeper/SleeperScheduleMapper'

const m = (roster_id: number, matchup_id: number | null, points: number) => ({ roster_id, matchup_id, points })
const scheduleOf = (weeks: { week: number; matchups: ReturnType<typeof m>[] }[]) =>
  SleeperScheduleMapper.map({ league: { season: '2026' }, matchupsByWeek: weeks } as never)

const fact = (weekOrPeriod: number, teamA: string, teamB: string, scoreA: number, scoreB: number): CurrentSeasonMatchupFact => ({
  weekOrPeriod, teamA, teamB, scoreA, scoreB,
  winnerTeamId: scoreA > scoreB ? teamA : scoreB > scoreA ? teamB : null,
})

const write = (schedule: ReturnType<typeof scheduleOf>, season: number | null = 2026) =>
  writeCurrentSeasonMatchupFacts({ leagueId: 'L1', sport: 'nfl', season, schedule })
const deletedWeeks = () => db.deleteMany.mock.calls.flatMap((c) => (c[0] as { where: { weekOrPeriod: { in: number[] } } }).where.weekOrPeriod.in)
const created = () => db.createMany.mock.calls.flatMap((c) => (c[0] as { data: Array<Record<string, unknown>> }).data)

beforeEach(() => {
  delete process.env.AF_LIVE_MATCHUP_FACTS_OFF
  db.findMany.mockReset().mockResolvedValue([])
  db.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  db.createMany.mockReset().mockResolvedValue({ count: 0 })
  db.transaction.mockReset()
})

describe('matchupFactsFromSchedule', () => {
  it('stores the lower roster id as teamA whatever order the provider sent, with the scores on the right sides', () => {
    const rows = matchupFactsFromSchedule(scheduleOf([{ week: 7, matchups: [m(9, 1, 120.5), m(2, 1, 98.1)] }]))
    expect(rows).toEqual([{ weekOrPeriod: 7, teamA: '2', teamB: '9', scoreA: 98.1, scoreB: 120.5, winnerTeamId: '9' }])
  })

  it('an unplayed week is 0-0 with no winner, as the history sync stores it', () => {
    const rows = matchupFactsFromSchedule(scheduleOf([{ week: 12, matchups: [m(1, 1, 0), m(2, 1, 0)] }]))
    expect(rows).toEqual([{ weekOrPeriod: 12, teamA: '1', teamB: '2', scoreA: 0, scoreB: 0, winnerTeamId: null }])
  })

  it('rosters with no matchup that week (playoff byes) are never paired with each other', () => {
    const schedule = scheduleOf([{ week: 15, matchups: [m(1, 1, 130), m(2, 1, 110), m(3, null, 95), m(4, null, 88), m(5, null, 70)] }])
    expect(matchupFactsFromSchedule(schedule)).toEqual([fact(15, '1', '2', 130, 110)])
    // The bye teams still carry their own points for `team_performances`, with no opponent.
    expect(schedule[0]!.matchups.slice(1)).toEqual([
      { roster_id_1: '3', roster_id_2: '', points_1: 95, points_2: undefined },
      { roster_id_1: '4', roster_id_2: '', points_1: 88, points_2: undefined },
      { roster_id_1: '5', roster_id_2: '', points_1: 70, points_2: undefined },
    ])
  })
})

describe('weeksNeedingRewrite', () => {
  const incoming = [fact(6, '1', '2', 100, 90), fact(7, '1', '2', 80, 85)]
  it('nothing when stored equals incoming', () => {
    expect(weeksNeedingRewrite(incoming, [...incoming].reverse())).toEqual([])
  })
  it('the week whose score moved, a week not stored yet, and a week stored twice', () => {
    expect(weeksNeedingRewrite(incoming, [fact(6, '1', '2', 100, 90), fact(7, '1', '2', 0, 0)])).toEqual([7])
    expect(weeksNeedingRewrite(incoming, [fact(6, '1', '2', 100, 90)])).toEqual([7])
    expect(weeksNeedingRewrite(incoming, [...incoming, fact(6, '1', '2', 100, 90)])).toEqual([6])
  })
})

describe('writeCurrentSeasonMatchupFacts', () => {
  const played = scheduleOf([
    { week: 6, matchups: [m(1, 1, 100), m(2, 1, 90)] },
    { week: 7, matchups: [m(1, 1, 80), m(2, 1, 85)] },
    { week: 8, matchups: [m(1, 1, 0), m(2, 1, 0)] },
  ])

  it('fills a completed week stored as 0-0 and leaves the weeks that already match alone', async () => {
    // What production holds: week 6 scored, week 7 written up front as 0-0 and never updated.
    db.findMany.mockResolvedValue([fact(6, '1', '2', 100, 90), fact(7, '1', '2', 0, 0), fact(8, '1', '2', 0, 0)])

    const result = await write(played)

    expect(result).toMatchObject({ weeksSeen: 3, weeksWritten: 1, rowsWritten: 1 })
    expect(deletedWeeks()).toEqual([7])
    expect(created()).toEqual([
      { leagueId: 'L1', sport: 'NFL', season: 2026, weekOrPeriod: 7, teamA: '1', teamB: '2', scoreA: 80, scoreB: 85, winnerTeamId: '2' },
    ])
    // Delete and insert go together, so a reader never sees the week missing.
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(db.findMany.mock.calls[0]![0].where).toMatchObject({ leagueId: 'L1', season: 2026, weekOrPeriod: { in: [6, 7, 8] } })
  })

  it('writes nothing when the sync finds what is already stored', async () => {
    db.findMany.mockResolvedValue([fact(6, '1', '2', 100, 90), fact(7, '1', '2', 80, 85), fact(8, '1', '2', 0, 0)])
    expect(await write(played)).toMatchObject({ weeksWritten: 0, rowsWritten: 0 })
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('a week the provider did not answer for keeps what is stored', async () => {
    db.findMany.mockResolvedValue([])
    await write(scheduleOf([{ week: 6, matchups: [m(1, 1, 100), m(2, 1, 90)] }, { week: 7, matchups: [] }]))
    expect(deletedWeeks()).toEqual([6])
  })

  it('does nothing without a season, without pairings, or when switched off', async () => {
    expect((await write(played, null)).skipped).toBe('no season')
    expect((await write([])).skipped).toBe('no pairings in schedule')
    process.env.AF_LIVE_MATCHUP_FACTS_OFF = '1'
    expect((await write(played)).skipped).toBe('switched off')
    expect(db.findMany).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })
})
