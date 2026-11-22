import { describe, expect, it, vi } from 'vitest'
import { syncAfRosterLineupAssignments } from '@/lib/roster-lineup-engine/lineupAssignmentSync'
import { weekSlotType } from '@/lib/redraft/weekLineupSlots'

describe('basketball campus weekly history', () => {
  it('records campus starters for the week while keeping them in devy for pro scoring', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 })
    const db = { afRosterLineupAssignment: { deleteMany: vi.fn(), createMany } } as any
    await syncAfRosterLineupAssignments({ leagueId: 'l', rosterId: 'r', season: 2026, week: 2, playerData: { lineup_sections: { starters: [{ id: 'pro', position: 'PG' }], devy: [{ id: 'espn:ncaab:12', position: 'G' }], campus: ['espn:ncaab:12'] } } }, db)
    expect(createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ playerId: 'espn:ncaab:12', section: 'campus' }), expect.objectContaining({ playerId: 'pro', section: 'starters' })]) })
    const week = new Map([['rr', new Map([['espn:ncaab:12', 'campus']])]])
    expect(weekSlotType({ rosterId: 'rr', playerId: 'espn:ncaab:12', position: 'G', slotType: 'devy' }, week)).toBe('devy')
  })
})
