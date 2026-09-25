/**
 * 🛑 A DAILY-SPORT DRAFT COULD HAND OUT AN ID THAT NEVER SCORES. NHL, NBA and NCAAB are scored from
 * Rolling Insights game logs, reached only through a numeric RI id (rosterGameLogIdBridge.ts). The
 * pool's de-dup tie-break gave a TheSportsDB row (+60, +100 for its photo) the win over the RI row
 * for the same player, and a drafted `tsdb_…` id scores zero every week with no error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sportsDataCache: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
  allFantasyAdpSnapshot: { groupBy: vi.fn(), findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { getPlayerPoolForSport, isScorablePoolId } from '@/lib/sport-teams/SportPlayerPoolResolver'

const row = (over: Record<string, unknown>) => ({
  id: 'x',
  name: 'Connor McDavid',
  position: 'C',
  team: 'Edmonton Oilers',
  teamId: null,
  status: null,
  sleeperId: null,
  externalId: null,
  age: 29,
  imageUrl: null,
  source: null,
  ...over,
})

const TSDB = row({ id: 't1', externalId: 'tsdb_34146', imageUrl: 'https://img.example/mcdavid.png', source: 'thesportsdb' })
const RI = row({ id: 'r1', externalId: '3900', source: 'rolling_insights' })

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sportsDataCache.findFirst.mockResolvedValue(null)
  prismaMock.sportsDataCache.upsert.mockResolvedValue({ cacheKey: 'x' })
  prismaMock.allFantasyAdpSnapshot.groupBy.mockResolvedValue([])
  prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
})

describe('isScorablePoolId', () => {
  it('a daily sport scores only a numeric (Rolling Insights) id', () => {
    expect(isScorablePoolId('NHL', { externalId: '3900' })).toBe(true)
    expect(isScorablePoolId('NHL', { externalId: 'tsdb_34146' })).toBe(false)
    expect(isScorablePoolId('NBA', { externalId: 'tsdb_1' })).toBe(false)
    expect(isScorablePoolId('NCAAB', { externalId: '77' })).toBe(true)
  })

  it('any id is fine for a sport not scored from game logs', () => {
    expect(isScorablePoolId('NFL', { externalId: 'tsdb_1' })).toBe(true)
  })
})

describe('getPlayerPoolForSport — de-dup keeps the id that scores', () => {
  it('NHL: the Rolling Insights id wins over TheSportsDB’s, and keeps its photo', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([TSDB, RI])
    const pool = await getPlayerPoolForSport('NHL', { limit: 10 })
    expect(pool).toHaveLength(1)
    expect(pool[0]).toMatchObject({ external_source_id: '3900', image_url: 'https://img.example/mcdavid.png' })
  })

  it('NHL: order of the rows does not matter', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([RI, TSDB])
    const pool = await getPlayerPoolForSport('NHL', { limit: 10 })
    expect(pool[0]).toMatchObject({ external_source_id: '3900', image_url: 'https://img.example/mcdavid.png' })
  })

  it('NHL: a player with only a TheSportsDB row is still listed (preferred, never dropped)', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([TSDB])
    const pool = await getPlayerPoolForSport('NHL', { limit: 10 })
    expect(pool.map((p) => p.external_source_id)).toEqual(['tsdb_34146'])
  })

  it('[control] NFL keeps its existing tie-break (photo and source), unchanged', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      row({ id: 't1', name: 'X', position: 'WR', team: 'DAL', externalId: 'tsdb_9', imageUrl: 'https://img.example/x.png', source: 'thesportsdb' }),
      row({ id: 'r1', name: 'X', position: 'WR', team: 'DAL', externalId: '500', source: 'rolling_insights' }),
    ])
    const pool = await getPlayerPoolForSport('NFL', { limit: 10 })
    expect(pool[0]?.external_source_id).toBe('tsdb_9')
  })
})
