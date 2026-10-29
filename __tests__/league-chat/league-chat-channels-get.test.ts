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
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: h.findUnique },
    // The GET now applies the viewer's blocks (fail-closed lookup); nobody here has blocked anyone.
    platformBlockedUser: { findMany: async () => [] },
  },
}))
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

async function get(query = '') {
  const { GET } = await import('../../app/api/league/chat/route')
  const req = { nextUrl: new URL(`http://localhost/api/league/chat?leagueId=l1${query}`) } as never
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

describe('league chat channels — GET', () => {
  /*
   * One request per file section: re-entering this route inside one file has hung the runner (see
   * league-chat-get-excludes-pins.test.ts), so one call carries every assertion for #trades.
   */
  it('#trades holds its own posts plus trade cards; untagged chat and other rooms stay out', async () => {
    h.getLeagueChatMessages.mockResolvedValue([
      msg('g1', 'text', 'general chatter'),
      { ...msg('t1', 'text', 'anyone want Bijan?'), metadata: { leagueChannel: 'trades' } },
      { ...msg('x1', 'text', 'you are going down'), metadata: { leagueChannel: 'trash-talk' } },
      msg('card', 'trade', 'Trade accepted'),
      msg('w1', 'waiver_notice', 'Waivers ran'),
    ])

    const data = await get('&leagueChannel=trades')

    expect(data.messages.map((m) => m.id)).toEqual(['t1', 'card'])
  })
})
