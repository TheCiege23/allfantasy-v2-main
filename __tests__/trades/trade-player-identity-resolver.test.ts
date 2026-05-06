import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayerRecord: { findUnique: prismaMocks.findUnique },
    sportsPlayer: { findFirst: prismaMocks.findFirst },
  },
}))

import { resolveTradePlayerAssets } from '@/lib/trades/tradePlayerIdentityResolver'

const { findUnique, findFirst } = prismaMocks

describe('resolveTradePlayerAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves trade asset with internal sports_players id', async () => {
    findUnique.mockResolvedValueOnce({ id: 'rec-1', sport: 'NFL' })
    const r = await resolveTradePlayerAssets({
      sport: 'nfl',
      assets: [{ name: 'Any', playerId: 'rec-1' }],
    })
    expect(r.resolved).toHaveLength(1)
    expect(r.resolved[0].playerId).toBe('rec-1')
    expect(r.resolved[0].source).toBe('explicit_player_id')
    expect(r.unresolved).toHaveLength(0)
  })

  it('resolves via sportsPlayer bridge when candidate is sleeper id', async () => {
    findUnique.mockResolvedValueOnce(null)
    findFirst.mockResolvedValueOnce({
      id: 'bridge-id',
      sleeperId: 'sl-99',
      externalId: null,
    })
    findUnique.mockResolvedValueOnce({ id: 'rec-final', sport: 'NFL' })
    const r = await resolveTradePlayerAssets({
      sport: 'nfl',
      assets: [{ name: 'Bridge', sleeperPlayerId: 'sl-99' }],
    })
    expect(r.resolved).toHaveLength(1)
    expect(r.resolved[0].playerId).toBe('rec-final')
    expect(r.resolved[0].source).toContain('sports_player_bridge')
  })

  it('does not invent a match for string-only assets without a name map', async () => {
    const r = await resolveTradePlayerAssets({
      sport: 'nfl',
      nameLowerToExternalPid: {},
      assets: ['Josh Allen'],
    })
    expect(r.resolved).toHaveLength(0)
    expect(r.unresolved[0].reason).toBe('string_asset_requires_name_map')
  })

  it('returns unresolved when duplicate-name safety would require map and record is missing', async () => {
    findUnique.mockResolvedValue(null)
    findFirst.mockResolvedValue(null)
    const r = await resolveTradePlayerAssets({
      sport: 'nfl',
      nameLowerToExternalPid: { 'common name': 'pid-x' },
      assets: [{ name: 'Common Name', team: 'KC', position: 'RB' }],
    })
    expect(r.resolved).toHaveLength(0)
    expect(r.unresolved[0].reason).toBe('sports_player_record_not_found')
  })

  it('returns unresolved with reason when explicit id has no sports_player_record', async () => {
    findUnique.mockResolvedValue(null)
    findFirst.mockResolvedValue(null)
    const r = await resolveTradePlayerAssets({
      sport: 'nfl',
      assets: [{ name: 'X', sportsPlayerId: 'ghost' }],
    })
    expect(r.unresolved[0].reason).toBe('sports_player_record_not_found')
  })
})
