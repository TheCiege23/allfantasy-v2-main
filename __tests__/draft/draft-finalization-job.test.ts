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

const completedAt = new Date('2026-11-22T06:00:00.000Z')
const jobKey = `draft_finalization:draft:${completedAt.getTime()}`

describe('draft season setup jobs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.session.mockResolvedValue({ id: 'draft', status: 'completed', completedAt })
  })

  it('processes one claim when the response callback and the scheduled sweep overlap', async () => {
    db.sweep.mockResolvedValue([{ idempotencyKey: jobKey }])
    db.claim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 })
    await Promise.all([processDraftFinalizationJob(jobKey), processDueDraftFinalizations()])
    expect(db.finish).toHaveBeenCalledExactlyOnceWith('league', 'draft', true, { requireSeason: true })
    expect(db.claim).toHaveBeenLastCalledWith({
      where: { id: 'job', status: 'running', startedAt: expect.any(Date) },
      data: { status: 'completed', finishedAt: expect.any(Date), lastError: null },
    })
  })

  it('leaves failed setup available to retry with its original draft identity', async () => {
    db.claim.mockResolvedValue({ count: 1 })
    db.finish.mockRejectedValue(new Error('season storage unavailable'))
    await processDraftFinalizationJob(jobKey)
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

  it('cancels an old setup job when a reset draft has completed again', async () => {
    db.claim.mockResolvedValue({ count: 1 })
    db.session.mockResolvedValue({ id: 'draft', status: 'completed', completedAt: new Date(completedAt.getTime() + 1) })
    await processDraftFinalizationJob(jobKey)
    expect(db.finish).not.toHaveBeenCalled()
    expect(db.claim).toHaveBeenLastCalledWith({
      where: { id: 'job', status: 'running', startedAt: expect.any(Date) },
      data: { status: 'cancelled', finishedAt: expect.any(Date) },
    })
  })
})
