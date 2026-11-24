import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `attachPlayerMediaBatch` looks players up per sport (lib/player-media.ts). It matched `sleeperId`
 * across every sport and `SportsPlayerRecord.id` by the bare id, so an NBA id that is also an NFL
 * Sleeper id showed the NFL player's face, and a stored record (id `<SPORT>:<id>`) never matched.
 */
type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ players: [] as Row[], recordWheres: [] as unknown[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    sportsPlayer: {
      findMany: vi.fn(async (args: { where: Row }) => {
        const ids = (args.where.sleeperId as { in: string[] }).in
        return state.players.filter((r) => ids.includes(r.sleeperId as string) && (args.where.sport == null || r.sport === args.where.sport))
      }),
    },
    sportsPlayerRecord: {
      findMany: vi.fn(async (args: { where: Row }) => {
        state.recordWheres.push(args.where)
        const ids = (args.where.id as { in: string[] }).in
        return ids.includes('NBA:77') ? [{ id: 'NBA:77', headshotUrl: 'https://img/record-77.png', team: 'BOS', logoUrl: null }] : []
      }),
    },
    teamAsset: { findMany: vi.fn(async () => []) },
  },
}))

const KEENAN = 'https://sleepercdn.com/content/nfl/players/1479.jpg'
const LAMB = 'https://sleepercdn.com/content/nba/players/thumb/1479.jpg'

beforeEach(() => {
  vi.resetModules()
  state.recordWheres = []
  state.players = [
    { sleeperId: '1479', sport: 'NFL', source: 'sleeper', name: 'Keenan Allen', position: 'WR', team: 'LAC', imageUrl: KEENAN, fetchedAt: new Date('2026-10-01') },
    { sleeperId: '1479', sport: 'NBA', source: 'sleeper', name: 'Doron Lamb', position: 'SG', team: null, imageUrl: LAMB, fetchedAt: new Date('2026-10-01') },
  ]
})

describe('attachPlayerMediaBatch is per sport', () => {
  it('an NBA id never takes the NFL player who shares it', async () => {
    const { attachPlayerMediaBatch } = await import('@/lib/player-media')
    const out = await attachPlayerMediaBatch([{ playerId: '1479', sport: 'nba' }])
    expect(out.get('1479')?.media.headshotUrl).not.toBe(KEENAN)
    expect(out.get('1479')?.media.headshotUrl).toBe(LAMB)
  })

  it('[control] the NFL id still gets the NFL player', async () => {
    const { attachPlayerMediaBatch } = await import('@/lib/player-media')
    const out = await attachPlayerMediaBatch([{ playerId: '1479', sport: 'nfl' }])
    expect(out.get('1479')?.media.headshotUrl).toBe(KEENAN)
  })

  it('reads stored records by their <SPORT>:<id> key', async () => {
    const { attachPlayerMediaBatch } = await import('@/lib/player-media')
    const out = await attachPlayerMediaBatch([{ playerId: '77', sport: 'nba' }])
    expect(state.recordWheres).toEqual([{ id: { in: ['NBA:77'] } }])
    expect(out.get('77')?.media.headshotUrl).toBe('https://img/record-77.png')
  })
})
