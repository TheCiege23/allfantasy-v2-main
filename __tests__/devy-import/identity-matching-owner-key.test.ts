// @vitest-environment node
/**
 * executeMerge places a player by finding the manager mapping whose externalUsername (or display
 * name) equals the player row's managerExternalUserId. These pin that the two sides use the SAME key,
 * for both source kinds the wizard offers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    devyImportSource: { findMany: vi.fn() },
    devyManagerMapping: { deleteMany: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))

import { collectPlayers, matchManagers } from '@/lib/devy/identityMatchingEngine'

beforeEach(() => {
  vi.clearAllMocks()
  m.db.devyManagerMapping.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data)
})

describe('Sleeper source', () => {
  const sleeper = {
    id: 'src1',
    sourcePlatform: 'sleeper',
    rawData: {
      users: [
        { user_id: '111', username: 'annie', display_name: 'Annie' },
        { user_id: '222', display_name: 'Bob' },
      ],
      rosters: [
        { owner_id: '111', ownerUsername: 'annie', players: ['p1'] },
        { owner_id: '222', players: ['p2'] },
      ],
      sleeperPlayerNames: { p1: 'One', p2: 'Two' },
    },
  }

  it("each player's owner key equals the externalUsername its manager row gets", async () => {
    m.db.devyImportSource.findMany.mockResolvedValue([sleeper])
    const players = await collectPlayers('S1')
    const managers = await matchManagers('S1', [])
    const keys = new Set(managers.map(x => x.externalUsername))
    expect(players.map(p => p.managerExternalUserId)).toEqual(['annie', '222'])
    for (const p of players) expect(keys.has(p.managerExternalUserId!)).toBe(true)
  })
})

describe('CSV source', () => {
  const csv = {
    id: 'src2',
    sourcePlatform: 'csv',
    rawData: {
      players: [
        { externalId: 'c1', externalName: 'Alpha', managerExternalUserId: 'carl' },
        { externalId: 'c2', externalName: 'Beta', managerExternalUserId: 'carl' },
        { externalId: 'c3', externalName: 'Gamma', managerExternalUserId: 'dana' },
        { externalId: 'c4', externalName: 'Delta' },
      ],
    },
  }

  it('creates one manager row per distinct owner, keyed so the merge can find it', async () => {
    m.db.devyImportSource.findMany.mockResolvedValue([csv])
    const managers = await matchManagers('S1', [{ userId: 'app-dana', displayName: 'dana' }])
    expect(managers.map(x => x.externalUsername)).toEqual(['carl', 'dana'])
    expect(managers[1]).toMatchObject({ internalUserId: 'app-dana', matchConfidence: 'high', requiresReview: false })
    expect(managers[0]).toMatchObject({ internalUserId: null, requiresReview: true })
  })
})
