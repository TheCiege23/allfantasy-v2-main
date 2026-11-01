/**
 * Exile reads a team's first game in the period from the schedule its sport actually has: NFL from
 * GameSchedule, NBA/NHL/MLB from the games their lineups lock on (SportsGame). It used to read
 * GameSchedule for every sport, which holds NFL alone, so no daily-sport Exile claim could open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  kickoffs: new Map<string, Date>(),
  kickoffArgs: [] as Array<{ sport: string; season: number; week: number }>,
  schedule: [] as Array<{ homeTeam: string; awayTeam: string; startTime: Date }>,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/redraft/lineupLock', async (orig) => {
  const real = await orig<typeof import('@/lib/redraft/lineupLock')>()
  return {
    ...real,
    buildWeekKickoffMap: vi.fn(async (_db: unknown, args: { sport: string; season: number; week: number }) => {
      h.kickoffArgs.push(args)
      return { byTeam: h.kickoffs, firstKickoff: null, warnings: [] }
    }),
  }
})

import { exileFirstGames, exileTeamKey } from '@/lib/survivor/exileRosterService'

const start = new Date('2026-11-02T05:00:00Z')
const end = new Date('2026-11-09T05:00:00Z')
const db = { gameSchedule: { findMany: vi.fn(async () => h.schedule) } }

beforeEach(() => {
  h.kickoffs = new Map()
  h.kickoffArgs = []
  h.schedule = []
  db.gameSchedule.findMany.mockClear()
})

describe('exileFirstGames', () => {
  it('a daily sport reads the lineup-lock games, and a full team name finds its game', async () => {
    h.kickoffs = new Map([
      [exileTeamKey('NHL', 'Edmonton Oilers'), new Date('2026-11-03T00:00:00Z')],
      [exileTeamKey('NHL', 'Montréal Canadiens'), new Date('2026-11-04T00:00:00Z')],
      // Outside the period: never offered.
      [exileTeamKey('NHL', 'Utah Mammoth'), new Date('2026-11-10T00:00:00Z')],
    ])
    const firsts = await exileFirstGames(db as never, 'NHL', 2026, 4, start, end)
    expect(h.kickoffArgs).toEqual([{ sport: 'NHL', season: 2026, week: 4 }])
    expect(db.gameSchedule.findMany).not.toHaveBeenCalled()
    expect(firsts.get(exileTeamKey('NHL', 'Edmonton Oilers'))).toEqual(new Date('2026-11-03T00:00:00Z'))
    // Accents and punctuation do not split a team: the player row's spelling finds the feed's.
    expect(firsts.get(exileTeamKey('NHL', 'Montreal Canadiens'))).toEqual(new Date('2026-11-04T00:00:00Z'))
    expect(firsts.has(exileTeamKey('NHL', 'Utah Mammoth'))).toBe(false)
  })

  it('MLB and NBA take the same path', async () => {
    h.kickoffs = new Map([[exileTeamKey('NBA', 'Miami Heat'), new Date('2026-11-05T00:00:00Z')]])
    expect((await exileFirstGames(db as never, 'NBA', 2026, 3, start, end)).size).toBe(1)
    await exileFirstGames(db as never, 'MLB', 2027, 2, start, end)
    expect(h.kickoffArgs.map((a) => a.sport)).toEqual(['NBA', 'MLB'])
  })

  it('CONTROL: NFL keeps its schedule, earliest game per team', async () => {
    h.schedule = [
      { homeTeam: 'KC', awayTeam: 'BUF', startTime: new Date('2026-11-08T18:00:00Z') },
      { homeTeam: 'KC', awayTeam: 'DEN', startTime: new Date('2026-11-06T01:15:00Z') },
    ]
    const firsts = await exileFirstGames(db as never, 'NFL', 2026, 9, start, end)
    expect(h.kickoffArgs).toEqual([])
    expect(firsts.get('KC')).toEqual(new Date('2026-11-06T01:15:00Z'))
    expect(firsts.get('BUF')).toEqual(new Date('2026-11-08T18:00:00Z'))
  })
})
