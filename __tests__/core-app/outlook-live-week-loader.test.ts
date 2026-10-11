// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  starters: vi.fn(),
  games: vi.fn(),
  players: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leaguePlayerWeeklyScore: { findMany: h.starters },
    sportsGame: { findMany: h.games },
    sportsPlayer: { findMany: h.players },
  },
}))

import { lineupShareKey, loadLineupShares } from '@/lib/core-app/outlookLiveWeekLoader'

const now = new Date('2026-10-06T03:00:00Z')
const target = { platformLeagueId: '1313536441829068800', season: 2026, week: 4 }
const game = (home: string, away: string, status: string, startTime: string) =>
  ({ season: 2026, week: 4, homeTeam: home, awayTeam: away, status, startTime: new Date(startTime), fetchedAt: new Date('2026-10-06T02:55:00Z'), seasonType: 'regular' })
const player = (sleeperId: string, team: string) => ({ sleeperId, name: sleeperId, position: 'WR', team, sport: 'NFL', imageUrl: null })
const starter = (playerId: string, rosterId: number | null) => ({ leagueId: target.platformLeagueId, seasonYear: 2026, week: 4, playerId, rosterId })

beforeEach(() => {
  vi.clearAllMocks()
  h.games.mockResolvedValue([
    game('KC', 'BUF', 'final', '2026-10-04T17:00:00Z'),
    game('DAL', 'NYG', 'in_progress', '2026-10-06T00:15:00Z'),
  ])
  h.players.mockResolvedValue([player('p1', 'KC'), player('p2', 'BUF'), player('p3', 'DAL'), player('p4', 'KC')])
})

describe('loadLineupShares', () => {
  it('reads each roster’s share still to play, keyed by league-week and platform roster id', async () => {
    h.starters.mockResolvedValue([starter('p1', 1), starter('p2', 1), starter('p3', 7), starter('p4', 7), starter('px', 7), starter('p2', null)])
    const out = await loadLineupShares([target], now)
    const shares = out.get(lineupShareKey(target))!
    expect(shares.get('1')).toBe(0) // both finished
    expect(shares.get('7')).toBeCloseTo((0.5 + 0 + 1) / 3) // live, final, unresolved id counts as to play
    expect(shares.size).toBe(2)
    expect(h.starters.mock.calls[0][0].where).toMatchObject({ isStarter: true, OR: [{ leagueId: target.platformLeagueId, seasonYear: 2026, week: 4 }] })
  })

  it('returns nothing on a failed read, so the games stay unplayed draws', async () => {
    h.starters.mockRejectedValue(new Error('db down'))
    expect((await loadLineupShares([target], now)).size).toBe(0)
  })

  it('reads nothing when nothing is under way', async () => {
    expect((await loadLineupShares([], now)).size).toBe(0)
    expect(h.starters).not.toHaveBeenCalled()
  })
})
