import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The grounding loader reads the session's own board and picks: taken players leave the pool and
 * only the viewer's picks (currentOwnerId) are their roster. Any failure is the honest
 * "unavailable" grounding, never a throw.
 */

const prismaMock = vi.hoisted(() => ({
  draftRoomStateRow: { findUnique: vi.fn() },
  draftRoomPickRecord: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const boardMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/draft/sleeperDraftBoard', () => ({ loadSleeperAdpBoard: boardMock, MAX_BOARD_SIZE: 500 }))

import { loadDraftEngineGrounding } from '@/lib/draft/engineGroundingLoader'

const BOARD = [
  { id: 's1', name: 'Back One', position: 'RB', team: 'AAA', adp: 1 },
  { id: 's2', name: 'Receiver One', position: 'WR', team: 'BBB', adp: 2 },
  { id: 's3', name: 'Back Two', position: 'RB', team: 'CCC', adp: 5 },
  { id: 's4', name: 'Passer One', position: 'QB', team: 'EEE', adp: 20 },
]

beforeEach(() => {
  prismaMock.draftRoomStateRow.findUnique.mockReset().mockResolvedValue({ numTeams: 10 })
  prismaMock.draftRoomPickRecord.findMany.mockReset().mockResolvedValue([
    { playerId: 's1', playerName: 'Back One', position: 'RB', team: 'AAA', currentOwnerId: 'cpu-1' },
    { playerId: 's2', playerName: 'Receiver One', position: 'WR', team: 'BBB', currentOwnerId: 'u1' },
  ])
  boardMock.mockReset().mockResolvedValue(BOARD)
})

describe('loadDraftEngineGrounding', () => {
  it('removes taken players and scores the viewer’s own roster', async () => {
    const g = await loadDraftEngineGrounding({ sessionId: 'mock:room1', userId: 'u1' })
    expect(g.available).toBe(true)
    expect([...g.poolNames].sort()).toEqual(['back two', 'passer one'])
    expect(g.promptSection).toContain('DRAFT ENGINE (pick 3, 10 teams)')
    expect(prismaMock.draftRoomPickRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { roomId: 'room1' } }))
  })

  it('is unavailable — never throws — for a bad session, a non-NFL sport or a read failure', async () => {
    expect((await loadDraftEngineGrounding({ sessionId: 'nonsense', userId: 'u1' })).available).toBe(false)
    expect((await loadDraftEngineGrounding({ sessionId: 'mock:room1', userId: 'u1', sport: 'NBA' })).available).toBe(false)
    boardMock.mockRejectedValue(new Error('db down'))
    expect((await loadDraftEngineGrounding({ sessionId: 'mock:room1', userId: 'u1' })).available).toBe(false)
  })
})
