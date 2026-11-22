// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  claim: vi.fn(),
  sweep: vi.fn(),
  finish: vi.fn(),
  session: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    automationJob: {
      updateMany: db.claim,
      findMany: db.sweep,
      findUniqueOrThrow: () => ({ id: 'job', leagueId: 'league', attemptCount: 1, maxAttempts: 8 }),
    },
    draftSession: { findFirst: db.session },
  },
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ finishDraftCompletion: db.finish }))

import { processDraftFinalizationJob, processDueDraftFinalizations } from '@/lib/live-draft-engine/DraftFinalizationJob'

describe('draft season setup jobs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.session.mockResolvedValue({ id: 'draft', status: 'completed' })
  })

  it('processes one claim when the response callback and the scheduled sweep overlap', async () => {
    db.sweep.mockResolvedValue([{ idempotencyKey: 'draft_finalization:draft' }])
    db.claim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 })
    await Promise.all([processDraftFinalizationJob('draft'), processDueDraftFinalizations()])
    expect(db.finish).toHaveBeenCalledExactlyOnceWith('league', 'draft', true, { requireSeason: true })
    expect(db.claim).toHaveBeenLastCalledWith({
      where: { id: 'job', status: 'running', startedAt: expect.any(Date) },
      data: { status: 'completed', finishedAt: expect.any(Date), lastError: null },
    })
  })

  it('leaves failed setup available to retry with its original draft identity', async () => {
    db.claim.mockResolvedValue({ count: 1 })
    db.finish.mockRejectedValue(new Error('season storage unavailable'))
    await processDraftFinalizationJob('draft')
    expect(db.claim).toHaveBeenLastCalledWith({
      where: { id: 'job', status: 'running', startedAt: expect.any(Date) },
      data: {
        status: 'pending',
        scheduledFor: expect.any(Date),
        finishedAt: null,
        lastError: 'season storage unavailable',
      },
    })
  })
})
