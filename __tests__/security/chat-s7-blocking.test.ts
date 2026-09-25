/**
 * S7 — blocking.
 *
 *  1. Nothing stopped a NEW conversation across a block: a blocked user could open a fresh DM with the
 *     person who blocked them (`/api/shared/chat/threads`, `/api/shared/chat/dm/start`), or pull them
 *     into a huddle (`…/members`). Refused now in BOTH directions, with one neutral message that says
 *     nothing about who blocked whom, and a failed lookup refuses too.
 *  2. The read filter failed OPEN: the block lookup answered `[]` on any error, which hides nobody, so
 *     a database blip showed the viewer the messages of everyone they had blocked. It now retries once
 *     and then refuses the read (503) rather than serving it unfiltered.
 *
 * The REAL routes and the REAL BlockUserService run; the block table is an in-memory fake whose
 * `findFirst` / `findMany` evaluate the route's own `where`, so direction is tested, not assumed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

type Block = { id: string; blockerUserId: string; blockedUserId: string }
type IdFilter = string | { in: string[] }

const h = vi.hoisted(() => ({
  me: 'me',
  blocks: [] as Array<{ id: string; blockerUserId: string; blockedUserId: string }>,
  findManyFailures: 0,
  findManyError: null as unknown,
  findFirstError: null as unknown,
  createPlatformThread: vi.fn(),
  addThreadParticipants: vi.fn(),
  getThreadMembers: vi.fn(),
  getPlatformThreadMessages: vi.fn(),
  appUsers: [] as Array<{ id: string; username: string }>,
}))

function matches(value: string, filter: IdFilter | undefined): boolean {
  if (filter === undefined) return true
  return typeof filter === 'string' ? value === filter : filter.in.includes(value)
}
function rowMatches(row: Block, where: { blockerUserId?: IdFilter; blockedUserId?: IdFilter }): boolean {
  return matches(row.blockerUserId, where.blockerUserId) && matches(row.blockedUserId, where.blockedUserId)
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformBlockedUser: {
      findFirst: async ({ where }: { where: { OR?: Array<Record<string, IdFilter>> } & Record<string, IdFilter> }) => {
        if (h.findFirstError) throw h.findFirstError
        const clauses = where.OR ?? [where]
        return h.blocks.find((row) => clauses.some((c) => rowMatches(row, c))) ?? null
      },
      findMany: async ({ where }: { where: { blockerUserId: string } }) => {
        if (h.findManyFailures > 0) {
          h.findManyFailures -= 1
          throw h.findManyError ?? new Error('connection reset')
        }
        return h.blocks.filter((row) => row.blockerUserId === where.blockerUserId)
      },
    },
    appUser: {
      findMany: async ({ where }: { where: { OR: Array<{ username: { equals: string } }> } }) =>
        h.appUsers.filter((u) =>
          where.OR.some((c) => c.username.equals.toLowerCase() === u.username.toLowerCase()),
        ),
      findFirst: async ({ where }: { where: { username: { equals: string } } }) =>
        h.appUsers.find((u) => u.username.toLowerCase() === where.username.equals.toLowerCase()) ?? null,
    },
  },
}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: h.me }) }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThread: h.createPlatformThread,
  getPlatformChatThreads: vi.fn(async () => []),
  addThreadParticipants: h.addThreadParticipants,
  getThreadMembers: h.getThreadMembers,
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

import { POST as createThread } from '@/app/api/shared/chat/threads/route'
import { POST as startDm } from '@/app/api/shared/chat/dm/start/route'
import { POST as addMembers } from '@/app/api/shared/chat/threads/[threadId]/members/route'
import { GET as readMessages } from '@/app/api/shared/chat/threads/[threadId]/messages/route'

function jsonReq(url: string, body: unknown) {
  return createMockNextRequest(url, { method: 'POST', body })
}
async function create(body: Record<string, unknown>) {
  const res = await createThread(jsonReq('http://localhost/api/shared/chat/threads', body) as never)
  return { status: res.status, json: (await res.json()) as { error?: string } }
}
async function read() {
  const res = await readMessages(
    createMockNextRequest('http://localhost/api/shared/chat/threads/t1/messages') as never,
    { params: { threadId: 't1' } } as never,
  )
  return { status: res.status, json: (await res.json()) as { messages?: Array<{ id: string }>; error?: string } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.me = 'me'
  h.blocks = []
  h.findManyFailures = 0
  h.findManyError = null
  h.findFirstError = null
  h.appUsers = [
    { id: 'them', username: 'rival' },
    { id: 'friend', username: 'pal' },
  ]
  h.createPlatformThread.mockResolvedValue({ id: 't-new', threadType: 'dm' })
  h.addThreadParticipants.mockResolvedValue(true)
  h.getThreadMembers.mockResolvedValue([])
  h.getPlatformThreadMessages.mockResolvedValue([
    { id: 'from-them', senderUserId: 'them', body: 'hi' },
    { id: 'from-friend', senderUserId: 'friend', body: 'yo' },
  ])
})

describe('S7 a block stops a NEW conversation, in both directions', () => {
  it('refuses a DM with someone who has blocked me', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'them', blockedUserId: 'me' }]
    const { status, json } = await create({ threadType: 'dm', memberUserIds: ['them'] })
    expect(status).toBe(403)
    expect(h.createPlatformThread).not.toHaveBeenCalled()
    expect(json.error).not.toMatch(/block/i)
  })

  it('refuses a DM with someone I have blocked — with the SAME words, so direction is not revealed', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'them', blockedUserId: 'me' }]
    const blockedByThem = (await create({ threadType: 'dm', memberUserIds: ['them'] })).json.error
    h.blocks = [{ id: 'b2', blockerUserId: 'me', blockedUserId: 'them' }]
    const { status, json } = await create({ threadType: 'dm', usernames: ['rival'] })
    expect(status).toBe(403)
    expect(json.error).toBe(blockedByThem)
    expect(h.createPlatformThread).not.toHaveBeenCalled()
  })

  it('refuses a huddle that includes a blocker, and an `ai` thread used the same way', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'them', blockedUserId: 'me' }]
    expect((await create({ threadType: 'group', memberUserIds: ['friend', 'them'] })).status).toBe(403)
    expect((await create({ threadType: 'ai', memberUserIds: ['them'] })).status).toBe(403)
    expect(h.createPlatformThread).not.toHaveBeenCalled()
  })

  it('still creates a conversation when nobody is blocked', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'them', blockedUserId: 'somebody-else' }]
    expect((await create({ threadType: 'dm', memberUserIds: ['them'] })).status).toBe(200)
    expect(h.createPlatformThread).toHaveBeenCalledTimes(1)
  })

  it('refuses (503) rather than guessing when the block lookup fails', async () => {
    h.findFirstError = new Error('connection reset')
    expect((await create({ threadType: 'dm', memberUserIds: ['them'] })).status).toBe(503)
    expect(h.createPlatformThread).not.toHaveBeenCalled()
  })

  it('/dm/start refuses across a block', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'them', blockedUserId: 'me' }]
    const res = await startDm(jsonReq('http://localhost/api/shared/chat/dm/start', { username: 'rival' }) as never)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).not.toMatch(/block/i)
    expect(h.createPlatformThread).not.toHaveBeenCalled()
  })

  it('adding a blocker to an existing huddle is refused', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'them', blockedUserId: 'me' }]
    const res = await addMembers(
      jsonReq('http://localhost/api/shared/chat/threads/t1/members', { memberUserIds: ['them'] }) as never,
      { params: { threadId: 't1' } } as never,
    )
    expect(res.status).toBe(403)
    expect(h.addThreadParticipants).not.toHaveBeenCalled()
  })
})

describe('S7 the read filter fails CLOSED', () => {
  it('hides messages from people I blocked (the normal path)', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'me', blockedUserId: 'them' }]
    const { status, json } = await read()
    expect(status).toBe(200)
    expect(json.messages!.map((m) => m.id)).toEqual(['from-friend'])
  })

  it('refuses the read when the block list cannot be loaded, instead of showing blocked users', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'me', blockedUserId: 'them' }]
    h.findManyFailures = 2
    const { status, json } = await read()
    expect(status).toBe(503)
    expect(json.messages).toBeUndefined()
    expect(h.getPlatformThreadMessages).not.toHaveBeenCalled()
  })

  it('survives a single blip: one retry, then the filtered read', async () => {
    h.blocks = [{ id: 'b1', blockerUserId: 'me', blockedUserId: 'them' }]
    h.findManyFailures = 1
    const { status, json } = await read()
    expect(status).toBe(200)
    expect(json.messages!.map((m) => m.id)).toEqual(['from-friend'])
  })

  it('treats a missing block table (P2021) as "nobody is blocked", which is then true', async () => {
    h.findManyFailures = 2
    h.findManyError = Object.assign(new Error('table does not exist'), { code: 'P2021' })
    const { status, json } = await read()
    expect(status).toBe(200)
    expect(json.messages!.map((m) => m.id)).toEqual(['from-them', 'from-friend'])
  })
})
