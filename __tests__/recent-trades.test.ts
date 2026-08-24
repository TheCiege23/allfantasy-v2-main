import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The founder's second scenario, pinned: a trade accepted in an imported
 * Sleeper league should be findable. The data was always there — the surfaces
 * were declining to look, and one said so in words that were false.
 */

const { cacheFindMany } = vi.hoisted(() => ({ cacheFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findMany: cacheFindMany } },
}))

import { getRecentTrades } from '@/lib/core-app/recentTrades'

const NOW = new Date('2026-08-24T20:00:00Z')
const LEAGUES = [{ id: 'af-1', name: 'Bla bla bla', platformLeagueId: '99887766' }]

function payload(over: Record<string, unknown> = {}) {
  return {
    cacheKey: 'trade-grades:v2:99887766',
    data: {
      version: 2,
      trades: [
        {
          id: 'tr-1',
          createdIso: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
          sides: [
            {
              rosterId: 1,
              managerName: 'chxnk',
              teamName: null,
              playersIn: [{ name: 'Darren Waller', position: 'TE' }],
              picksIn: [],
            },
            {
              rosterId: 2,
              managerName: 'Hustead',
              teamName: null,
              playersIn: [],
              picksIn: [{ label: '2027 4th' }],
            },
          ],
        },
      ],
      ...over,
    },
  }
}

beforeEach(() => {
  cacheFindMany.mockReset()
  cacheFindMany.mockResolvedValue([payload()])
})

describe('getRecentTrades', () => {
  it('finds the trade both managers accepted, naming who got what', async () => {
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].leagueName).toBe('Bla bla bla')
    const [chxnk, hustead] = out[0].sides
    expect(chxnk.received.map((a) => a.name)).toEqual(['Darren Waller'])
    expect(hustead.received.map((a) => a.name)).toEqual(['2027 4th'])
  })

  it('names a pick as a pick, never as the player it later became', async () => {
    const out = await getRecentTrades(LEAGUES, NOW)
    const pickAsset = out[0].sides[1].received[0]
    expect(pickAsset.kind).toBe('pick')
    expect(pickAsset.name).toBe('2027 4th')
  })

  it('publishes no grade — the sweep letter is retrospective and would be measuring nothing', async () => {
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(JSON.stringify(out)).not.toMatch(/"grade"|initialGrade|currentGrade/)
  })

  it('drops a trade older than the recent window', async () => {
    cacheFindMany.mockResolvedValue([
      payload({
        trades: [
          {
            id: 'old',
            createdIso: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
            sides: [
              { rosterId: 1, managerName: 'a', teamName: null, playersIn: [{ name: 'X' }], picksIn: [] },
              { rosterId: 2, managerName: 'b', teamName: null, playersIn: [{ name: 'Y' }], picksIn: [] },
            ],
          },
        ],
      }),
    ])
    expect(await getRecentTrades(LEAGUES, NOW)).toEqual([])
  })

  it('flags a side whose assets could not be named rather than drawing an empty column', async () => {
    cacheFindMany.mockResolvedValue([
      payload({
        trades: [
          {
            id: 'partial',
            createdIso: NOW.toISOString(),
            sides: [
              { rosterId: 1, managerName: 'a', teamName: null, playersIn: [{ name: 'X' }], picksIn: [] },
              { rosterId: 2, managerName: 'b', teamName: null, playersIn: [], picksIn: [] },
            ],
          },
        ],
      }),
    ])
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(out[0].partial).toBe(true)
  })

  it('never queries when the account has no platform league ids', async () => {
    expect(await getRecentTrades([{ id: 'a', name: 'n', platformLeagueId: null }], NOW)).toEqual([])
    expect(cacheFindMany).not.toHaveBeenCalled()
  })

  it('ignores a cache row of the wrong version rather than trusting its shape', async () => {
    cacheFindMany.mockResolvedValue([payload({ version: 1 })])
    expect(await getRecentTrades(LEAGUES, NOW)).toEqual([])
  })

  it('degrades to nothing when the cache read fails', async () => {
    cacheFindMany.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    expect(await getRecentTrades(LEAGUES, NOW)).toEqual([])
  })
})
