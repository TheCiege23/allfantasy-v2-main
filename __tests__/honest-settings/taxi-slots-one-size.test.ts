/**
 * One taxi squad size (lib/taxi/taxiSlotsSync.ts, 2026-11-15): the league column roster legality reads and the dynasty
 * config taxi moves read are written together, from either screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ dynastyLeagueConfig: { updateMany: vi.fn(async () => ({ count: 1 })) }, league: { update: vi.fn(async () => ({})) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { syncTaxiSlotsToDynastyConfig, syncTaxiSlotsToLeague } from '@/lib/taxi/taxiSlotsSync'

beforeEach(() => vi.clearAllMocks())

describe('a taxi size saved in one place reaches the other', () => {
  it('settings window → dynasty config, only where one exists', async () => {
    await syncTaxiSlotsToDynastyConfig('L1', 6)
    expect(db.dynastyLeagueConfig.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { taxiSlots: 6 } })
  })
  it('dynasty settings → league column', async () => {
    await syncTaxiSlotsToLeague('L1', '3')
    expect(db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { taxiSlots: 3 } })
  })
  it('an unreadable size writes nothing, and a failed write never fails the save', async () => {
    await syncTaxiSlotsToLeague('L1', 'many')
    await syncTaxiSlotsToDynastyConfig('L1', -2)
    expect(db.league.update).not.toHaveBeenCalled()
    expect(db.dynastyLeagueConfig.updateMany).not.toHaveBeenCalled()
    db.league.update.mockRejectedValueOnce(new Error('db down'))
    await expect(syncTaxiSlotsToLeague('L1', 2)).resolves.toBeUndefined()
  })
})
