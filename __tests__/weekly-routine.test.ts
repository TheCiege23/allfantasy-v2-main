// @vitest-environment node
/**
 * The weekly routine (retention item 7, user decisions 2026-09-14): today's step from the US
 * Eastern weekday, done states only from observed data, and a deterministic recap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  weekAll: vi.fn(),
  seasonAdds: vi.fn(),
  teamFind: vi.fn(),
  scoreFind: vi.fn(),
  playerFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    sportsPlayer: { findMany: h.playerFind },
  },
}))
vi.mock('@/lib/core-app/weekAll', () => ({ getWeekAll: h.weekAll }))
vi.mock('@/lib/core-app/decisionReceipts', async (orig) => ({
  ...(await orig<typeof import('@/lib/core-app/decisionReceipts')>()),
  loadSeasonAdds: h.seasonAdds,
}))

import { buildWeeklyRoutine, getRoutineFacts, routineDayFor } from '@/lib/core-app/weeklyRoutine'
import type { WeekAllData } from '@/lib/core-app/weekAll'

const ICE = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice', season: 2026 }
const DYN = { id: 'af-dyn', name: 'Dynasty', platform: 'sleeper', platformLeagueId: 'sl-dyn', season: 2026 }

const lastWeek: WeekAllData = {
  rows: [
    { leagueId: 'af-ice', leagueName: 'Ice Kings', platform: 'sleeper', season: 2026, week: 1, pointsFor: 120, pointsAgainst: 96.5, won: true },
    { leagueId: 'af-dyn', leagueName: 'Dynasty', platform: 'sleeper', season: 2026, week: 1, pointsFor: 101, pointsAgainst: 103.2, won: false },
  ],
  season: 2026,
  week: 1,
  withoutHistory: 0,
  unscored: 0,
  record: { wins: 1, losses: 1 },
}

const sched = (coin: number, lean: number, unproj: number) =>
  ({ coinFlips: Array(coin).fill({}), leaning: Array(lean).fill({}), unprojected: Array(unproj).fill({}) }) as never

const build = (over: Partial<Parameters<typeof buildWeeklyRoutine>[0]> = {}) =>
  buildWeeklyRoutine({
    now: new Date('2026-09-16T15:00:00Z'),
    lastWeek,
    topScorer: { name: 'Jahmyr Gibbs', points: 28.4, leagueName: 'Ice Kings' },
    addsThisWeek: 2,
    startersInDoubt: 0,
    schedule: sched(1, 2, 0),
    ...over,
  })

const step = (d: ReturnType<typeof build>, key: string) => d.steps.find((s) => s.key === key)!

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
})

describe('routineDayFor', () => {
  it('🛑 uses the US Eastern day, not UTC', () => {
    expect(routineDayFor(new Date('2026-09-13T17:00:00Z'))).toEqual({ key: 'gameday', label: 'Sunday' })
    // 02:00 UTC Tuesday is still Monday night in New York.
    expect(routineDayFor(new Date('2026-09-15T02:00:00Z'))).toEqual({ key: 'recap', label: 'Monday' })
    // 03:30 UTC Wednesday is still Tuesday night.
    expect(routineDayFor(new Date('2026-09-16T03:30:00Z'))).toEqual({ key: 'results', label: 'Tuesday' })
    expect(routineDayFor(new Date('2026-09-16T15:00:00Z'))).toEqual({ key: 'waivers', label: 'Wednesday' })
  })

  it('Thursday through Saturday are the lineup check', () => {
    expect(routineDayFor(new Date('2026-09-17T15:00:00Z')).key).toBe('lineups')
    expect(routineDayFor(new Date('2026-09-18T15:00:00Z')).key).toBe('lineups')
    expect(routineDayFor(new Date('2026-09-19T15:00:00Z'))).toEqual({ key: 'lineups', label: 'Saturday' })
  })
})

describe('buildWeeklyRoutine', () => {
  it('lists the five steps in routine order, with only today highlighted', () => {
    const d = build()
    expect(d.steps.map((s) => [s.key, s.day, s.href])).toEqual([
      ['results', 'Tue', '/core/week'],
      ['waivers', 'Wed', '/core/waivers'],
      ['lineups', 'Thu', '/core/my-team'],
      ['gameday', 'Sun', '/core/matchup'],
      ['recap', 'Mon', '/core/week'],
    ])
    expect(d.steps.filter((s) => s.today).map((s) => s.key)).toEqual(['waivers'])
    expect(d).toMatchObject({ today: 'waivers', todayLabel: 'Wednesday' })
  })

  it('🛑 results are done only when the last played week has scored results of yours', () => {
    expect(step(build(), 'results')).toMatchObject({ state: 'done', summary: '2026 week 1: 1-1 across 2 leagues' })
    expect(step(build({ lastWeek: null }), 'results')).toMatchObject({ state: 'unknown', summary: 'No scored results of yours on file yet.' })
    expect(step(build({ lastWeek: { ...lastWeek, rows: [] } }), 'results').state).toBe('unknown')
  })

  it('🛑 waivers: done on an observed add, open on none on file, unknown when unread — never a guess', () => {
    expect(step(build(), 'waivers')).toMatchObject({ state: 'done', summary: 'You made 2 adds this week.' })
    expect(step(build({ addsThisWeek: 1 }), 'waivers').summary).toBe('You made 1 add this week.')
    expect(step(build({ addsThisWeek: 0 }), 'waivers')).toMatchObject({ state: 'open', summary: 'No adds of yours on file this week.' })
    expect(step(build({ addsThisWeek: null }), 'waivers')).toMatchObject({ state: 'unknown', summary: null })
  })

  it('🛑 lineups: done only when no starter is in doubt; unread is unknown', () => {
    expect(step(build(), 'lineups')).toMatchObject({ state: 'done', summary: 'No starters of yours in doubt.' })
    expect(step(build({ startersInDoubt: 2 }), 'lineups')).toMatchObject({ state: 'open', summary: '2 starters may not play.' })
    expect(step(build({ startersInDoubt: 1 }), 'lineups').summary).toBe('1 starter may not play.')
    expect(step(build({ startersInDoubt: null }), 'lineups')).toMatchObject({ state: 'unknown', summary: null })
  })

  it('game day counts this week’s matchups and coin flips, and is never "done"', () => {
    expect(step(build(), 'gameday')).toMatchObject({ state: 'open', summary: '3 matchups this week · 1 coin flip.' })
    expect(step(build({ schedule: sched(0, 1, 0) }), 'gameday').summary).toBe('1 matchup this week.')
    // Unprojected games are still games on your schedule.
    expect(step(build({ schedule: sched(0, 0, 2) }), 'gameday')).toMatchObject({ state: 'open', summary: '2 matchups this week.' })
    expect(step(build({ schedule: sched(0, 0, 0) }), 'gameday')).toMatchObject({ state: 'unknown', summary: null })
    expect(step(build({ schedule: null }), 'gameday').state).toBe('unknown')
  })

  it('🛑 the recap is deterministic from real rows, and never marked done', () => {
    const d = build()
    expect(d.recap).toEqual({
      season: 2026,
      week: 1,
      wins: 1,
      losses: 1,
      biggestWin: { leagueName: 'Ice Kings', margin: 23.5 },
      closestLoss: { leagueName: 'Dynasty', margin: 2.2 },
      topScorer: { name: 'Jahmyr Gibbs', points: 28.4, leagueName: 'Ice Kings' },
    })
    expect(step(d, 'recap')).toMatchObject({ state: 'unknown', summary: '1-1 in week 1 · top scorer Jahmyr Gibbs 28.4' })
    expect(step(build({ topScorer: null }), 'recap').summary).toBe('1-1 in week 1')
    expect(build({ lastWeek: null }).recap).toBeNull()
  })

  it('the biggest win is the widest margin; the closest loss the narrowest', () => {
    const rows = [
      { ...lastWeek.rows[0], leagueName: 'A', pointsFor: 100, pointsAgainst: 90 },
      { ...lastWeek.rows[0], leagueName: 'B', pointsFor: 140, pointsAgainst: 90 },
      { ...lastWeek.rows[1], leagueName: 'C', pointsFor: 80, pointsAgainst: 120 },
      { ...lastWeek.rows[1], leagueName: 'D', pointsFor: 99, pointsAgainst: 100 },
    ]
    expect(build({ lastWeek: { ...lastWeek, rows } }).recap).toMatchObject({
      wins: 2,
      losses: 2,
      biggestWin: { leagueName: 'B', margin: 50 },
      closestLoss: { leagueName: 'D', margin: 1 },
    })
  })
})

describe('getRoutineFacts', () => {
  const adds = (weeks: number[]) => ({ mine: [ICE], siblingIds: new Map(), adds: weeks.map((week) => ({ week })) })

  it('🛑 reads the last PLAYED week, and counts only this week’s adds', async () => {
    h.weekAll.mockResolvedValue(lastWeek)
    h.seasonAdds.mockResolvedValue(adds([1, 2, 2, 3]))
    h.teamFind.mockResolvedValue([])
    const out = await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: 2 })
    expect(h.weekAll.mock.calls[0][2]).toEqual({ previous: true })
    expect(out.addsThisWeek).toBe(2)
    expect(out.lastWeek).toBe(lastWeek)
  })

  it('🛑 adds are unknown (null), never zero, when the week or the facts cannot be read', async () => {
    h.weekAll.mockResolvedValue(null)
    expect((await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: null })).addsThisWeek).toBeNull()
    expect(h.seasonAdds).not.toHaveBeenCalled()
    h.seasonAdds.mockResolvedValue(null)
    expect((await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: 2 })).addsThisWeek).toBeNull()
    h.seasonAdds.mockRejectedValue(new Error('db'))
    h.weekAll.mockRejectedValue(new Error('db'))
    expect(await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: 2 })).toEqual({ lastWeek: null, topScorer: null, addsThisWeek: null })
  })

  it('🛑 the top scorer is your highest-scoring STARTER that week, on YOUR roster, named', async () => {
    h.weekAll.mockResolvedValue(lastWeek)
    h.seasonAdds.mockResolvedValue(adds([]))
    h.teamFind.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4' }, { leagueId: 'af-dyn', externalId: '7' }])
    h.scoreFind.mockResolvedValue([{ leagueId: 'sl-ice', playerId: '9221', points: 28.44 }])
    h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null }])
    const out = await getRoutineFacts({ userId: 'u1', leagues: [ICE, DYN], currentWeek: 2 })
    expect(out.topScorer).toEqual({ name: 'Jahmyr Gibbs', points: 28.4, leagueName: 'Ice Kings' })
    expect(h.teamFind.mock.calls[0][0].where).toEqual({ leagueId: { in: ['af-ice', 'af-dyn'] }, claimedByUserId: 'u1' })
    expect(h.scoreFind.mock.calls[0][0]).toMatchObject({
      where: {
        OR: [
          { leagueId: 'sl-ice', seasonYear: 2026, week: 1, rosterId: 4, isStarter: true },
          { leagueId: 'sl-dyn', seasonYear: 2026, week: 1, rosterId: 7, isStarter: true },
        ],
      },
      orderBy: { points: 'desc' },
      take: 1,
    })
  })

  it('🛑 only leagues you PLAYED that week are read; a player row with a blank name is no name', async () => {
    h.weekAll.mockResolvedValue({ ...lastWeek, rows: [lastWeek.rows[0]] })
    h.seasonAdds.mockResolvedValue(adds([]))
    h.teamFind.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4' }])
    h.scoreFind.mockResolvedValue([{ leagueId: 'sl-ice', playerId: '9221', points: 28.44 }])
    h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: '  ', position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null }])
    const out = await getRoutineFacts({ userId: 'u1', leagues: [ICE, DYN], currentWeek: 2 })
    expect(h.teamFind.mock.calls[0][0].where.leagueId).toEqual({ in: ['af-ice'] })
    expect(out.topScorer).toBeNull()
  })

  it('an unnamed top starter is left out rather than replaced by a lower one', async () => {
    h.weekAll.mockResolvedValue(lastWeek)
    h.seasonAdds.mockResolvedValue(adds([]))
    h.teamFind.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4' }])
    h.scoreFind.mockResolvedValue([{ leagueId: 'sl-ice', playerId: '9221', points: 28.44 }])
    h.playerFind.mockResolvedValue([])
    expect((await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: 2 })).topScorer).toBeNull()
  })

  it('no top scorer without a played Sleeper league of yours, a claimed team, or a score row', async () => {
    h.seasonAdds.mockResolvedValue(adds([]))
    h.weekAll.mockResolvedValue(lastWeek)
    expect((await getRoutineFacts({ userId: 'u1', leagues: [{ ...ICE, platform: 'espn' }, { ...DYN, platform: 'espn' }], currentWeek: 2 })).topScorer).toBeNull()
    expect(h.teamFind).not.toHaveBeenCalled()
    h.teamFind.mockResolvedValue([])
    expect((await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: 2 })).topScorer).toBeNull()
    expect(h.scoreFind).not.toHaveBeenCalled()
    h.teamFind.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4' }])
    h.scoreFind.mockResolvedValue([])
    expect((await getRoutineFacts({ userId: 'u1', leagues: [ICE], currentWeek: 2 })).topScorer).toBeNull()
  })
})
