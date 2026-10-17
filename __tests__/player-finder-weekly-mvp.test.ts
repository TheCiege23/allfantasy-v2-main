import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  gameFind: vi.fn(),
  teamFind: vi.fn(),
  scoreFind: vi.fn(),
  resolve: vi.fn(),
  scan: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findFirst: h.gameFind },
    leagueTeam: { findMany: h.teamFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
  },
}))
vi.mock('@/lib/core-app/sleeperPlayerRefs', () => ({ resolveSleeperPlayers: h.resolve }))
vi.mock('@/lib/core-app/followingCard', () => ({ scanFreeAgentLeagues: h.scan }))

import { loadWeeklyMvp, pickMvp } from '@/lib/core-app/weeklyMvp'
import { MAX_LEAGUES, loadTrendingFreeIn } from '@/lib/core-app/trendingFree'

/*
 * "Your Week N MVP" — the platform's own starter points, on YOUR rosters, for the last FINISHED week
 * by the schedule — and the trending "free in N of yours" lookup.
 */

const NAMES = new Map([
  ['A', 'KBFL'],
  ['B', 'Home'],
])

describe('pickMvp', () => {
  it('sums a player across your leagues; most points wins, the bigger single game breaks a tie', () => {
    const m = pickMvp(
      [
        { leagueId: 'A', playerId: 'allen', points: 30 },
        { leagueId: 'B', playerId: 'allen', points: 25 },
        { leagueId: 'A', playerId: 'chase', points: 40 },
      ],
      NAMES,
    )!
    expect(m).toMatchObject({ playerId: 'allen', points: 55, runnerUp: { playerId: 'chase', points: 40 } })
    expect(m.leagues.map((l) => l.leagueName)).toEqual(['KBFL', 'Home'])
    expect(pickMvp([{ leagueId: 'A', playerId: 'x', points: 20 }, { leagueId: 'A', playerId: 'y', points: 10 }, { leagueId: 'B', playerId: 'y', points: 10 }], NAMES)!.playerId).toBe('x')
  })
  it('no points, no MVP', () => {
    expect(pickMvp([], NAMES)).toBeNull()
    expect(pickMvp([{ leagueId: 'A', playerId: 'x', points: 0 }], NAMES)).toBeNull()
  })
})

describe('loadWeeklyMvp', () => {
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.gameFind.mockResolvedValue({ week: 5, season: 2026 })
    h.teamFind.mockResolvedValue([
      { leagueId: 'A', externalId: '3', league: { name: 'KBFL' } },
      { leagueId: 'B', externalId: '7', league: { name: 'Home' } },
    ])
    h.resolve.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, { sleeperId: id, name: `P${id}`, position: 'QB', team: 'BUF', imageUrl: null, ref: `NFL:${id}` }])))
  })

  it('🛑 last week is the one BEFORE the next scheduled game, and only YOUR roster’s starters count', async () => {
    h.scoreFind.mockResolvedValue([
      { leagueId: 'A', playerId: 'mine', rosterId: 3, points: 30 },
      { leagueId: 'A', playerId: 'theirs', rosterId: 4, points: 50 }, // another roster in your league
      { leagueId: 'B', playerId: 'mine', rosterId: 7, points: 12 },
    ])
    const m = (await loadWeeklyMvp('u1', new Date('2026-10-09T15:00:00Z')))!
    expect(h.scoreFind.mock.calls[0]![0].where).toMatchObject({ seasonYear: 2026, week: 4, isStarter: true })
    expect(m).toMatchObject({ week: 4, points: 42, leaguesRead: 2, player: { name: 'Pmine' }, runnerUp: null })
  })

  it('null in the off-season, before week 1 has been played, or with no Sleeper team', async () => {
    h.gameFind.mockResolvedValueOnce(null)
    expect(await loadWeeklyMvp('u1')).toBeNull()
    h.gameFind.mockResolvedValueOnce({ week: 1, season: 2026 })
    expect(await loadWeeklyMvp('u1')).toBeNull()
    h.teamFind.mockResolvedValueOnce([])
    expect(await loadWeeklyMvp('u1')).toBeNull()
  })
})

describe('loadTrendingFreeIn', () => {
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
  })

  it(`reads your NFL leagues in chunks (at most ${MAX_LEAGUES}) and unions where each player is free`, async () => {
    const leagues = Array.from({ length: 60 }, (_, i) => ({ id: `L${i}`, name: `L${i}`, platform: 'sleeper', sport: i === 0 ? 'NBA' : 'NFL' }))
    h.scan.mockImplementation(async (_u: string, part: Array<{ id: string }>) => ({
      free: new Map([['9', [{ leagueId: part[0]!.id, leagueName: part[0]!.id, href: `/core/waivers?league=${part[0]!.id}` }]]]),
      checked: part.map((p) => p.id),
    }))
    const out = await loadTrendingFreeIn('u1', leagues, ['9', '9'])
    expect(h.scan.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([12, 12, 12, 12])
    expect(h.scan.mock.calls.flatMap((c) => (c[1] as Array<{ id: string }>).map((l) => l.id))).not.toContain('L0')
    expect(out['9']).toHaveLength(4)
  })

  it('a failed chunk drops only its own leagues', async () => {
    h.scan.mockRejectedValueOnce(new Error('rosters')).mockResolvedValue({ free: new Map([['9', [{ leagueId: 'X', leagueName: 'X', href: '#' }]]]), checked: ['X'] })
    const out = await loadTrendingFreeIn('u1', Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, name: null, platform: 'sleeper', sport: 'NFL' })), ['9'])
    expect(out['9']).toHaveLength(1)
  })
})
