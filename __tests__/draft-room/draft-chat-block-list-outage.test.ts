// @vitest-environment node
/**
 * When the block list cannot be read, the draft room's chat is never served unfiltered — and the
 * draft itself keeps running. The chat loader throws BlockListUnavailableError; this pins what
 * each of its two callers does with it:
 *   - GET /api/leagues/[leagueId]/draft/chat answers 503 (league chat's GET does the same);
 *   - the live-sync bundle, one Promise.all with the queue and the session, leaves `messages` OUT
 *     instead of failing — so a block-list outage cannot stop the pick clock or the board.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const loadChat = vi.fn()

vi.mock('@/lib/moderation/BlockUserService', async () => {
  class BlockListUnavailableError extends Error {}
  return { BlockListUnavailableError, getBlockedUserIdsForRead: vi.fn(async () => []) }
})
vi.mock('@/lib/draft-room/draftRoomChatWireLoad', () => ({ loadDraftChatWireMessages: (...a: unknown[]) => loadChat(...a) }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: async () => true,
  getCurrentUserRosterIdForLeague: async () => null,
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: async () => ({ liveDraftChatSyncEnabled: false }),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: vi.fn() }))
const UPDATED = new Date('2026-09-28T20:00:00.000Z')
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: async () => ({ status: 'in_progress', updatedAt: UPDATED }) } } }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: () => ({ anyAi: false }) }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: async () => [] }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: async () => null }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({
  repairDraftCompletionIfBoardFull: async () => undefined,
  syncPostDraftArtifactsIfCompletedThrottled: async () => undefined,
}))
vi.mock('@/lib/draft-room/loadDraftQueueForUser', () => ({ loadDraftQueueForUser: async () => ({ queue: ['q1'] }) }))

import { BlockListUnavailableError } from '@/lib/moderation/BlockUserService'
import { buildDraftLiveSyncPayload } from '@/lib/draft-room/buildDraftLiveSyncPayload'

beforeEach(() => {
  loadChat.mockClear()
  loadChat.mockImplementation(async () => ({ messages: [{ id: 'm1' }], syncActive: false }))
})

const outage = () =>
  loadChat.mockImplementation(async () => {
    throw new BlockListUnavailableError('block list down')
  })

async function getChat() {
  const { GET } = await import('@/app/api/leagues/[leagueId]/draft/chat/route')
  const res = await GET(createMockNextRequest('http://localhost/api/leagues/l1/draft/chat') as never, {
    params: Promise.resolve({ leagueId: 'l1' }),
  })
  return { status: res.status, data: (await res.json()) as { messages?: unknown[]; error?: string } }
}

describe('draft chat GET — block list outage', () => {
  it('answers 503 and serves no transcript', async () => {
    outage()
    const { status, data } = await getChat()
    expect(status).toBe(503)
    expect(data.messages).toBeUndefined()
  })

  it('[control] a readable block list serves the messages', async () => {
    const { status, data } = await getChat()
    expect(status).toBe(200)
    expect(data.messages).toEqual([{ id: 'm1' }])
  })
})

describe('draft live-sync bundle — block list outage', () => {
  const opts = { since: UPDATED.toISOString(), includeQueue: true, includeChat: true }

  it('still returns the draft (the queue arrives) and leaves chat out', async () => {
    outage()
    const wire = await buildDraftLiveSyncPayload('l1', 'u1', opts)
    expect(wire.queue).toEqual(['q1'])
    expect('messages' in wire).toBe(false)
  })

  it('[control] a readable block list carries the chat', async () => {
    const wire = await buildDraftLiveSyncPayload('l1', 'u1', opts)
    expect(wire.messages).toEqual([{ id: 'm1' }])
  })

  it('any OTHER chat failure still fails the bundle — only the block-list outage is absorbed', async () => {
    loadChat.mockImplementation(async () => {
      throw new Error('database gone')
    })
    await expect(buildDraftLiveSyncPayload('l1', 'u1', opts)).rejects.toThrow('database gone')
  })
})
