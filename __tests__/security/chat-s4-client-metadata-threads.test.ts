/**
 * S4 — DMs, huddles and the shared-thread view of league chat stored the client's `metadata` AND
 * `messageType` as sent (`/api/shared/chat/threads/[threadId]/messages`). A member could pick
 * `broadcast` for the commissioner-announcement style, forge the Discord author fields, seed
 * reactions, or post a poll whose JSON body already carried other people's votes.
 *
 * The REAL route and the REAL allowlist run; the store is mocked, and what reaches it is asserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolvePlatformUser: vi.fn(),
  createPlatformThreadMessage: vi.fn(),
  createSystemMessage: vi.fn(),
  createLeagueChatMessage: vi.fn(),
  processSurvivor: vi.fn(),
  prisma: {
    platformChatThreadMember: { findFirst: vi.fn() },
    platformBlockedUser: { findFirst: vi.fn(), findMany: vi.fn() },
    platformChatMessage: { findMany: vi.fn() },
    bracketLeagueMember: { findUnique: vi.fn() },
    bracketLeagueMessage: { create: vi.fn() },
  },
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: h.resolvePlatformUser }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThreadMessage: h.createPlatformThreadMessage,
  createSystemMessage: h.createSystemMessage,
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
vi.mock('@/lib/chat-core/league-message-proxy', () => ({
  bracketMessagesToPlatform: vi.fn((rows: unknown[]) => rows),
}))
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
vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({ processSurvivorOfficialCommand: h.processSurvivor }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 1) }))
vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({ isMergeTriggered: vi.fn(async () => false) }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: vi.fn(async () => false) }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: vi.fn(async () => []) }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn(async () => null) }))
vi.mock('@/lib/ai/deterministic', () => ({ DETERMINISTIC_SOURCE: 'deterministic', tryDeterministicAnswer: vi.fn(async () => 'x') }))

import { POST } from '@/app/api/shared/chat/threads/[threadId]/messages/route'

const FORGED = {
  discordAuthorName: 'Commissioner',
  discordAuthorAvatarUrl: 'https://tracker.example/pixel.png',
  reactions: [{ emoji: '👍', count: 4, userIds: ['victim-1'] }],
  votes: { '0': ['victim-1', 'victim-2'] },
  closed: true,
  tradeCard: { status: 'accepted' },
  draftIntelThread: true,
  archived: true,
  isSystem: true,
}

async function post(threadId: string, body: Record<string, unknown>) {
  const req = new Request(`http://localhost/api/shared/chat/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as never, { params: { threadId } } as never)
}

/** [body, messageType, metadata] as handed to the platform-thread store. */
function platformCall(): [string, string, Record<string, unknown> | undefined] {
  expect(h.createPlatformThreadMessage).toHaveBeenCalledTimes(1)
  const call = h.createPlatformThreadMessage.mock.calls[0]!
  return [call[2] as string, call[3] as string, call[4] as Record<string, unknown> | undefined]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolvePlatformUser.mockResolvedValue({ appUserId: 'u1' })
  h.prisma.platformChatThreadMember.findFirst.mockResolvedValue({
    thread: { id: 't1', title: null, threadType: 'group', members: [{ userId: 'u1' }, { userId: 'u2' }] },
  })
  h.prisma.platformBlockedUser.findFirst.mockResolvedValue(null)
  h.prisma.platformBlockedUser.findMany.mockResolvedValue([])
  h.prisma.bracketLeagueMember.findUnique.mockResolvedValue(null)
  h.prisma.bracketLeagueMessage.create.mockImplementation(async ({ data }: { data: unknown }) => data)
  h.createPlatformThreadMessage.mockImplementation(async (_u: string, threadId: string, body: string, messageType: string) => ({
    id: 'msg-1',
    threadId,
    body,
    messageType,
    createdAt: '2026-09-25T18:00:00.000Z',
    senderUserId: 'u1',
    senderName: 'Dana',
  }))
  h.createLeagueChatMessage.mockResolvedValue({ id: 'lm-1', body: 'x' })
  h.processSurvivor.mockResolvedValue({ handled: false })
})

