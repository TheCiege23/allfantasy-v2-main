import { describe, expect, it, vi } from 'vitest'
import { createDraftCollegeRight, removeDraftCollegeRight, transferDraftCollegeRight } from '@/lib/devy/nbaDraftRights'
const pick = { playerId: 'espn:ncaab:12', rosterId: 'a', assetType: 'c2c_college', pickMetadata: { draftCollegeRightsId: 'right-12' } }
const mockDb = () => ({ devyRights: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'new-right' }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }) as any

describe('college draft ownership correction', () => {
  it('creates rights only when the player is unowned', async () => {
    const db = mockDb()
    await expect(createDraftCollegeRight(db, { leagueId: 'l', rosterId: 'a', playerId: pick.playerId, assetType: 'c2c_college' })).resolves.toBe('new-right')
    db.devyRights.findFirst.mockResolvedValue({ id: 'elsewhere' })
    await expect(createDraftCollegeRight(db, { leagueId: 'l', rosterId: 'b', playerId: pick.playerId, assetType: 'c2c_college' })).rejects.toThrow('already has rights')
  })
  it('removes only the exact active draft-created right', async () => {
    const db = mockDb()
    await removeDraftCollegeRight(db, 'l', pick)
    expect(db.devyRights.deleteMany).toHaveBeenCalledWith({ where: { id: 'right-12', leagueId: 'l', rosterId: 'a', devyPlayerId: pick.playerId, state: 'COLLEGE_ACTIVE' } })
    db.devyRights.deleteMany.mockResolvedValue({ count: 0 })
    await expect(removeDraftCollegeRight(db, 'l', pick)).rejects.toThrow('ownership changed')
    await expect(removeDraftCollegeRight(db, 'l', { ...pick, pickMetadata: {} })).rejects.toThrow('no verifiable')
  })
  it('transfers only the matching right and refuses conflicts', async () => {
    const db = mockDb()
    await transferDraftCollegeRight(db, 'l', pick, 'b')
    expect(db.devyRights.updateMany).toHaveBeenCalledWith({ where: { id: 'right-12', leagueId: 'l', rosterId: 'a', devyPlayerId: pick.playerId, state: 'COLLEGE_ACTIVE' }, data: { rosterId: 'b' } })
    db.devyRights.findFirst.mockResolvedValue({ id: 'another' })
    await expect(transferDraftCollegeRight(db, 'l', pick, 'b')).rejects.toThrow('conflicting ownership')
  })
})
