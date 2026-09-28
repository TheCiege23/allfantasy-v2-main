/**
 * `/api/league/chat` GET — the transcript the comms drawer reads — never applied blocks, while the
 * shared-thread view of the same league hid blocked users' messages. It now uses the same
 * fail-closed lookup (`getBlockedUserIdsForRead`): blocked senders are hidden, the viewer's own
 * messages always stay, and if the list cannot be read (after one retry) the route answers 503
 * rather than an unfiltered transcript.
 *
 * The REAL route, REAL BlockUserService and REAL filter run; the block table is an in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  blocks: [] as Array<{ blockerUserId: string; blockedUserId: string }>,
  failures: 0,
  messages: [] as Array<Record<string, unknown>>,
  markRead: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'viewer' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: async () => ({ role: 'member' }) }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: async () => false }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: async () => [] }))
vi.mock('@/lib/big-brother/chimmyCommandHandler', () => ({ processBigBrotherLeagueChatInput: vi.fn() }))
vi.mock('@/lib/idp/idpChimmyLeagueChat', () => ({ processIdpLeagueChatInput: vi.fn() }))
vi.mock('@/lib/devy/devyChimmyLeagueChat', () => ({ processDevyLeagueChatInput: vi.fn() }))
vi.mock('@/lib/c2c/c2cChimmyLeagueChat', () => ({ processC2cLeagueChatInput: vi.fn() }))
vi.mock('@/lib/chat-core/chatPresence', () => ({ markViewingChat: vi.fn(), readChatPresence: vi.fn(async () => []) }))
vi.mock('@/lib/chat-core/leagueChatRead', () => ({ markLeagueChatRead: h.markRead }))
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: vi.fn() }))
vi.mock('@/lib/league-chat/tradeChatCards', () => ({ syncTradeCardsForLeague: vi.fn() }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: vi.fn() }))
vi.mock('@/lib/chat-core/resolveMentionTargets', () => ({ resolveLeagueMentionIds: vi.fn() }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', () => ({ queueLeagueChatNotifications: vi.fn() }))
vi.mock('@/lib/league-chat/readLeagueDraftLink', () => ({ readLeagueDraftLink: async () => null }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => h.messages),
  createLeagueChatMessage: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: async () => ({ displayName: 'Viewer', username: 'viewer' }) },
    platformBlockedUser: {
      findMany: async ({ where }: { where: { blockerUserId: string } }) => {
        if (h.failures > 0) {
          h.failures -= 1
          throw new Error('connection reset')
        }
        return h.blocks.filter((b) => b.blockerUserId === where.blockerUserId)
      },
    },
  },
}))

import { GET } from '@/app/api/league/chat/route'

function msg(id: string, senderUserId: string | null) {
  return { id, senderUserId, senderName: id, senderAvatarUrl: null, body: `text ${id}`, createdAt: '2026-09-25T12:00:00.000Z', messageType: 'text' }
}

async function read(extra = '') {
  const res = await GET(createMockNextRequest(`http://localhost/api/league/chat?leagueId=L1${extra}`) as never)
  const json = (await res.json()) as { messages?: Array<{ id: string }>; error?: string }
  return { status: res.status, ids: json.messages?.map((m) => m.id), json }
}

beforeEach(() => {
  h.blocks = []
  h.failures = 0
  h.markRead.mockReset()
  h.messages = [msg('from-troll', 'troll'), msg('from-friend', 'friend'), msg('mine', 'viewer'), msg('system', null)]
})

describe('league chat GET applies the viewer’s blocks', () => {
  it('hides messages from someone the viewer blocked', async () => {
    h.blocks = [{ blockerUserId: 'viewer', blockedUserId: 'troll' }]
    const { status, ids } = await read()
    expect(status).toBe(200)
    expect(ids).toEqual(['from-friend', 'mine', 'system'])
  })

  it("does not hide anything because SOMEONE ELSE blocked a sender", async () => {
    h.blocks = [{ blockerUserId: 'friend', blockedUserId: 'troll' }]
    expect((await read()).ids).toEqual(['from-troll', 'from-friend', 'mine', 'system'])
  })

  it("always keeps the viewer's own messages", async () => {
    h.blocks = [{ blockerUserId: 'viewer', blockedUserId: 'viewer' }]
    expect((await read()).ids).toContain('mine')
  })

  it('refuses (503) instead of serving an unfiltered transcript when the block list cannot be read', async () => {
    h.blocks = [{ blockerUserId: 'viewer', blockedUserId: 'troll' }]
    h.failures = 2
    const { status, json } = await read('&markRead=1')
    expect(status).toBe(503)
    expect(json.messages).toBeUndefined()
    // A refused read is not a read: nothing is marked seen.
    expect(h.markRead).not.toHaveBeenCalled()
  })

  it('rides out a single blip with one retry', async () => {
    h.blocks = [{ blockerUserId: 'viewer', blockedUserId: 'troll' }]
    h.failures = 1
    expect((await read()).ids).toEqual(['from-friend', 'mine', 'system'])
  })
})
