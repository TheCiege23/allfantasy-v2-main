import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDraftQueueForUser } from '@/lib/draft-room/loadDraftQueueForUser'

const db = vi.hoisted(() => ({
  session: vi.fn(),
  row: vi.fn(),
  update: vi.fn(),
  pools: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  draftSession: { findFirst: db.session },
  draftQueue: { findUnique: db.row, updateMany: db.update },
} }))
vi.mock('@/lib/league/player-pools/load', () => ({ loadPlayerPools: db.pools }))
vi.mock('@/lib/league/teamScopedKey', () => ({ draftQueueKeyForUser: async () => 'queue-B' }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: async () => 'B' }))

const athlete = { playerName: 'Jaylen Waddle', position: 'WR', team: 'MIA' }
beforeEach(() => {
  vi.clearAllMocks()
  db.row.mockResolvedValue({ id: 'row', updatedAt: new Date(0), order: [athlete] })
  db.session.mockResolvedValue({ id: 'board', picks: [{ ...athlete, rosterId: 'A' }] })
  db.pools.mockResolvedValue({ A: 'east', B: 'west' })
})

describe('reading a franchise draft queue', () => {
  it('keeps a player taken in a different pool across reads', async () => {
    for (let i = 0; i < 2; i++) {
      const saved = await loadDraftQueueForUser('league', 'manager')
      expect(saved.queue.map(entry => entry.playerName)).toEqual([athlete.playerName])
      expect(saved.removedUnavailable).toBe(0)
    }
    expect(db.update).not.toHaveBeenCalled()
  })

  it.each([null, { A: 'east', B: 'east' }])('prunes a player taken in the same pool and protects concurrent queue edits', async pools => {
    db.pools.mockResolvedValue(pools)
    const saved = await loadDraftQueueForUser('league', 'manager')
    expect(saved).toEqual({ queue: [], removedUnavailable: 1 })
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'row', updatedAt: new Date(0) } }))
  })
})
