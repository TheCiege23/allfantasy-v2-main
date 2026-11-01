// @vitest-environment node
/**
 * In a Survivor league's chat, a private @Chimmy rules question goes to the Survivor host (answered
 * from the league's settings); a fantasy question still goes to general Chimmy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  stored: [] as Array<Record<string, unknown>>,
  sender: { id: 'member-1', username: 'casey', displayName: 'Casey', avatarUrl: null as string | null },
  editTarget: null as null | { id: string; metadata: unknown },
  update: vi.fn(async () => ({ id: 'm-1' })),
  general: vi.fn(async () => 'general answer'),
  survivorHost: vi.fn(async () => 'survivor answer'),
  isSurvivor: vi.fn(async () => true),
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
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: h.general }))
vi.mock('@/lib/league-chat/tradeChatCards', () => ({ syncTradeCardsForLeague: vi.fn() }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => undefined }))
vi.mock('@/lib/chat-core/resolveMentionTargets', () => ({ resolveLeagueMentionIds: async () => [] }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: async () => [] }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', () => ({ queueLeagueChatNotifications: vi.fn() }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'commish' }) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: async () => ({ displayName: 'Casey', username: 'casey' }) },
    league: { findUnique: async () => ({ userId: 'commish' }) },
    bracketLeagueMember: { findUnique: async () => null },
    bracketLeagueMessage: { findFirst: async () => null },
    leagueChatMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        h.stored.push(data)
        return {
          id: `m-${h.stored.length}`,
          ...data,
          createdAt: new Date('2026-09-25T12:00:00.000Z'),
          user: { ...h.sender, profile: null },
        }
      },
      findFirst: async () => h.editTarget,
      update: h.update,
    },
  },
}))

vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ isSurvivorLeague: h.isSurvivor }))
vi.mock('@/lib/survivor/chimmyHandler', () => ({ handleChimmyPrivateMessage: h.survivorHost }))

async function send(message: string) {
  const { POST } = await import('@/app/api/league/chat/route')
  return POST(createMockNextRequest('http://localhost/api/league/chat', { method: 'POST', body: { leagueId: 'L1', message } }) as never)
}

describe('league chat private @Chimmy in a Survivor league', () => {
  beforeEach(() => { vi.clearAllMocks(); h.stored.length = 0; h.isSurvivor.mockResolvedValue(true) })

  it('sends a rules question to the Survivor host, privately', async () => {
    const res = await send('@Chimmy how does voting work?')
    expect(res.status).toBe(200)
    expect(h.survivorHost).toHaveBeenCalledWith('L1', 'member-1', '@Chimmy how does voting work?')
    expect(h.general).not.toHaveBeenCalled()
    const reply = h.stored.find(row => row.message === 'survivor answer')
    expect(reply).toEqual(expect.objectContaining({ isPrivate: true, visibleToUserId: 'member-1' }))
  })

  it('keeps fantasy questions with general Chimmy', async () => {
    await send('@Chimmy when does Bijan play?')
    expect(h.general).toHaveBeenCalled()
    expect(h.survivorHost).not.toHaveBeenCalled()
  })

  it('keeps rules questions in other league types with general Chimmy', async () => {
    h.isSurvivor.mockResolvedValue(false)
    await send('@Chimmy how does voting work?')
    expect(h.general).toHaveBeenCalled()
    expect(h.survivorHost).not.toHaveBeenCalled()
  })
})