describe('S4 DM / huddle send — message type is allowlisted', () => {
  it.each(['broadcast', 'system', 'stats_bot', 'trade', 'pin', 'draft_intel_queue', 'draft_pick'])(
    'stores a client-chosen %s as plain text',
    async (forgedType) => {
      const res = await post('t1', { body: 'important news', messageType: forgedType })
      expect(res.status).toBe(200)
      expect(platformCall()[1]).toBe('text')
    },
  )

  it.each(['text', 'poll', 'image', 'gif', 'file'])('keeps the %s type a composer really sends', async (type) => {
    await post('t1', { body: 'https://media.giphy.com/media/x/giphy.gif', messageType: type })
    expect(platformCall()[1]).toBe(type)
  })
})

describe('S4 DM / huddle send — metadata is allowlisted', () => {
  it('drops server-owned keys and keeps what MessagesContent sends for a file', async () => {
    await post('t1', {
      body: '/uploads/chat/report.pdf',
      messageType: 'file',
      metadata: { filename: 'report.pdf', contentType: 'application/pdf', ...FORGED },
    })
    const [, , metadata] = platformCall()
    expect(metadata).toEqual({ filename: 'report.pdf', contentType: 'application/pdf' })
  })

  it('keeps the World Cup private chat tags', async () => {
    await post('t1', { body: 'good luck', metadata: { source: 'world_cup_private_chat', challengeId: 'wc-2026' } })
    expect(platformCall()[2]).toEqual({ source: 'world_cup_private_chat', challengeId: 'wc-2026' })
  })

  it('stores no metadata at all when every key was forged', async () => {
    await post('t1', { body: 'hi', metadata: { ...FORGED } })
    expect(platformCall()[2]).toBeUndefined()
  })
})

describe('S4 poll bodies — a client creates a poll, it does not arrive with votes', () => {
  it('rebuilds a JSON poll body with empty votes and open', async () => {
    const forgedBody = JSON.stringify({
      question: 'Trade deadline?',
      options: ['Friday', 'Sunday'],
      votes: { '0': ['victim-1', 'victim-2', 'victim-3'] },
      closed: true,
    })
    await post('t1', { body: forgedBody, messageType: 'poll' })
    const stored = JSON.parse(platformCall()[0]) as Record<string, unknown>
    expect(stored).toEqual({ question: 'Trade deadline?', options: ['Friday', 'Sunday'], votes: {}, closed: false })
  })

  it('rebuilds a metadata.question poll with empty votes too', async () => {
    await post('t1', {
      body: 'ignored',
      messageType: 'poll',
      metadata: { question: 'Keeper rule?', options: ['1', '2'], votes: { '1': ['victim-1'] }, closed: true },
    })
    const stored = JSON.parse(platformCall()[0]) as Record<string, unknown>
    expect(stored.votes).toEqual({})
    expect(stored.closed).toBe(false)
  })
})

describe('S4 league thread send — the same allowlist on the league branch', () => {
  it('stores league-thread messages with a sanitized type and metadata', async () => {
    await post('league:L1', { body: 'from the tribe view', messageType: 'broadcast', metadata: { ...FORGED } })
    expect(h.createLeagueChatMessage).toHaveBeenCalledTimes(1)
    const opts = h.createLeagueChatMessage.mock.calls[0]![3] as Record<string, unknown>
    expect(opts.type).toBe('text')
    expect(opts.metadata).toBeUndefined()
  })

  it('stores bracket-league messages with a sanitized type and metadata', async () => {
    h.prisma.bracketLeagueMember.findUnique.mockResolvedValue({ id: 'bm-1' })
    await post('league:B1', { body: 'pool talk', messageType: 'broadcast', metadata: { ...FORGED } })
    expect(h.prisma.bracketLeagueMessage.create).toHaveBeenCalledTimes(1)
    const { data } = h.prisma.bracketLeagueMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data.type).toBe('text')
    expect(data.metadata).toBeUndefined()
  })
})
