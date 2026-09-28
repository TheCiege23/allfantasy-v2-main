/**
 * The shared-thread send route stored any client-supplied `imageUrl` on its league and bracket
 * branches — a column every viewer's browser loads as an image — so a sender could put any host (a
 * tracking pixel) in front of every member. Only our own private upload URL
 * (`/api/chat/upload?path=chat/…`, what both upload routes return) and a GIF from a named GIF service
 * are kept now.
 *
 * The REAL route and the REAL `sanitizeClientImageUrl` run; only the stores are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createLeagueChatMessage: vi.fn(),
  prisma: {
    platformChatThreadMember: { findFirst: vi.fn() },
    platformBlockedUser: { findFirst: vi.fn(), findMany: vi.fn() },
    platformChatMessage: { findMany: vi.fn() },
    bracketLeagueMember: { findUnique: vi.fn() },
    bracketLeagueMessage: { create: vi.fn() },
  },
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'u1' }) }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThreadMessage: vi.fn(),
  createSystemMessage: vi.fn(),
  getPlatformThreadMessages: vi.fn(async () => []),
}))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', () => ({
  queueDirectMessageNotifications: vi.fn(),
  queueLeagueChatNotifications: vi.fn(),
}))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (threadId: string) => threadId.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (threadId: string) => threadId.replace(/^league:/, ''),
  getMessageQueryOptions: () => ({}),
  parseCursor: () => null,
}))
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: vi.fn(async () => 'answer') }))
vi.mock('@/lib/chat-core/league-message-proxy', () => ({ bracketMessagesToPlatform: vi.fn((rows: unknown[]) => rows) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => null),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => []),
  createLeagueChatMessage: h.createLeagueChatMessage,
}))
vi.mock('@/lib/survivor/constants', () => ({ parseTribeIdFromSource: vi.fn(() => null) }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ getTribeChatMemberRosterIds: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({
  processSurvivorOfficialCommand: vi.fn(async () => ({ handled: false })),
}))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 1) }))
vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({ isMergeTriggered: vi.fn(async () => false) }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: vi.fn(async () => false) }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: vi.fn(async () => []) }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn(async () => null) }))
vi.mock('@/lib/ai/deterministic', () => ({ DETERMINISTIC_SOURCE: 'deterministic', tryDeterministicAnswer: vi.fn(async () => 'x') }))

import { POST } from '@/app/api/shared/chat/threads/[threadId]/messages/route'

const OWN_UPLOAD = `/api/chat/upload?path=${encodeURIComponent('chat/L1/image/abc123.png')}`
const GIPHY = 'https://media.giphy.com/media/abc/giphy.gif'

async function post(threadId: string, imageUrl: unknown) {
  const req = new Request(`http://localhost/api/shared/chat/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'look at this', messageType: 'image', imageUrl }),
  })
  return POST(req as never, { params: { threadId } } as never)
}

function storedLeagueImageUrl(): unknown {
  expect(h.createLeagueChatMessage).toHaveBeenCalledTimes(1)
  return (h.createLeagueChatMessage.mock.calls[0]![3] as { imageUrl: unknown }).imageUrl
}

function storedBracketImageUrl(): unknown {
  expect(h.prisma.bracketLeagueMessage.create).toHaveBeenCalledTimes(1)
  return (h.prisma.bracketLeagueMessage.create.mock.calls[0]![0] as { data: { imageUrl: unknown } }).data.imageUrl
}

beforeEach(() => {
  vi.clearAllMocks()
  h.prisma.platformBlockedUser.findMany.mockResolvedValue([])
  h.prisma.bracketLeagueMember.findUnique.mockResolvedValue(null)
  h.prisma.bracketLeagueMessage.create.mockImplementation(async ({ data }: { data: unknown }) => data)
  h.createLeagueChatMessage.mockResolvedValue({ id: 'lm-1', body: 'x' })
})

describe('league branch: imageUrl is our own storage or nothing', () => {
  it.each([
    ['a tracking host', 'https://tracker.example/pixel.png'],
    ['a protocol-relative host', '//tracker.example/pixel.png'],
    ['a backslash host', '/\\tracker.example/pixel.png'],
    ['another same-site route', '/api/admin/users'],
    ['our upload route with an extra parameter', `${OWN_UPLOAD}&redirect=https://tracker.example`],
    ['our upload route with a path the reader rejects', '/api/chat/upload?path=../../etc/passwd'],
    ['an upload belonging to a different chat', `/api/chat/upload?path=${encodeURIComponent('chat/OTHER/image/x.png')}`],
    ['a bracket-pool upload posted into a league room', `/api/chat/upload?path=${encodeURIComponent('chat/bracket/L1/image/x.png')}`],
    ['any Vercel Blob store', 'https://someone-else.public.blob.vercel-storage.com/x.png'],
    ['a javascript URL', 'javascript:alert(1)'],
  ])('drops %s', async (_label, imageUrl) => {
    await post('league:L1', imageUrl)
    expect(storedLeagueImageUrl()).toBeNull()
  })

  it('keeps our own private upload URL', async () => {
    await post('league:L1', OWN_UPLOAD)
    expect(storedLeagueImageUrl()).toBe(OWN_UPLOAD)
  })

  it('keeps a GIF from a named GIF service', async () => {
    await post('league:L1', GIPHY)
    expect(storedLeagueImageUrl()).toBe(GIPHY)
  })
})

describe('bracket branch: the same rule', () => {
  beforeEach(() => {
    h.prisma.bracketLeagueMember.findUnique.mockResolvedValue({ id: 'bm-1' })
  })

  it('drops a tracking host', async () => {
    await post('league:B1', 'https://tracker.example/pixel.png')
    expect(storedBracketImageUrl()).toBeNull()
  })

  it('keeps our own bracket upload URL and a GIF', async () => {
    const bracketUpload = `/api/chat/upload?path=${encodeURIComponent('chat/bracket/B1/image/x.webp')}`
    await post('league:B1', bracketUpload)
    expect(storedBracketImageUrl()).toBe(bracketUpload)
    h.prisma.bracketLeagueMessage.create.mockClear()
    await post('league:B1', GIPHY)
    expect(storedBracketImageUrl()).toBe(GIPHY)
  })
})
