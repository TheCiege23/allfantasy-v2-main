import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ repair: vi.fn(), sync: vi.fn(), findSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: mock.findSession } } }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({
  repairDraftCompletionIfBoardFull: mock.repair, syncPostDraftArtifactsIfCompletedThrottled: mock.sync,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: vi.fn() }))
vi.mock('@/lib/draft-room/loadDraftQueueForUser', () => ({ loadDraftQueueForUser: vi.fn() }))
vi.mock('@/lib/draft-room/draftRoomChatWireLoad', () => ({ loadDraftChatWireMessages: vi.fn() }))

import { buildDraftLiveSyncPayload } from '@/lib/draft-room/buildDraftLiveSyncPayload'

describe('live draft recovery', () => {
  it('returns clock state while one recovery check is still running', async () => {
    const updatedAt = new Date('2026-11-21T14:00:00Z')
    mock.findSession.mockResolvedValue({ status: 'in_progress', updatedAt })
    let complete = () => {}
    const completion = new Promise<boolean>(resolve => { complete = () => resolve(false) })
    mock.repair.mockReturnValue(completion)
    try {
      const opts = { since: updatedAt.toISOString(), includeQueue: false, includeChat: false }
      const polls = await Promise.all([
        buildDraftLiveSyncPayload('test-league', 'first', opts),
        buildDraftLiveSyncPayload('test-league', 'second', opts),
      ])
      expect(polls).toEqual(Array.from({ length: 2 }, () => ({
        leagueId: 'test-league', updated: false, updatedAt: opts.since, session: null,
      })))
      expect(mock.repair).toHaveBeenCalledTimes(1)
      expect(mock.sync).not.toHaveBeenCalled()
    } finally {
      complete()
    }
  })
})
