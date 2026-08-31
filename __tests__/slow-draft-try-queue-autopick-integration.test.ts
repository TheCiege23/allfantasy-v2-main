import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  draftSessionFindUnique: vi.fn(),
  rosterFindUnique: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  submitPick: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: hm.draftSessionFindUnique },
    roster: { findUnique: hm.rosterFindUnique },
  },
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/live-draft-engine/RosterFitValidation')>()
  return {
    ...actual,
    getAllowedPositionsAndRosterSize: hm.getAllowedPositionsAndRosterSize,
  }
})

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: hm.submitPick,
}))

// This file pulls in the live-draft engine graph (@/lib/live-draft-engine/*) behind its mocks, and
// the first test pays the whole cold Vite transform for it - measured at 7.8s of transform against
// 12.9s of test time when run alone. That fits inside the default 30s budget on an idle machine and
// does NOT fit when the suite is sharded across a loaded one: the sharded run timed out at 36.1s
// while the same test passes 2/2 in isolation.
//
// So this is a transform-cost timeout, not a logic hang, and it is the same shape already recorded
// in commissionerOsRecommendations.test.ts and league-create-defaults-api.test.ts. Raised for the
// whole file rather than the one slow test because the cost lands on whichever test runs FIRST,
// and that is an ordering detail no annotation should depend on.
vi.setConfig({ testTimeout: 60000 })

describe('tryQueueAutoPick (slow-draft worker path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
      draftEligiblePositions: new Set(['QB', 'RB', 'WR', 'TE', 'DST']),
      rosterUnionAllowedPositions: new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']),
      totalRosterSize: 16,
    })
    hm.submitPick.mockResolvedValue({ success: true })
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'user-1' })
  })

  it('skips queue rows not starter-eligible (e.g. K) and submits the first eligible player', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({
      status: 'in_progress',
      picks: [],
      queues: [
        {
          userId: 'user-1',
          order: [
            { playerName: 'Justin Tucker', position: 'K', team: 'BAL', playerId: null },
            { playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET', playerId: 'p2' },
          ],
        },
      ],
    })

    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')

    expect(result.success).toBe(true)
    expect(result.playerName).toBe('Jahmyr Gibbs')
    expect(hm.getAllowedPositionsAndRosterSize).toHaveBeenCalledWith('league-1')
    expect(hm.submitPick).toHaveBeenCalledTimes(1)
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        rosterId: 'roster-1',
        playerName: 'Jahmyr Gibbs',
        position: 'RB',
        source: 'auto',
      }),
    )
  })

  it('returns success false when the queue has no starter-eligible picks', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({
      status: 'in_progress',
      picks: [],
      queues: [
        {
          userId: 'user-1',
          order: [{ playerName: 'Only K', position: 'K', team: 'BAL', playerId: null }],
        },
      ],
    })

    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')

    expect(result.success).toBe(false)
    expect(hm.submitPick).not.toHaveBeenCalled()
  })
})
