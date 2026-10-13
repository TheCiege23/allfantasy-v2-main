// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { transferNbaSurvivorRosterPlayer } from '@/lib/survivor/transferNbaSurvivorRosterPlayer'

describe('NBA Survivor roster ownership transfer', () => {
  it('closes the former interval and creates a new bench interval at the same instant', async () => {
    const old = { id: 'row-1', rosterId: 'roster-a', playerId: 'player-1', playerName: 'Sample PG', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG', isLocked: true, injuryStatus: null, byeWeek: null, addedAt: new Date('2026-10-01T00:00:00Z'), droppedAt: null, acquisitionType: 'drafted', isKept: false }
    const tx = { redraftRosterPlayer: { findFirst: vi.fn().mockResolvedValue(old), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({}) } }
    expect(await transferNbaSurvivorRosterPlayer(tx as never, { playerId: 'player-1', fromRosterId: 'roster-a', toRosterId: 'roster-b', slotType: 'BENCH', acquisitionType: 'trade' })).toBe(1)
    const endedAt = tx.redraftRosterPlayer.updateMany.mock.calls[0][0].data.droppedAt as Date
    const created = tx.redraftRosterPlayer.create.mock.calls[0][0].data
    expect(created).toMatchObject({ rosterId: 'roster-b', playerId: 'player-1', slotType: 'BENCH', acquisitionType: 'trade', isLocked: false, addedAt: endedAt })
    expect(old.slotType).toBe('PG')
    expect(old.rosterId).toBe('roster-a')
  })
})
