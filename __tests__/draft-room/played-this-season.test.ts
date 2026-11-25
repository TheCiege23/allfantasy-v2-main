import { beforeEach, describe, expect, it, vi } from 'vitest'
const { findFirst, findMany } = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerSeasonStats: { findFirst, findMany } } }))
import { loadPlayedThisSeasonIds } from '@/lib/draft-room/playedThisSeason'

beforeEach(() => { findFirst.mockReset(); findMany.mockReset() })

describe('who has played this season', () => {
  it('reads the newest season on file and returns its player ids', async () => {
    findFirst.mockResolvedValue({ season: '2026' })
    findMany.mockResolvedValue([{ playerId: '3825' }, { playerId: '285' }])
    const ids = await loadPlayedThisSeasonIds('NHL')
    expect([...ids].sort()).toEqual(['285', '3825'])
    const base = { sport: 'NHL', source: 'rolling_insights', seasonType: 'regular', gamesPlayed: { gt: 0 } }
    // Newest season: not a year worked out from the date, which is wrong from January to the season's end.
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({ where: base, orderBy: { season: 'desc' } })
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { ...base, season: '2026' }, select: { playerId: true } })
  })

  it('is empty, without a second read, when no season has a game on file', async () => {
    findFirst.mockResolvedValue(null)
    expect((await loadPlayedThisSeasonIds('NBA')).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('reads nothing for a sport it was not measured on', async () => {
    for (const sport of ['MLB', 'NFL', 'SOCCER']) expect((await loadPlayedThisSeasonIds(sport)).size).toBe(0)
    expect(findFirst).not.toHaveBeenCalled()
  })
})
