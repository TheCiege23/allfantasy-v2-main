/**
 * Every `@chimmy …` message is between that manager and Chimmy. A ballot was already private; a
 * sit-out nomination, an idol play or a challenge pick typed as `@chimmy …` was stored as a PUBLIC
 * row once the official command succeeded, so the tribe could read who was being sat out. The
 * shared thread route now keeps the prompt and Chimmy's confirmation private for every intent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createLeagueChatMessage: vi.fn(),
  command: vi.fn(),
  prisma: {
    platformBlockedUser: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    bracketLeagueMember: { findUnique: vi.fn(async () => null) },
  },
}))

vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: async () => false }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: async () => [] }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'manager-1' }) }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThreadMessage: vi.fn(),
  createSystemMessage: vi.fn(),
  getPlatformThreadMessages: vi.fn(async () => []),
  searchPlatformThreadMessages: vi.fn(async () => []),
}))
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
vi.mock('@/lib/chat-core/chimmyPrivateReply', () => ({ generateChimmyPrivateReply: vi.fn(async () => 'answer') }))
vi.mock('@/lib/chat-core/league-message-proxy', () => ({ bracketMessagesToPlatform: vi.fn(() => []) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => []),
  createLeagueChatMessage: h.createLeagueChatMessage,
}))
vi.mock('@/lib/survivor/survivorTribeChatAccess', () => ({ canAccessSurvivorTribeChatSource: vi.fn(async () => true) }))
vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({ processSurvivorOfficialCommand: h.command }))
vi.mock('@/lib/survivor/SurvivorCommandParser', () => ({
  looksLikeOfficialCommand: (text: string) => /^(sit out|vote|play idol)\b/i.test(text),
  parseSurvivorCommand: (text: string) => ({ intent: /^sit out\b/i.test(text) ? 'sit_out_nominate' : /^play idol\b/i.test(text) ? 'play_idol' : /^vote\b/i.test(text) ? 'vote' : null }),
}))
vi.mock('@/lib/survivor-guillotine/live', () => ({ activateSGLivePower: vi.fn(async () => null) }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn(async () => null) }))
vi.mock('@/lib/ai/deterministic', () => ({ DETERMINISTIC_SOURCE: 'deterministic', tryDeterministicAnswer: vi.fn(async () => 'x') }))
vi.mock('@/lib/league-chat/LeagueMessageComposer', () => ({
  validateMessageBody: (body: string) => ({ valid: body.trim().length > 0 }),
}))
vi.mock('@/lib/discord/syncOutboundLeagueChat', () => ({ syncOutboundLeagueChat: vi.fn(async () => undefined) }))

import { POST as threadPOST } from '@/app/api/shared/chat/threads/[threadId]/messages/route'

async function post(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/shared/chat/threads/league%3AL1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await threadPOST(req as never, { params: { threadId: 'league%3AL1' } } as never)
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

type Call = [string, string, string, Record<string, unknown>]

beforeEach(() => {
  vi.clearAllMocks()
  h.createLeagueChatMessage.mockImplementation(async (_l: string, _u: string, body: string, opts: Record<string, unknown>) => ({ id: `row-${h.createLeagueChatMessage.mock.calls.length}`, body, metadata: opts.metadata, senderName: 'Sam' }))
  h.command.mockImplementation(async ({ command }: { command: string }) => {
    if (/^@chimmy\s+sit out\b/i.test(command)) return { handled: true, ok: true, intent: 'sit_out_nominate', message: 'Sam is nominated to sit out this week.' }
    if (/^@chimmy\s+play idol\b/i.test(command)) return { handled: true, ok: true, intent: 'play_idol', message: 'Idol played.' }
    return { handled: false }
  })
})

describe('@chimmy commands in the shared thread route stay private', () => {
  it('a sit-out nomination typed in the tribe huddle is stored for the sender only, with a private confirmation', async () => {
    const { status, json } = await post({ body: '@chimmy sit out Sam', source: 'tribe_t1' })
    expect(status).toBe(200)
    const calls = h.createLeagueChatMessage.mock.calls as Call[]
    expect(calls).toHaveLength(2)
    const [, , promptBody, promptOpts] = calls[0]
    expect(promptBody).toBe('@chimmy sit out Sam')
    expect(promptOpts).toMatchObject({ isPrivate: true, visibleToUserId: 'manager-1', source: 'tribe_t1', messageSubtype: 'chimmy_prompt' })
    const [, , replyBody, replyOpts] = calls[1]
    expect(replyBody).toBe('Sam is nominated to sit out this week.')
    expect(replyOpts).toMatchObject({ isPrivate: true, visibleToUserId: 'manager-1', messageSubtype: 'chimmy_private_response' })
    expect(json.commandResult).toMatchObject({ ok: true, intent: 'sit_out_nominate' })
  })

  it('an idol play typed in league chat is private too', async () => {
    await post({ body: '@chimmy play idol', source: null })
    const calls = h.createLeagueChatMessage.mock.calls as Call[]
    expect(calls.every(([, , , opts]) => opts.isPrivate === true && opts.visibleToUserId === 'manager-1')).toBe(true)
  })

  it('an ordinary message without @chimmy stays public', async () => {
    await post({ body: 'good luck everyone', source: null })
    const calls = h.createLeagueChatMessage.mock.calls as Call[]
    expect(calls).toHaveLength(1)
    expect(calls[0][3].isPrivate).toBeUndefined()
  })
})
