import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'

vi.mock('server-only', () => ({}))
const season = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }))
const players = vi.hoisted(() => ({ findMany: vi.fn() }))
const drafts = vi.hoisted(() => ({ findFirst: vi.fn() }))
const picks = vi.hoisted(() => ({ findMany: vi.fn() }))
const rosters = vi.hoisted(() => ({ findMany: vi.fn() }))
const powers = vi.hoisted(() => ({ count: vi.fn(), createMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorGuillotineLeague: season,
  player: players, draftSession: drafts, draftPick: picks, roster: rosters,
  survivorGuillotinePower: powers,
  $transaction: (fn: (tx: unknown) => unknown) => fn({ survivorGuillotineLeague: season,
    survivorGuillotinePower: powers }),
} }))

import { seedSGLiveDraftPowers } from '@/lib/survivor-guillotine/live'

describe('native draft provider IDs on hidden idols', () => {
  beforeEach(() => {
    season.findUnique.mockReset().mockResolvedValue({ status: 'setup', revision: 1,
      config: defaultSGConfig() })
    season.updateMany.mockReset().mockResolvedValue({ count: 1 })
    players.findMany.mockReset().mockResolvedValue([])
    drafts.findFirst.mockReset().mockResolvedValue({ id: 'draft' })
    picks.findMany.mockReset().mockResolvedValue([{ playerId: '9221' }, { playerId: '9509' }])
    rosters.findMany.mockReset().mockResolvedValue([{ playerData: { players: ['9221'] } },
      { playerData: { players: ['9509'] } }])
    powers.count.mockReset().mockResolvedValue(0)
    powers.createMany.mockReset()
  })

  it('seeds powers on drafted and rostered provider IDs absent from Player', async () => {
    const result = await seedSGLiveDraftPowers('league', ['9221', '9509'], 2)
    expect(result.count).toBe(2)
    const rows = powers.createMany.mock.calls[0][0].data
    expect(new Set(rows.map((row: { playerId: string }) => row.playerId))).toEqual(new Set(['9221', '9509']))
  })

  it('rejects a provider ID without a completed pick and roster owner', async () => {
    picks.findMany.mockResolvedValue([{ playerId: '9221' }])
    await expect(seedSGLiveDraftPowers('league', ['9221', '9509'], 2)).rejects.toThrow('missing player')
    expect(powers.createMany).not.toHaveBeenCalled()
  })
})
