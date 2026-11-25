import { beforeEach, describe, expect, it, vi } from 'vitest'
const { findFirst, findMany } = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerSeasonStats: { findFirst, findMany } } }))
import { loadPlayedThisSeasonIds } from '@/lib/draft-room/playedThisSeason'

beforeEach(() => { findFirst.mockReset(); findMany.mockReset() })

describe('who has played this season', () => {
  const base = (sport: string) => ({ sport, source: 'rolling_insights', seasonType: 'regular' })

  it('reads the newest season on file and returns its player ids', async () => {
    findFirst.mockResolvedValue({ season: '2026' })
    findMany.mockResolvedValue([{ playerId: '3825' }, { playerId: '285' }])
    const ids = await loadPlayedThisSeasonIds('NHL')
    expect([...ids].sort()).toEqual(['285', '3825'])
    // Newest season: not a year worked out from the date, which is wrong from January to the season's end.
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { ...base('NHL'), gamesPlayed: { gt: 0 } }, orderBy: { season: 'desc' } })
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { ...base('NHL'), season: '2026', gamesPlayed: { gte: 1 } }, select: { playerId: true } })
  })

  it('counts one game in basketball and hockey, and ten in baseball', async () => {
    // MLB, measured 2026-11-25: 493 of the 832 players outside the pool with a 2026 game had one to
    // three. Ten keeps Luis Arraez (151 games) and not a September call-up.
    for (const [sport, games] of [['NBA', 1], ['NHL', 1], ['MLB', 10]] as const) {
      findFirst.mockResolvedValue({ season: '2026' })
      findMany.mockResolvedValue([])
      await loadPlayedThisSeasonIds(sport)
      expect(findMany.mock.calls.at(-1)?.[0]?.where).toMatchObject({ ...base(sport), season: '2026', gamesPlayed: { gte: games } })
    }
  })

  it('is empty, without a second read, when no season has a game on file', async () => {
    findFirst.mockResolvedValue(null)
    expect((await loadPlayedThisSeasonIds('NBA')).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('reads nothing for a sport with no rule', async () => {
    for (const sport of ['NFL', 'SOCCER', 'NCAAB']) expect((await loadPlayedThisSeasonIds(sport)).size).toBe(0)
    expect(findFirst).not.toHaveBeenCalled()
  })
})
