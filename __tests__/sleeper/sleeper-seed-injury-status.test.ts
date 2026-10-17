import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `SleeperPlayerSeedService` writes `SportsPlayerRecord.injuryStatus` straight from Sleeper's
 * `injury_status`, which also carries "NA". It has no scheduled caller today, but it writes the same
 * column the importer guards, so it applies the same predicate rather than relying on the guard to
 * clean up after it.
 */
const h = vi.hoisted(() => ({ recordRows: [] as any[], players: {} as Record<string, unknown> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/api-chain', () => ({ apiChain: { fetch: vi.fn() } }))
vi.mock('@/lib/sleeper-client', () => ({ getPlayersBySport: vi.fn(async () => h.players) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async () => [{ exists: true }],
    sportsPlayer: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    sportsPlayerRecord: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: any) => {
        h.recordRows.push(...data)
        return { count: data.length }
      },
    },
  },
}))

beforeEach(() => {
  h.recordRows.length = 0
  h.players = {
    '1': { player_id: '1', full_name: 'Free Agent Guy', team: null, position: 'WR', injury_status: 'NA', injury_notes: 'Not with a team' },
    '2': { player_id: '2', full_name: 'Hurt Guy', team: 'DET', position: 'RB', injury_status: 'Questionable', injury_notes: 'Hamstring' },
    '3': { player_id: '3', full_name: 'Healthy Guy', team: 'DET', position: 'QB', injury_status: null, injury_notes: 'Old note' },
  }
})

describe('Sleeper seed → SportsPlayerRecord injury fields', () => {
  it('stores only designations, and no note without one', async () => {
    const { seedSleeperPlayers } = await import('@/lib/sleeper/SleeperPlayerSeedService')
    await seedSleeperPlayers({ sport: 'NFL' })
    const byId = Object.fromEntries(h.recordRows.map((r) => [r.id, [r.injuryStatus, r.injuryNotes]]))
    expect(byId['NFL:1']).toEqual([null, null])
    expect(byId['NFL:2']).toEqual(['Questionable', 'Hamstring'])
    expect(byId['NFL:3']).toEqual([null, null])
  })
})
