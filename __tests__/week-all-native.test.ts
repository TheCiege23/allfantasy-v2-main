// @vitest-environment node
/**
 * AllFantasy-native leagues in `getWeekAll` (2026-10-01). Their games live in `redraft_matchups`,
 * not WeeklyMatchup, so before this a native league never reached "your week", the home routine or
 * the weekly story — and an account with ONLY native leagues got an empty week.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  current: vi.fn(),
  matchups: vi.fn(),
  teams: vi.fn(),
  metadata: vi.fn(),
  games: vi.fn(),
  nativeFirst: vi.fn(),
  nativeMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: h.current }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: h.metadata }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: h.matchups },
    leagueTeam: { findMany: h.teams },
    sportsGame: { findMany: h.games },
    redraftMatchup: { findFirst: h.nativeFirst, findMany: h.nativeMany },
  },
}))

import { getWeekAll } from '@/lib/core-app/weekAll'

const SLEEPER = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice' }
const NATIVE = { id: 'af-home', name: 'Home League', platform: 'allfantasy', platformLeagueId: null }
const NATIVE2 = { id: 'af-two', name: 'Second Home', platform: null, platformLeagueId: null }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
  for (const f of Object.values(h)) f.mockReset()
  h.games.mockResolvedValue([])
  h.metadata.mockResolvedValue([{ platformLeagueId: 'sl-ice', season: 2026, status: 'in_season', settings: { leg: 5 } }])
  h.teams.mockResolvedValue([{ externalId: '4', league: SLEEPER }])
  h.matchups.mockResolvedValue([{ leagueId: 'sl-ice', rosterId: '4', pointsFor: 120, pointsAgainst: 100, win: 1 }])
  h.nativeFirst.mockResolvedValue(null)
  h.nativeMany.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('getWeekAll — native leagues', () => {
  it('🛑 an account with ONLY native leagues gets its newest final week, scored from its own side', async () => {
    h.nativeFirst.mockResolvedValue({ week: 4, season: { season: 2026 } })
    h.nativeMany.mockResolvedValue([
      // the user is HOME here …
      { leagueId: 'af-home', status: 'final', homeScore: 131.5, awayScore: 99, homeRoster: { ownerId: 'u1' } },
      // … and AWAY here: the score read must be the away side
      { leagueId: 'af-two', status: 'final', homeScore: 140, awayScore: 88.2, homeRoster: { ownerId: 'open-slot-3' } },
    ])
    const out = await getWeekAll('u1', [NATIVE, NATIVE2], { previous: true })

    expect(h.current).not.toHaveBeenCalled()
    expect(h.nativeFirst.mock.calls[0][0].where).toMatchObject({ leagueId: { in: ['af-home', 'af-two'] }, status: 'final' })
    expect(h.nativeMany.mock.calls[0][0].where).toMatchObject({
      leagueId: { in: ['af-home', 'af-two'] },
      week: 4,
      season: { season: 2026 },
      isMedianMatchup: false,
      awayRosterId: { not: null },
    })
    expect(out).toMatchObject({ season: 2026, week: 4, withoutHistory: 0, record: { wins: 1, losses: 1 } })
    expect(out.rows).toEqual([
      expect.objectContaining({ leagueId: 'af-home', leagueName: 'Home League', platform: 'allfantasy', pointsFor: 131.5, pointsAgainst: 99, won: true, completed: true }),
      expect.objectContaining({ leagueId: 'af-two', leagueName: 'Second Home', pointsFor: 88.2, pointsAgainst: 140, won: false, completed: true }),
    ])
  })

  it('the live view takes an ACTIVE native week too, and an active score is never a result', async () => {
    h.nativeFirst.mockResolvedValue({ week: 5, season: { season: 2026 } })
    h.nativeMany.mockResolvedValue([{ leagueId: 'af-home', status: 'active', homeScore: 61, awayScore: 40, homeRoster: { ownerId: 'u1' } }])
    const out = await getWeekAll('u1', [NATIVE])

    expect(h.nativeFirst.mock.calls[0][0].where.status).toEqual({ in: ['active', 'final'] })
    expect(out.rows[0]).toMatchObject({ pointsFor: 61, completed: false, won: false })
    expect(out.record).toBeNull()
  })

  it('a results review drops an active native game and counts it as unscored', async () => {
    h.nativeFirst.mockResolvedValue({ week: 4, season: { season: 2026 } })
    h.nativeMany.mockResolvedValue([{ leagueId: 'af-home', status: 'active', homeScore: 61, awayScore: 40, homeRoster: { ownerId: 'u1' } }])
    const out = await getWeekAll('u1', [NATIVE], { previous: true })
    expect(out.rows).toEqual([])
    expect(out.unscored).toBe(1)
  })

  it('a scheduled 0-0 native game is unscored, not a tie', async () => {
    h.nativeFirst.mockResolvedValue({ week: 5, season: { season: 2026 } })
    h.nativeMany.mockResolvedValue([{ leagueId: 'af-home', status: 'scheduled', homeScore: 0, awayScore: 0, homeRoster: { ownerId: 'u1' } }])
    const out = await getWeekAll('u1', [NATIVE])
    expect(out.rows).toEqual([])
    expect(out.unscored).toBe(1)
  })

  it('with provider leagues present, the PROVIDER week decides and native rows join it', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 5 })
    h.nativeMany.mockResolvedValue([{ leagueId: 'af-home', status: 'final', homeScore: 150, awayScore: 90, homeRoster: { ownerId: 'u1' } }])
    const out = await getWeekAll('u1', [SLEEPER, NATIVE])

    expect(h.nativeFirst).not.toHaveBeenCalled()
    expect(h.nativeMany.mock.calls[0][0].where).toMatchObject({ week: 5, season: { season: 2026 } })
    // provider ids never include a native league, and the native read never includes a provider one
    expect(h.matchups.mock.calls[0][0].where.leagueId).toEqual({ in: ['sl-ice'] })
    expect(h.nativeMany.mock.calls[0][0].where.leagueId).toEqual({ in: ['af-home'] })
    expect(out.week).toBe(5)
    expect(out.rows.map((r) => r.leagueId)).toEqual(['af-home', 'af-ice']) // sorted by points
  })

  it('a provider-only account never reads redraft_matchups', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 5 })
    const out = await getWeekAll('u1', [SLEEPER])
    expect(h.nativeFirst).not.toHaveBeenCalled()
    expect(h.nativeMany).not.toHaveBeenCalled()
    expect(out.rows).toHaveLength(1)
  })

  it('native leagues with no game of yours on file still return an empty week', async () => {
    const out = await getWeekAll('u1', [NATIVE])
    expect(out).toMatchObject({ rows: [], week: null, withoutHistory: 1 })
    expect(h.nativeMany).not.toHaveBeenCalled()
  })

  it('a provider league whose week cannot be resolved falls back to the native week', async () => {
    h.current.mockResolvedValue(null)
    h.nativeFirst.mockResolvedValue({ week: 3, season: { season: 2026 } })
    h.nativeMany.mockResolvedValue([{ leagueId: 'af-home', status: 'final', homeScore: 100, awayScore: 90, homeRoster: { ownerId: 'u1' } }])
    const out = await getWeekAll('u1', [SLEEPER, NATIVE], { previous: true })
    expect(out.week).toBe(3)
    expect(h.matchups).not.toHaveBeenCalled()
    expect(out.rows).toEqual([expect.objectContaining({ leagueId: 'af-home' })])
  })
})
