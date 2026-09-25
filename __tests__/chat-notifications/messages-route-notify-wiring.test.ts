/**
 * The DM / huddle send route fires the message alert — from the SERVER, after the save, never
 * awaited. Before 2026-09-25 this route notified nobody on any channel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolvePlatformUser: vi.fn(),
  createPlatformThreadMessage: vi.fn(),
  createSystemMessage: vi.fn(),
  createLeagueChatMessage: vi.fn(),
  dispatch: vi.fn(),
  queueDm: vi.fn(),
  queueLeague: vi.fn(),
  processSurvivor: vi.fn(),
  prisma: {
    platformChatThreadMember: { findFirst: vi.fn() },
    platformBlockedUser: { findFirst: vi.fn(), findMany: vi.fn() },
    platformChatMessage: { findMany: vi.fn() },
    platformChatThread: { findUnique: vi.fn() },
    bracketLeagueMember: { findUnique: vi.fn() },
    appUser: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: h.resolvePlatformUser }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThreadMessage: h.createPlatformThreadMessage,
  createSystemMessage: h.createSystemMessage,
  getPlatformThreadMessages: vi.fn(),
}))
vi.mock('@/lib/chat-notifications/chatMessageNotifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat-notifications/chatMessageNotifier')>()
  // Spies that run the REAL fire-and-forget entry points unless a test overrides them.
  h.queueDm.mockImplementation(actual.queueDirectMessageNotifications)
  h.queueLeague.mockImplementation(actual.queueLeagueChatNotifications)
  return { ...actual, queueDirectMessageNotifications: h.queueDm, queueLeagueChatNotifications: h.queueLeague }
})
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (threadId: string) => threadId.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (threadId: string) => threadId.replace(/^league:/, ''),
  getMessageQueryOptions: () => ({}),
  parseCursor: () => null,
}))
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: vi.fn(async () => 'private answer') }))
vi.mock('@/lib/chat-core/league-message-proxy', () => ({ bracketMessagesToPlatform: vi.fn() }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => null),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => []),
  createLeagueChatMessage: h.createLeagueChatMessage,
}))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/constants', () => ({ parseTribeIdFromSource: vi.fn(() => null) }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ getTribeChatMemberRosterIds: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({ processSurvivorOfficialCommand: h.processSurvivor }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 1) }))
vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({ isMergeTriggered: vi.fn(async () => false) }))
vi.mock('@/lib/moderation', () => ({ getBlockedUserIds: vi.fn(async () => []), filterMessagesByBlocked: vi.fn((m: unknown[]) => m) }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn(async () => null) }))
vi.mock('@/lib/ai/deterministic', () => ({ DETERMINISTIC_SOURCE: 'deterministic', tryDeterministicAnswer: vi.fn(async () => 'x') }))

import { POST } from '@/app/api/shared/chat/threads/[threadId]/messages/route'

const CREATED_AT = '2026-09-25T18:00:00.000Z'

function membership(threadType: 'dm' | 'group' | 'ai') {
  return {
    thread: {
      id: 't1',
      title: null,
      threadType,
      members: [{ userId: 'u1' }, { userId: 'u2' }],
    },
  }
}

async function post(threadId: string, body: Record<string, unknown>) {
  const req = new Request(`http://localhost/api/shared/chat/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as never, { params: { threadId } } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolvePlatformUser.mockResolvedValue({ appUserId: 'u1' })
  h.prisma.platformChatThreadMember.findFirst.mockResolvedValue(membership('dm'))
  h.prisma.platformBlockedUser.findFirst.mockResolvedValue(null)
  h.prisma.platformBlockedUser.findMany.mockResolvedValue([])
  h.prisma.platformChatMessage.findMany.mockResolvedValue([])
  h.createPlatformThreadMessage.mockImplementation(async (_u: string, threadId: string, body: string, messageType: string) => ({
    id: 'msg-1',
    threadId,
    body,
    messageType,
    createdAt: CREATED_AT,
    senderUserId: 'u1',
    senderName: 'Dana',
  }))
  h.createSystemMessage.mockResolvedValue({ id: 'sys-1' })
  h.createLeagueChatMessage.mockResolvedValue({ id: 'lm-1', body: 'x' })
  h.processSurvivor.mockResolvedValue({ handled: false })
  // Keep the real notifier from doing anything in the wiring tests unless a test wants it.
  h.queueDm.mockImplementation(() => undefined)
  h.queueLeague.mockImplementation(() => undefined)
})

describe('DM / huddle send → server-side message alert', () => {
  it('queues the alert AFTER the save, with the saved message', async () => {
    const res = await post('t1', { body: 'you up for a trade?' })
    expect(res.status).toBe(200)
    expect(h.createPlatformThreadMessage).toHaveBeenCalledTimes(1)
    expect(h.queueDm).toHaveBeenCalledTimes(1)
    expect(h.queueDm).toHaveBeenCalledWith({
      threadId: 't1',
      messageId: 'msg-1',
      senderUserId: 'u1',
      messageType: 'text',
      body: 'you up for a trade?',
      metadata: null,
      createdAt: CREATED_AT,
    })
    // Saved first, then queued.
    expect(h.createPlatformThreadMessage.mock.invocationCallOrder[0]).toBeLessThan(h.queueDm.mock.invocationCallOrder[0])
  })

  it('a huddle message is announced too', async () => {
    h.prisma.platformChatThreadMember.findFirst.mockResolvedValue(membership('group'))
    await post('t1', { body: 'gm huddle' })
    expect(h.queueDm).toHaveBeenCalledTimes(1)
  })

  it('a private @chimmy question tells nobody', async () => {
    await post('t1', { body: '@chimmy who should I start?' })
    expect(h.queueDm).not.toHaveBeenCalled()
  })

  it('a Chimmy (ai) thread tells nobody', async () => {
    h.prisma.platformChatThreadMember.findFirst.mockResolvedValue(membership('ai'))
    await post('t1', { body: 'hello' })
    expect(h.queueDm).not.toHaveBeenCalled()
  })

  it('a message that failed to save queues nothing', async () => {
    h.createPlatformThreadMessage.mockResolvedValue(null)
    const res = await post('t1', { body: 'x' })
    expect(res.status).toBe(400)
    expect(h.queueDm).not.toHaveBeenCalled()
  })

  it('🛑 the send returns without waiting on the notification — a hung lookup cannot stall it', async () => {
    // The REAL fire-and-forget entry point, over a thread lookup that never resolves.
    const actual = await vi.importActual<typeof import('@/lib/chat-notifications/chatMessageNotifier')>(
      '@/lib/chat-notifications/chatMessageNotifier',
    )
    h.queueDm.mockImplementation(actual.queueDirectMessageNotifications)
    h.prisma.platformChatThread.findUnique.mockReturnValue(new Promise(() => undefined))
    const res = await Promise.race([
      post('t1', { body: 'still sends' }),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 2000)),
    ])
    expect(res).not.toBe('hung')
    expect((res as Response).status).toBe(200)
    expect(h.prisma.platformChatThread.findUnique).toHaveBeenCalled()
  })

  it('🛑 and a notification that REJECTS never becomes a failed send', async () => {
    const actual = await vi.importActual<typeof import('@/lib/chat-notifications/chatMessageNotifier')>(
      '@/lib/chat-notifications/chatMessageNotifier',
    )
    h.queueDm.mockImplementation(actual.queueDirectMessageNotifications)
    h.prisma.platformChatThread.findUnique.mockRejectedValue(new Error('db down'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await post('t1', { body: 'still sends' })
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 10))
    errors.mockRestore()
  })
})

describe('league chat send → opt-in league chat alert', () => {
  it('an ordinary league message queues the (opt-in) league alert', async () => {
    const res = await post('league:L1', { body: 'good luck this week' })
    expect(res.status).toBe(200)
    expect(h.queueLeague).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'L1', messageId: 'lm-1', senderUserId: 'u1', body: 'good luck this week' }),
    )
    expect(h.queueDm).not.toHaveBeenCalled()
  })

  it('a private Survivor ballot is never announced', async () => {
    h.processSurvivor.mockResolvedValue({ handled: true, ok: true, status: 200, intent: 'vote', message: 'ok' })
    await post('league:L1', { body: 'vote Team Alpha' })
    expect(h.queueLeague).not.toHaveBeenCalled()
  })

  it('a tribe room message is never announced league-wide', async () => {
    await post('league:L1', { body: 'tribe only', source: 'tribe:abc' })
    expect(h.queueLeague).not.toHaveBeenCalled()
  })
})
