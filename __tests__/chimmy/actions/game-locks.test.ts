import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Players whose games started can't move." The engine stores per-player kickoff locks but does not
 * enforce them, so this check is the one a Chimmy lineup card relies on — and its failure mode that
 * matters is a SILENT PASS. Every case where the answer cannot be known must come back unverified.
 */

const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: h.findMany } } }))
vi.mock('@/lib/sports/teamRef', () => ({
  sameNflTeam: (a?: string | null, b?: string | null) => {
    const canon = (s?: string | null) => ({ KC: 'KC', 'KANSAS CITY CHIEFS': 'KC', BUF: 'BUF', 'BUFFALO BILLS': 'BUF' } as Record<string, string>)[String(s ?? '').toUpperCase()]
    return Boolean(canon(a) && canon(a) === canon(b))
  },
}))

import { checkStartedGames, windowStart } from '@/lib/chimmy/actions/gameLocks'

const NOW = new Date('2026-09-27T18:30:00Z') // Sunday 2:30 PM ET
const game = (home: string, away: string, iso: string) => ({ homeTeam: home, awayTeam: away, homeTeamId: null, awayTeamId: null, startTime: new Date(iso), status: null })
const p = (playerId: string, team: string | null, gameTime: string | null = null) => ({ playerId, name: playerId, team, gameTime })

beforeEach(() => {
  h.findMany.mockReset()
})

describe('checkStartedGames', () => {
  it('locks an NFL player whose game kicked off, across provider spellings', async () => {
    h.findMany.mockResolvedValue([game('Kansas City Chiefs', 'Buffalo Bills', '2026-09-27T17:00:00Z')])
    const r = await checkStartedGames({ sport: 'NFL', season: 2026, week: 4, players: [p('mahomes', 'KC')], now: NOW })
    expect(r.started.get('mahomes')).toMatch(/has already started/)
  })

  it('clears a player whose team plays later', async () => {
    h.findMany.mockResolvedValue([game('KC', 'BUF', '2026-09-28T00:20:00Z')])
    const r = await checkStartedGames({ sport: 'NFL', season: 2026, week: 4, players: [p('mahomes', 'KC')], now: NOW })
    expect(r.started.size).toBe(0)
    expect(r.unverified).toEqual([])
  })

  it('locks on the stored game time alone, without reading the schedule', async () => {
    const r = await checkStartedGames({ sport: 'NBA', season: 2026, week: 1, players: [p('lebron', 'LAL', '2026-09-27T17:00:00Z')], now: NOW })
    expect(r.started.has('lebron')).toBe(true)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('reports a team it cannot find on the schedule as UNVERIFIED, never as clear', async () => {
    h.findMany.mockResolvedValue([game('Los Angeles Lakers', 'Boston Celtics', '2026-09-27T23:00:00Z')])
    const r = await checkStartedGames({ sport: 'NBA', season: 2026, week: 1, players: [p('lebron', 'LAL')], now: NOW })
    expect(r.started.size).toBe(0)
    expect(r.unverified).toEqual(['lebron'])
  })

  it('reports unverified when the schedule read fails or the player has no team', async () => {
    h.findMany.mockImplementation(async () => {
      throw new Error('db')
    })
    const r = await checkStartedGames({ sport: 'MLB', season: 2026, week: 1, players: [p('a', 'NYY'), p('b', null)], now: NOW })
    expect(r.unverified.sort()).toEqual(['a', 'b'])
  })

  it('opens the NFL week on Tuesday, so last Monday night never locks this week', () => {
    expect(windowStart('NFL', NOW).toISOString()).toBe('2026-09-22T10:00:00.000Z')
    expect(windowStart('NCAAF', NOW).toISOString()).toBe('2026-09-21T10:00:00.000Z')
  })
})
