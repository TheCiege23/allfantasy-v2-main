import { beforeEach, describe, expect, it, vi } from 'vitest'

const { draftFindUnique, rosterFindUnique, submitPickMock } = vi.hoisted(() => ({
  draftFindUnique: vi.fn(),
  rosterFindUnique: vi.fn(),
  submitPickMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: (...a: unknown[]) => draftFindUnique(...a) },
    roster: { findUnique: (...a: unknown[]) => rosterFindUnique(...a) },
  },
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: (...a: unknown[]) => submitPickMock(...a),
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  getAllowedPositionsAndRosterSize: vi.fn().mockResolvedValue({ draftEligiblePositions: null }),
}))

import { tryQueueAutoPick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    leagueId: 'league-1',
    status: 'in_progress',
    draftType: 'snake',
    picks: [],
    queues: [
      {
        userId: 'user-9',
        order: [{ playerName: 'Test Player', position: 'WR', team: 'DAL', playerId: 'pid-1' }],
      },
    ],
    ...overrides,
  }
}

describe('tryQueueAutoPick', () => {
  beforeEach(() => {
    draftFindUnique.mockReset()
    rosterFindUnique.mockReset()
    submitPickMock.mockReset()
  })

  it('submits first queue player when on-clock roster maps to queue user (queue-first)', async () => {
    draftFindUnique.mockResolvedValue(baseSession())
    rosterFindUnique.mockResolvedValue({ platformUserId: 'user-9' })
    submitPickMock.mockResolvedValue({ success: true })

    const out = await tryQueueAutoPick('league-1', 'roster-a')
    expect(out.success).toBe(true)
    expect(out.playerName).toBe('Test Player')
    expect(submitPickMock).toHaveBeenCalledTimes(1)
    const arg = submitPickMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.expectedOverall).toBe(1)
    expect(arg.source).toBe('auto')
  })

  it('returns false when queue is empty', async () => {
    draftFindUnique.mockResolvedValue(baseSession({ queues: [] }))
    rosterFindUnique.mockResolvedValue({ platformUserId: 'user-9' })

    const out = await tryQueueAutoPick('league-1', 'roster-a')
    expect(out.success).toBe(false)
    expect(submitPickMock).not.toHaveBeenCalled()
  })

  it('stops on stale overall (no further queue attempts)', async () => {
    draftFindUnique.mockResolvedValue(baseSession())
    rosterFindUnique.mockResolvedValue({ platformUserId: 'user-9' })
    submitPickMock.mockResolvedValue({ success: false, code: 'DRAFT_PICK_STALE_OVERALL' })

    const out = await tryQueueAutoPick('league-1', 'roster-a')
    expect(out.success).toBe(false)
    expect(submitPickMock).toHaveBeenCalledTimes(1)
  })

  it('returns false when roster has no platform user (orphan-only path)', async () => {
    draftFindUnique.mockResolvedValue(baseSession())
    rosterFindUnique.mockResolvedValue({ platformUserId: 'orphan-xyz' })

    const out = await tryQueueAutoPick('league-1', 'roster-a')
    expect(out.success).toBe(false)
    expect(submitPickMock).not.toHaveBeenCalled()
  })
})
