/**
 * League chat channels — POST stamps the room server-side (lib/league-chat/leagueChatChannels.ts).
 * Mocks copied from chat-s4-client-metadata-league-chat.test.ts; what is asserted is what reaches
 * createLeagueChatMessage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  created: [] as Array<{ body: string; opts: Record<string, unknown> }>,
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'member-1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: async () => ({ role: 'member' }) }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: async () => false }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: async () => [] }))
vi.mock('@/lib/big-brother/chimmyCommandHandler', () => ({
  processBigBrotherLeagueChatInput: async () => ({ outcome: 'post_user', chimmyMessages: [] }),
}))
vi.mock('@/lib/idp/idpChimmyLeagueChat', () => ({ processIdpLeagueChatInput: async () => null }))
vi.mock('@/lib/devy/devyChimmyLeagueChat', () => ({ processDevyLeagueChatInput: async () => null }))
vi.mock('@/lib/c2c/c2cChimmyLeagueChat', () => ({ processC2cLeagueChatInput: async () => null }))
vi.mock('@/lib/chat-core/chatPresence', () => ({ markViewingChat: vi.fn(), readChatPresence: vi.fn() }))
vi.mock('@/lib/chat-core/leagueChatRead', () => ({ markLeagueChatRead: vi.fn() }))
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: vi.fn() }))
vi.mock('@/lib/league-chat/tradeChatCards', () => ({ syncTradeCardsForLeague: vi.fn() }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => undefined }))
vi.mock('@/lib/chat-core/resolveMentionTargets', () => ({ resolveLeagueMentionIds: async () => [] }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: async () => [] }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', () => ({ queueLeagueChatNotifications: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: async () => ({ displayName: 'Casey', username: 'casey' }) },
    league: { findUnique: async () => ({ userId: 'owner' }) },
  },
}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'member-1' }) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/league-chat/LeagueMessageComposer', () => ({
  validateMessageBody: (body: string) => ({ valid: body.trim().length > 0 }),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => []),
  createLeagueChatMessage: async (_leagueId: string, _userId: string, body: string, opts: Record<string, unknown>) => {
    h.created.push({ body, opts })
    return {
      id: `m-${h.created.length}`,
      senderUserId: 'member-1',
      senderName: 'Casey',
      senderAvatarUrl: null,
      body,
      createdAt: '2026-09-25T12:00:00.000Z',
      messageType: (opts.type as string) ?? 'text',
      metadata: opts.metadata ?? null,
    }
  },
}))

async function postLeagueChat(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/league/chat/route')
  return POST(createMockNextRequest('http://localhost/api/league/chat', { method: 'POST', body }) as never)
}

function storedMetadata(): Record<string, unknown> | null {
  expect(h.created).toHaveLength(1)
  return (h.created[0]!.opts.metadata ?? null) as Record<string, unknown> | null
}

beforeEach(() => {
  h.created = []
})

describe('league chat channels — POST', () => {
  it('stamps a validated leagueChannel onto the stored metadata', async () => {
    const res = await postLeagueChat({ leagueId: 'L1', message: 'trash incoming', leagueChannel: 'trash-talk' })
    expect(res.status).toBe(200)
    expect(storedMetadata()).toEqual({ leagueChannel: 'trash-talk' })
  })

  it('#general and unknown rooms store no key, so old rows and new general rows read the same', async () => {
    await postLeagueChat({ leagueId: 'L1', message: 'hi', leagueChannel: 'general' })
    expect(storedMetadata()?.leagueChannel).toBeUndefined()
    h.created = []
    await postLeagueChat({ leagueId: 'L1', message: 'hi', leagueChannel: 'secret-room' })
    expect(storedMetadata()?.leagueChannel).toBeUndefined()
  })

  it('a client cannot set the room through metadata; only the validated field counts', async () => {
    await postLeagueChat({ leagueId: 'L1', message: 'hi', metadata: { leagueChannel: 'trades' } })
    expect(storedMetadata()?.leagueChannel).toBeUndefined()
  })
})
