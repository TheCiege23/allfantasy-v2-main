import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * `/api/league/chat` is the route the comms drawer posts league chat through. It now hands every saved
 * main-room message to the (opt-in) league chat alerts, and a Big Brother side room is labelled as a
 * side room so the notifier skips it — a side room's members are narrower than the league's.
 *
 * Also pinned: the @all notice never shows the sender's email to the rest of the league.
 */

const h = vi.hoisted(() => ({
  session: { user: { id: 'sender' } } as { user?: { id?: string } } | null,
  bigBrother: false,
  channels: [] as Array<{ key: string; canWrite: boolean }>,
  created: [] as Array<{ body: string; opts: Record<string, unknown> }>,
  queueLeague: vi.fn(),
  dispatch: vi.fn(async () => ({})),
  sender: { displayName: null as string | null, username: null as string | null, email: 'secret@example.com' },
  members: ['sender', 'u-2', 'u-3'],
}))

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: async () => ({ role: 'member' }) }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: async () => h.bigBrother }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: async () => h.channels }))
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
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: async () => h.members }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', () => ({ queueLeagueChatNotifications: h.queueLeague }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: {
      // Returns only the columns asked for, so a route that stops selecting `email` cannot leak it.
      findUnique: async ({ select }: { select: Record<string, boolean> }) =>
        Object.fromEntries(Object.entries(h.sender).filter(([k]) => select[k])),
    },
    league: { findUnique: async () => ({ userId: 'owner' }) },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(),
  createLeagueChatMessage: async (_leagueId: string, _userId: string, body: string, opts: Record<string, unknown>) => {
    h.created.push({ body, opts })
    return {
      id: `m-${h.created.length}`,
      senderUserId: 'sender',
      senderName: 'Casey',
      senderAvatarUrl: null,
      body,
      createdAt: '2026-09-25T12:00:00.000Z',
      messageType: 'text',
      metadata: opts.metadata ?? null,
    }
  },
}))

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/league/chat/route')
  return POST(createMockNextRequest('http://localhost/api/league/chat', { method: 'POST', body }) as never)
}

beforeEach(() => {
  h.session = { user: { id: 'sender' } }
  h.bigBrother = false
  h.channels = []
  h.created = []
  h.sender = { displayName: null, username: null, email: 'secret@example.com' }
  h.queueLeague.mockReset()
  h.dispatch.mockClear()
})

describe('league chat POST → message alerts', () => {
  it('a main-room message is handed to the league chat alerts, after it is saved', async () => {
    const res = await post({ leagueId: 'L1', message: 'who wants to trade a WR?' })
    expect(res.status).toBe(200)
    expect(h.queueLeague).toHaveBeenCalledTimes(1)
    expect(h.queueLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'L1',
        messageId: 'm-1',
        senderUserId: 'sender',
        body: 'who wants to trade a WR?',
        source: 'league',
      }),
    )
  })

  it('a Big Brother side room is labelled as a side room (the notifier skips anything but the main room)', async () => {
    h.bigBrother = true
    h.channels = [
      { key: 'main', canWrite: true },
      { key: 'hoh_room', canWrite: true },
    ]
    await post({ leagueId: 'L1', message: 'plotting', metadata: { bbChannel: 'hoh_room' } })
    expect(h.queueLeague).toHaveBeenCalledWith(expect.objectContaining({ source: 'big_brother:hoh_room' }))

    h.queueLeague.mockReset()
    await post({ leagueId: 'L1', message: 'hi house' })
    expect(h.queueLeague).toHaveBeenCalledWith(expect.objectContaining({ source: 'league' }))
  })

  it('a refused send alerts nobody', async () => {
    h.session = null
    expect((await post({ leagueId: 'L1', message: 'x' })).status).toBe(401)
    expect(h.queueLeague).not.toHaveBeenCalled()
  })

  it("the @all notice never uses the sender's email as their name", async () => {
    await post({ leagueId: 'L1', message: '@all draft moved to 8pm' })
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(1))
    const call = (h.dispatch.mock.calls[0] as unknown as [{ body: string; userIds: string[] }])[0]
    expect(call.body).toBe('Someone mentioned everyone in the league chat.')
    expect(JSON.stringify(h.dispatch.mock.calls)).not.toContain('secret@example.com')
    expect(call.userIds.sort()).toEqual(['u-2', 'u-3'])
  })
})
