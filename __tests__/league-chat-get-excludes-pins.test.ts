import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveLeagueAccess: vi.fn(),
  isBigBrotherLeague: vi.fn(),
  getLeagueChatMessages: vi.fn(),
  markViewingChat: vi.fn(),
  readChatPresence: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.resolveLeagueAccess }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: h.isBigBrotherLeague }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({
  getAccessibleBbChannels: vi.fn().mockResolvedValue([]),
  readBbChannelKeyFromMetadata: () => 'main',
}))
vi.mock('@/lib/chat-core/chatPresence', () => ({
  markViewingChat: h.markViewingChat,
  readChatPresence: h.readChatPresence,
}))
vi.mock('@/lib/prisma', () => ({ prisma: { appUser: { findUnique: h.findUnique } } }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: h.getLeagueChatMessages,
  createLeagueChatMessage: vi.fn(),
}))

function msg(id: string, messageType: string, body: string) {
  return {
    id,
    senderUserId: 'u1',
    senderName: 'Casey',
    senderAvatarUrl: null,
    body,
    messageType,
    createdAt: '2026-08-25T12:00:00.000Z',
    metadata: null,
    parentMessageId: null,
  }
}

async function get() {
  const { GET } = await import('../app/api/league/chat/route')
  const req = { nextUrl: new URL('http://localhost/api/league/chat?leagueId=l1') } as never
  const res = await GET(req)
  return (await res.json()) as { messages: Array<{ id: string }> }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getServerSession.mockResolvedValue({ user: { id: 'u1' } })
  h.resolveLeagueAccess.mockResolvedValue({ leagueId: 'l1' })
  h.isBigBrotherLeague.mockResolvedValue(false)
  h.markViewingChat.mockResolvedValue(false)
  h.readChatPresence.mockResolvedValue([])
  h.findUnique.mockResolvedValue({ displayName: 'Casey', username: 'casey' })
})

describe('league chat transcript', () => {
  /*
   * A pin is stored as a `type: 'pin'` chat row whose body is the JSON
   * `{ messageId, snippet }`. This GET never filtered by type, so the moment
   * anything could pin, every pin would render in the stream as raw JSON.
   *
   * One request, several assertions: re-entering this route inside one file
   * hangs the runner, and a second call proves nothing the first does not.
   */
  it('drops pin rows and keeps every other kind', async () => {
    h.getLeagueChatMessages.mockResolvedValue([
      msg('m1', 'text', 'real message'),
      msg('pin-1', 'pin', '{"messageId":"m1","snippet":"real message"}'),
      msg('d1', 'draft_pick', 'Casey drafted Kelce'),
      msg('s1', 'system', 'League created'),
      { ...msg('m2', 'text', 'no type on this one'), messageType: null },
    ])

    const data = await get()

    /* The pin is gone; the draft pick, the system note and the untyped row stay. */
    expect(data.messages.map((m) => m.id)).toEqual(['m1', 'd1', 's1', 'm2'])
  })
})
