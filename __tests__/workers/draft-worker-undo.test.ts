/**
 * DraftWorker.undoPick (/api/draft/[draftId]/undo), 2026-11-15.
 *
 * 🛑 It deleted every pick from the named pick onward IN WHATEVER SESSION THAT PICK BELONGED TO — another league's
 * draft included — reopened a completed draft, refunded nothing and recorded nothing. It now undoes only this draft's
 * last pick, through undoLastPick (which refuses a completed draft and reverses the pick's effects), and logs it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  context: vi.fn(),
  undoLastPick: vi.fn(),
  logAction: vi.fn(async () => ({ id: 'a' })),
  pickFind: vi.fn(),
  sessionFind: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftPick: { findUnique: h.pickFind, deleteMany: h.deleteMany },
    draftSession: { findFirst: h.sessionFind },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))
vi.mock('@/lib/draft/resolve-draft-context', () => ({ assertLiveDraftContext: h.context }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: async () => true }))
vi.mock('@/lib/draft/draft-stream-store', () => ({ draftStreamStore: { publish: vi.fn() } }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: async () => null,
  completeDraftSession: vi.fn(), pauseDraftSession: vi.fn(), resetTimer: vi.fn(),
  resumeDraftSession: vi.fn(), startDraftSession: vi.fn(), undoLastPick: h.undoLastPick,
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: vi.fn() }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: async () => null }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: async () => [] }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: vi.fn(), normalizeDraftPoolNameForDedupe: vi.fn() }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn() }))
vi.mock('@/lib/post-draft', () => ({ buildDeterministicPostDraftRecap: vi.fn() }))
vi.mock('@/lib/draft-room', () => ({ getRosterSlotLabelsForLeagueDraft: vi.fn() }))
vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({ draftPoolRowMatchesEligiblePositions: vi.fn() }))
vi.mock('@/lib/league/league-draft-template-payload', () => ({ getDraftEligiblePositionsFromPayload: vi.fn(), getLeagueDraftTemplatePayload: vi.fn() }))
vi.mock('@/lib/draft-ai-engine', () => ({ runDraftAIAssist: vi.fn() }))
vi.mock('@/lib/workers/adp-blender', () => ({ blendAdpRankings: vi.fn(), getAdpRankings: vi.fn(), setCustomAdpRankings: vi.fn() }))
vi.mock('@/lib/workers/lottery-engine', () => ({ assignDraftOrder: vi.fn(), runDraftLottery: vi.fn() }))
vi.mock('@/lib/workers/auction-engine', () => ({ closeDraftAuction: vi.fn(), nominateDraftPlayer: vi.fn(), placeDraftBid: vi.fn(), resolveSportsPlayerRow: vi.fn() }))

import { DraftWorker } from '@/lib/workers/draft-worker'

const worker = () => {
  const w = new DraftWorker({ viewerUserId: 'commish' })
  ;(w as unknown as { broadcastDraftState: () => Promise<void> }).broadcastDraftState = async () => {}
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  h.context.mockResolvedValue({ leagueId: 'L1', sport: 'NFL' })
  h.sessionFind.mockResolvedValue({ id: 's1', picks: [{ id: 'p12' }] })
  h.undoLastPick.mockResolvedValue(true)
})

describe('undoing a pick from the worker endpoint', () => {
  it('undoes this draft\'s last pick through undoLastPick, with the commissioner recorded', async () => {
    h.pickFind.mockResolvedValue({ id: 'p12', sessionId: 's1', overall: 12 })
    await worker().undoPick('draft-1', 'p12', 'commish')
    expect(h.undoLastPick).toHaveBeenCalledWith('L1', { actorUserId: 'commish' })
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', userId: 'commish', actionType: 'commissioner_undo_draft_pick' }))
    expect(h.deleteMany).not.toHaveBeenCalled()
  })

  it('REGRESSION: a pick from another draft is not found, and nothing is deleted', async () => {
    h.pickFind.mockResolvedValue({ id: 'other', sessionId: 'someone-elses-session', overall: 1 })
    await expect(worker().undoPick('draft-1', 'other', 'commish')).rejects.toThrow('Pick not found')
    expect(h.undoLastPick).not.toHaveBeenCalled()
    expect(h.deleteMany).not.toHaveBeenCalled()
  })

  it('an earlier pick is refused rather than wiping every pick after it', async () => {
    h.pickFind.mockResolvedValue({ id: 'p3', sessionId: 's1', overall: 3 })
    await expect(worker().undoPick('draft-1', 'p3', 'commish')).rejects.toThrow('Only the most recent pick can be undone')
    expect(h.undoLastPick).not.toHaveBeenCalled()
  })

  it('a completed draft (undoLastPick says no) is refused and not logged', async () => {
    h.pickFind.mockResolvedValue({ id: 'p12', sessionId: 's1', overall: 12 })
    h.undoLastPick.mockResolvedValue(false)
    await expect(worker().undoPick('draft-1', 'p12', 'commish')).rejects.toThrow('This pick cannot be undone')
    expect(h.logAction).not.toHaveBeenCalled()
  })
})
