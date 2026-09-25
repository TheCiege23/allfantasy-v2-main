/**
 * E2 (hands-on chat test, 2026-09-25): `GET /api/shared/chat/threads/[id]/messages` answered a
 * database error with `200 { messages: [] }`, so a DM or huddle whose read failed looked like one
 * nobody had written in. It is a 503 now, in the same words the route already uses when the block
 * list cannot be read — and a genuinely empty thread is still `200` with `[]`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from './helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  getPlatformThreadMessages: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformBlockedUser: { findMany: async () => [], findFirst: async () => null },
  },
}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'me' }) }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThread: vi.fn(),
  getPlatformChatThreads: vi.fn(async () => []),
  addThreadParticipants: vi.fn(),
  getThreadMembers: vi.fn(),
  getPlatformThreadMessages: h.getPlatformThreadMessages,
  createPlatformThreadMessage: vi.fn(),
  createSystemMessage: vi.fn(),
}))
vi.mock('@/lib/chat-core/matchupThreads', () => ({ ensureMatchupThreadsForUser: vi.fn() }))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (threadId: string) => threadId.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (threadId: string) => threadId.replace(/^league:/, ''),
  getMessageQueryOptions: () => ({}),
  parseCursor: () => null,
}))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', () => ({
  queueDirectMessageNotifications: vi.fn(),
  queueLeagueChatNotifications: vi.fn(),
}))
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: vi.fn() }))
vi.mock('@/lib/chat-core/league-message-proxy', () => ({ bracketMessagesToPlatform: vi.fn(() => []) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => false),
  getCurrentUserRosterIdForLeague: vi.fn(async () => null),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => []),
  createLeagueChatMessage: vi.fn(),
}))
vi.mock('@/lib/survivor/constants', () => ({ parseTribeIdFromSource: vi.fn(() => null) }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ getTribeChatMemberRosterIds: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({ processSurvivorOfficialCommand: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 1) }))
vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({ isMergeTriggered: vi.fn(async () => false) }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn(async () => null) }))
vi.mock('@/lib/ai/deterministic', () => ({ DETERMINISTIC_SOURCE: 'deterministic', tryDeterministicAnswer: vi.fn() }))

import { GET as readMessages } from '@/app/api/shared/chat/threads/[threadId]/messages/route'

async function read() {
  const res = await readMessages(
    createMockNextRequest('http://localhost/api/shared/chat/threads/t1/messages') as never,
    { params: { threadId: 't1' } } as never,
  )
  return { status: res.status, json: (await res.json()) as { messages?: unknown[]; error?: string } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('DM / huddle message read', () => {
  it('answers a database error with a 503 and plain words, not an empty conversation', async () => {
    h.getPlatformThreadMessages.mockRejectedValueOnce(new Error('P1001 db.internal:5432 unreachable'))
    const { status, json } = await read()
    expect(status).toBe(503)
    expect(json.messages).toBeUndefined()
    expect(json.error).toBe('Messages are temporarily unavailable. Try again in a moment.')
    expect(JSON.stringify(json)).not.toContain('db.internal')
  })

  it('asks the reader to report failures rather than return []', async () => {
    h.getPlatformThreadMessages.mockResolvedValueOnce([])
    await read()
    expect(h.getPlatformThreadMessages).toHaveBeenCalledWith('me', 't1', expect.any(Number), { throwOnError: true })
  })

  it('a thread nobody has written in is still 200 with []', async () => {
    h.getPlatformThreadMessages.mockResolvedValueOnce([])
    const { status, json } = await read()
    expect(status).toBe(200)
    expect(json.messages).toEqual([])
  })
})
