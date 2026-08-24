import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The founder's second scenario, pinned: a trade accepted in an imported
 * Sleeper league should be findable. The data was always there — the surfaces
 * were declining to look, and one said so in words that were false.
 */

const { cacheFindMany, valueFindMany } = vi.hoisted(() => ({
  cacheFindMany: vi.fn(),
  valueFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findMany: cacheFindMany },
    playerValueSnapshot: { findMany: valueFindMany },
  },
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
              playersIn: [{ playerId: '4988', name: 'Darren Waller', position: 'TE' }],
              picksIn: [],
            },
            {
              rosterId: 2,
              managerName: 'Hustead',
              teamName: null,
              playersIn: [],
              picksIn: [{ label: '2027 4th', season: '2027', round: 4 }],
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
  valueFindMany.mockReset()
  cacheFindMany.mockResolvedValue([payload()])
  // By default nothing is priced, so no verdict is published.
  valueFindMany.mockResolvedValue([])
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

  it("never borrows the sweep's retrospective letter", async () => {
    // That grade is scored on realised points: days after a trade it measures
    // almost nothing, and a 2027 pick contributes zero. The verdict published
    // instead is a different question, asked of the day the deal was struck.
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(JSON.stringify(out)).not.toMatch(/initialGrade|currentGrade/)
  })

  describe('the prospective verdict', () => {
    it('prices a future pick properly instead of at zero, and reaches a verdict', async () => {
      // Waller priced near a 4th-rounder's discounted value => a fair-ish deal
      // that the retrospective grader would have scored as a shutout, because
      // the 2027 draft has not happened.
      valueFindMany.mockResolvedValue([
        { sleeperId: '4988', name: 'Darren Waller', value: 272 },
      ])
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out[0].verdict).not.toBeNull()
      expect(typeof out[0].verdict?.verdict).toBe('string')
      expect(out[0].verdict?.confidence).toBeGreaterThanOrEqual(0)
    })

    it('publishes NOTHING when a traded player has no price on file', async () => {
      // A partially priced trade systematically favours whoever received the
      // asset we could not price. Absent is the honest answer.
      valueFindMany.mockResolvedValue([])
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out[0].verdict).toBeNull()
    })

    it('refuses to grade a three-team trade as if two teams traded', async () => {
      cacheFindMany.mockResolvedValue([
        payload({
          trades: [
            {
              id: 'three',
              createdIso: NOW.toISOString(),
              multiTeam: true,
              sides: [
                { rosterId: 1, managerName: 'a', teamName: null, playersIn: [{ playerId: '1', name: 'A' }], picksIn: [] },
                { rosterId: 2, managerName: 'b', teamName: null, playersIn: [{ playerId: '2', name: 'B' }], picksIn: [] },
                { rosterId: 3, managerName: 'c', teamName: null, playersIn: [{ playerId: '3', name: 'C' }], picksIn: [] },
              ],
            },
          ],
        }),
      ])
      valueFindMany.mockResolvedValue([
        { sleeperId: '1', name: 'A', value: 1000 },
        { sleeperId: '2', name: 'B', value: 1000 },
        { sleeperId: '3', name: 'C', value: 1000 },
      ])
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out[0].sides).toHaveLength(3)
      expect(out[0].verdict).toBeNull()
    })

    it('prices only the trades that will actually render', async () => {
      valueFindMany.mockResolvedValue([])
      await getRecentTrades(LEAGUES, NOW, 1)
      // One read, scoped to the visible trade's players.
      expect(valueFindMany).toHaveBeenCalledTimes(1)
      expect(valueFindMany.mock.calls[0][0].where.sleeperId.in).toEqual(['4988'])
    })

    it('survives a price read failure by withholding the verdict, not the trade', async () => {
      valueFindMany.mockImplementationOnce(async () => {
        throw new Error('db down')
      })
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out).toHaveLength(1)
      expect(out[0].verdict).toBeNull()
    })
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
