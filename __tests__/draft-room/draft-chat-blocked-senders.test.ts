// @vitest-environment node
/**
 * The draft room's chat read hides people the viewer blocked — league chat's GET already did
 * (app/api/league/chat/route.ts); the draft room read the same rows through
 * draftRoomChatWireLoad and did not. And a failed block-list read must never become an
 * unfiltered transcript: the GET answers 503, while the live-sync bundle leaves chat OUT and
 * keeps the draft itself (clock, board, queue) running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const blockList = vi.fn<(userId: string) => Promise<string[]>>()

vi.mock('@/lib/moderation/BlockUserService', async () => {
  class BlockListUnavailableError extends Error {}
  return {
    BlockListUnavailableError,
    getBlockedUserIdsForRead: (userId: string) => blockList(userId),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: vi.fn(async () => ({ status: 'in_progress' })) } } }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({ liveDraftChatSyncEnabled: false })),
}))

const row = (id: string, senderUserId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  senderUserId,
  senderName: senderUserId ?? 'Draft room',
  body: `${id} body`,
  messageType: senderUserId ? 'text' : 'draft_pick',
  createdAt: '2026-09-28T20:00:00.000Z',
  metadata: null,
  ...extra,
})
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => [row('from-sam', 'sam'), row('from-me', 'me'), row('pick-1', null), row('from-jo', 'jo')]),
}))

import { loadDraftChatWireMessages } from '@/lib/draft-room/draftRoomChatWireLoad'
import { BlockListUnavailableError } from '@/lib/moderation/BlockUserService'

/* mockClear + a default, NOT mockReset: after mockReset, a rejection is reported as a test failure
   even when the code under test passes it on correctly (a known vitest quirk, measured here). */
beforeEach(() => {
  blockList.mockClear()
  blockList.mockImplementation(async () => [])
})

describe('draft chat read — blocked senders', () => {
  it("drops a blocked drafter's messages and keeps everyone else's", async () => {
    blockList.mockResolvedValue(['sam'])
    const { messages } = await loadDraftChatWireMessages('L1', 'me', { limit: 80 })
    const ids = messages.map((m) => m.id)
    expect(ids).not.toContain('from-sam')
    expect(ids).toEqual(expect.arrayContaining(['from-me', 'from-jo', 'pick-1']))
  })

  it('never hides the viewer, even if the viewer is on their own list', async () => {
    blockList.mockResolvedValue(['me'])
    const { messages } = await loadDraftChatWireMessages('L1', 'me', { limit: 80 })
    expect(messages.map((m) => m.id)).toContain('from-me')
  })

  it('[control] with nobody blocked, every row comes through', async () => {
    blockList.mockResolvedValue([])
    const { messages } = await loadDraftChatWireMessages('L1', 'me', { limit: 80 })
    expect(messages.map((m) => m.id).sort()).toEqual(['from-jo', 'from-me', 'from-sam', 'pick-1'])
  })

  it('a failed block-list read THROWS — it never becomes an unfiltered transcript', async () => {
    /* An async implementation, not mockRejectedValue: after mockReset, a pre-rejected value is
       reported as a failure even when the code under test handles it (a known vitest quirk). */
    blockList.mockImplementation(async () => {
      throw new BlockListUnavailableError('down')
    })
    await expect(loadDraftChatWireMessages('L1', 'me', { limit: 80 })).rejects.toBeInstanceOf(BlockListUnavailableError)
  })
})
