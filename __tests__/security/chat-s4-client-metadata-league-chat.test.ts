/**
 * S4 — a league member could forge server-owned message metadata through `/api/league/chat` (the
 * route the comms drawer posts through) and `/api/redraft/communication/chat`. Both stored the
 * client's `metadata` as sent, so `discordAuthorName` became the displayed sender, reactions and poll
 * votes could carry other people's ids, and a `tradeCard` rendered as a real trade.
 *
 * These drive the REAL routes and the REAL allowlist (lib/chat-core/clientMessageInput.ts); only the
 * store and the side effects are mocked. What is asserted is what reaches `createLeagueChatMessage`.
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

/** Everything a member should NOT be able to put on their own message. */
const FORGED = {
  discordAuthorName: 'Chimmy',
  discordAuthorAvatarUrl: 'https://tracker.example/pixel.png',
  reactions: [{ emoji: '🔥', count: 9, userIds: ['victim-1', 'victim-2'] }],
  tradeCard: { status: 'accepted', from: 'victim-1', to: 'member-1' },
  isSystem: true,
  chimmy: true,
  bigBrother: true,
  deletedAt: '2026-09-25T00:00:00.000Z',
  hiddenByMod: true,
  imageUrl: 'https://tracker.example/other.png',
}

/** What the composers really send (LeagueConversation.tsx / LeagueChatInPanel.tsx). */
const LEGIT = {
  gifUrl: 'https://media.giphy.com/media/abc/giphy.gif',
  previewUrl: 'https://media.giphy.com/media/abc/200w.gif',
  gifTitle: 'touchdown',
  giphyId: 'abc',
  gif: {
    url: 'https://media.giphy.com/media/abc/giphy.gif',
    previewUrl: 'https://media.giphy.com/media/abc/200w.gif',
    title: 'touchdown',
  },
  attachments: [{ type: 'image', url: '/uploads/chat/a.png', mimeType: 'image/png' }],
}

async function postLeagueChat(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/league/chat/route')
  return POST(createMockNextRequest('http://localhost/api/league/chat', { method: 'POST', body }) as never)
}

async function postRedraftChat(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/redraft/communication/chat/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/communication/chat', { method: 'POST', body }) as never)
}

function storedMetadata(): Record<string, unknown> {
  expect(h.created).toHaveLength(1)
  return (h.created[0]!.opts.metadata ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  h.created = []
})

describe('S4 /api/league/chat — client metadata is allowlisted', () => {
  it('drops the Discord author name and avatar, so a member cannot post as "Chimmy"', async () => {
    const res = await postLeagueChat({ leagueId: 'L1', message: 'hello', metadata: { ...FORGED } })
    expect(res.status).toBe(200)
    const meta = storedMetadata()
    expect(meta).not.toHaveProperty('discordAuthorName')
    expect(meta).not.toHaveProperty('discordAuthorAvatarUrl')
    const json = (await res.json()) as { message: { authorName: string; metadata: unknown } }
    expect(json.message.authorName).toBe('Casey')
  })

  it('drops seeded reactions, a forged trade card, system flags and moderation state', async () => {
    await postLeagueChat({ leagueId: 'L1', message: 'hello', metadata: { ...FORGED } })
    const meta = storedMetadata()
    for (const key of Object.keys(FORGED)) expect(meta, key).not.toHaveProperty(key)
  })

  it('keeps a poll the member creates but empties any votes it arrives with', async () => {
    await postLeagueChat({
      leagueId: 'L1',
      message: '📊 Best QB?',
      metadata: {
        poll: {
          question: 'Best QB?',
          options: [
            { id: 'a', text: 'Allen', votes: ['victim-1', 'victim-2'] },
            { id: 'b', text: 'Mahomes', votes: ['victim-3'] },
          ],
          closeAt: '2026-09-30T00:00:00.000Z',
          allowMultiple: false,
          anonymous: false,
        },
      },
    })
    const poll = storedMetadata().poll as { question: string; options: Array<{ id: string; text: string; votes: string[] }> }
    expect(poll.question).toBe('Best QB?')
    expect(poll.options.map((o) => o.text)).toEqual(['Allen', 'Mahomes'])
    expect(poll.options.every((o) => o.votes.length === 0)).toBe(true)
  })

  it('keeps everything a real composer sends (GIF + photo)', async () => {
    await postLeagueChat({ leagueId: 'L1', message: '', metadata: { ...LEGIT, ...FORGED } })
    const meta = storedMetadata()
    expect(meta).toMatchObject(LEGIT)
    expect(h.created[0]!.body).toBe('🎬 GIF')
  })

  it('refuses a message whose only payload was forged metadata', async () => {
    const res = await postLeagueChat({ leagueId: 'L1', message: '', metadata: { discordAuthorName: 'Commissioner' } })
    expect(res.status).toBe(400)
    expect(h.created).toHaveLength(0)
  })
})

describe('S4 /api/redraft/communication/chat — client type and metadata are allowlisted', () => {
  it('stores a forged "broadcast" as plain text and drops server-owned metadata', async () => {
    const res = await postRedraftChat({
      leagueId: 'L1',
      body: 'league meeting at 8',
      messageType: 'broadcast',
      metadata: { ...FORGED },
    })
    expect(res.status).toBe(200)
    expect(h.created[0]!.opts.type).toBe('text')
    const meta = storedMetadata()
    for (const key of Object.keys(FORGED)) expect(meta, key).not.toHaveProperty(key)
    // The route's own server-set marker survives.
    expect(meta.g42Communication).toBe(true)
  })
})
