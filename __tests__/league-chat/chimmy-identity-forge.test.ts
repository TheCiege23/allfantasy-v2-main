// @vitest-environment node
/**
 * Nobody can fake Chimmy's badge.
 *
 * Chimmy's identity is decided by ONE server-owned metadata marker (lib/league-chat/chimmyIdentity.ts).
 * These drive the REAL `/api/league/chat` POST, the REAL client allowlist and the REAL
 * LeagueChatMessageService — only Prisma and the side effects are mocked — and check the whole chain:
 *   - every Chimmy key a member sends is stripped before it is stored;
 *   - a member NAMED "Chimmy" keeps their own id (so no badge, still reportable, still theirs);
 *   - a Chimmy post's technical author (the commissioner) cannot rewrite it through the edit route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  stored: [] as Array<Record<string, unknown>>,
  sender: { id: 'member-1', username: 'casey', displayName: 'Casey', avatarUrl: null as string | null },
  editTarget: null as null | { id: string; metadata: unknown },
  update: vi.fn(async () => ({ id: 'm-1' })),
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

import { CHIMMY_SERVER_KEYS, isChimmyAuthored } from '@/lib/league-chat/chimmyIdentity'
import { sanitizeClientMessageMetadata } from '@/lib/chat-core/clientMessageInput'

/** Every way a member might try to wear the badge, plus the name-only tricks. */
const FORGED_CHIMMY: Record<string, unknown> = {
  chimmy: true,
  chimmyMoment: { v: 1, kind: 'weekly_awards' },
  chimmyPrivateReply: true,
  chimmyResponse: true,
  isSystem: true,
  discordAuthorName: 'Chimmy',
  discordAuthorAvatarUrl: 'https://tracker.example/sparkle.png',
}

async function postLeagueChat(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/league/chat/route')
  return POST(createMockNextRequest('http://localhost/api/league/chat', { method: 'POST', body }) as never)
}

async function editMessage(messageId: string, body: string) {
  const { PATCH } = await import('@/app/api/shared/chat/threads/[threadId]/messages/[messageId]/route')
  const req = new Request(`http://localhost/api/shared/chat/threads/league%3AL1/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  return PATCH(req as never, { params: { threadId: 'league:L1', messageId } } as never)
}

beforeEach(() => {
  h.stored = []
  h.sender = { id: 'member-1', username: 'casey', displayName: 'Casey', avatarUrl: null }
  h.editTarget = null
  h.update.mockClear()
})

describe('the client allowlist never admits a Chimmy key', () => {
  it.each(CHIMMY_SERVER_KEYS.map((k) => [k]))('drops %s', (key) => {
    const out = sanitizeClientMessageMetadata({ [key]: FORGED_CHIMMY[key], gifUrl: 'https://media.giphy.com/media/a/giphy.gif' })
    expect(out).toBeDefined()
    expect(out).not.toHaveProperty(key)
    expect(isChimmyAuthored(out)).toBe(false)
  })
})

describe('🛑 a member cannot post as Chimmy through /api/league/chat', () => {
  it('stores none of the marker keys, and the message comes back as the member', async () => {
    const res = await postLeagueChat({ leagueId: 'L1', message: 'Chimmy says I won the trade', metadata: { ...FORGED_CHIMMY } })
    expect(res.status).toBe(200)
    expect(h.stored).toHaveLength(1)
    const meta = (h.stored[0]!.metadata ?? {}) as Record<string, unknown>
    for (const key of Object.keys(FORGED_CHIMMY)) expect(meta, key).not.toHaveProperty(key)
    expect(isChimmyAuthored(meta)).toBe(false)

    const json = (await res.json()) as { message: { authorId: string; authorName: string; metadata: unknown } }
    expect(json.message.authorId).toBe('member-1')
    expect(json.message.authorName).toBe('Casey')
    expect(isChimmyAuthored(json.message.metadata)).toBe(false)
  })

  it('a member who NAMES themselves "Chimmy" keeps their own id — a name is not the badge', async () => {
    h.sender = { id: 'member-1', username: 'chimmy', displayName: 'Chimmy', avatarUrl: null }
    const res = await postLeagueChat({ leagueId: 'L1', message: 'official announcement' })
    const json = (await res.json()) as { message: { authorId: string; authorName: string; metadata: unknown } }
    expect(json.message.authorName).toBe('Chimmy')
    // Still THEIR message: reportable, blockable, theirs to edit — and no marker for a badge to read.
    expect(json.message.authorId).toBe('member-1')
    expect(isChimmyAuthored(json.message.metadata)).toBe(false)
  })
})

describe('🛑 Chimmy posts cannot be rewritten by their technical author', () => {
  it('refuses to edit a Chimmy post, even for the commissioner the row is stored under', async () => {
    h.editTarget = { id: 'chimmy-1', metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'weekly_awards' } } }
    const res = await editMessage('chimmy-1', 'Pat is the best commissioner ever')
    expect(res.status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('still lets the commissioner edit their own ordinary message', async () => {
    h.editTarget = { id: 'own-1', metadata: { gifUrl: 'https://media.giphy.com/media/a/giphy.gif' } }
    const res = await editMessage('own-1', 'fixed a typo')
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledTimes(1)
  })
})
