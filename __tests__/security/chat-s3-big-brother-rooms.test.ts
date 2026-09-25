/**
 * S3 — Big Brother private rooms (HOH room, nominees, Have-Nots, jury house) are rows in league chat
 * tagged `metadata.bbChannel`. Only `/api/league/chat` applied the room rule. The shared-thread routes
 * (`/api/shared/chat/threads/league:<id>/messages` GET + POST, and `/search`) and the redraft
 * communication feed returned every room to any member, and the shared POST stored the client's
 * `bbChannel` with no write check — so anyone could read the jury house or post into the HOH room.
 *
 * The REAL rule runs here (lib/big-brother/bbChatChannelAccess.ts); only the live game state it asks
 * (`isBigBrotherLeague`, `getAccessibleBbChannels`) and the message store are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

type Channel = { key: string; canRead: boolean; canWrite: boolean }

const h = vi.hoisted(() => ({
  bigBrother: true,
  channels: [] as Channel[],
  messages: [] as Array<Record<string, unknown>>,
  createLeagueChatMessage: vi.fn(),
  prisma: {
    platformBlockedUser: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    bracketLeagueMember: { findUnique: vi.fn(async () => null) },
  },
}))

vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: async () => h.bigBrother }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: async () => h.channels }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'houseguest-1' }) }))
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
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => null),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => h.messages),
  createLeagueChatMessage: h.createLeagueChatMessage,
}))
vi.mock('@/lib/survivor/constants', () => ({ parseTribeIdFromSource: vi.fn(() => null) }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ getTribeChatMemberRosterIds: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({
  processSurvivorOfficialCommand: vi.fn(async () => ({ handled: false })),
}))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 1) }))
vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({ isMergeTriggered: vi.fn(async () => false) }))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelState: vi.fn(async () => null) }))
vi.mock('@/lib/ai/deterministic', () => ({ DETERMINISTIC_SOURCE: 'deterministic', tryDeterministicAnswer: vi.fn(async () => 'x') }))
vi.mock('@/lib/league-chat/LeagueMessageComposer', () => ({
  validateMessageBody: (body: string) => ({ valid: body.trim().length > 0 }),
}))

import { GET as threadGET, POST as threadPOST } from '@/app/api/shared/chat/threads/[threadId]/messages/route'
import { GET as searchGET } from '@/app/api/shared/chat/threads/[threadId]/search/route'
import { GET as redraftGET, POST as redraftPOST } from '@/app/api/redraft/communication/chat/route'

const MAIN_ONLY: Channel[] = [
  { key: 'main', canRead: true, canWrite: true },
  { key: 'hoh_room', canRead: false, canWrite: false },
  { key: 'nominees', canRead: false, canWrite: false },
  { key: 'have_nots', canRead: false, canWrite: false },
  { key: 'jury', canRead: false, canWrite: false },
]
const HOH: Channel[] = MAIN_ONLY.map((c) => (c.key === 'hoh_room' ? { ...c, canRead: true, canWrite: true } : c))

function msg(id: string, bbChannel?: string) {
  return {
    id,
    threadId: 'league:L1',
    senderUserId: 'someone',
    senderName: 'Someone',
    messageType: 'text',
    body: `secret plan ${id}`,
    createdAt: '2026-09-25T12:00:00.000Z',
    ...(bbChannel ? { metadata: { bbChannel } } : {}),
  }
}

const ALL_ROOMS = [msg('m-main', 'main'), msg('m-untagged'), msg('m-hoh', 'hoh_room'), msg('m-jury', 'jury'), msg('m-noms', 'nominees')]

async function readThread() {
  const req = createMockNextRequest('http://localhost/api/shared/chat/threads/league%3AL1/messages')
  const res = await threadGET(req as never, { params: { threadId: 'league%3AL1' } } as never)
  return { status: res.status, ids: (((await res.json()) as { messages?: Array<{ id: string }> }).messages ?? []).map((m) => m.id) }
}

async function search() {
  const req = createMockNextRequest('http://localhost/api/shared/chat/threads/league%3AL1/search?q=secret')
  const res = await searchGET(req as never, { params: { threadId: 'league%3AL1' } } as never)
  return ((await res.json()) as { messages: Array<{ id: string }> }).messages.map((m) => m.id)
}

async function postThread(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/shared/chat/threads/league%3AL1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return threadPOST(req as never, { params: { threadId: 'league%3AL1' } } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bigBrother = true
  h.channels = MAIN_ONLY
  h.messages = ALL_ROOMS
  h.createLeagueChatMessage.mockImplementation(async (_l: string, _u: string, body: string, opts: Record<string, unknown>) => ({
    id: 'new-1',
    body,
    metadata: opts.metadata,
  }))
})

describe('S3 reading a Big Brother league through the shared thread routes', () => {
  it('shows an ordinary houseguest the main house only', async () => {
    const { status, ids } = await readThread()
    expect(status).toBe(200)
    expect(ids).toEqual(['m-main', 'm-untagged'])
  })

  it('shows the Head of Household their room as well', async () => {
    h.channels = HOH
    expect((await readThread()).ids).toEqual(['m-main', 'm-untagged', 'm-hoh'])
  })

  it('search cannot reach a room the member cannot read', async () => {
    expect(await search()).toEqual(['m-main', 'm-untagged'])
  })

  it('the redraft communication feed applies the same rule', async () => {
    const req = createMockNextRequest('http://localhost/api/redraft/communication/chat?leagueId=L1')
    const res = await redraftGET(req as never)
    const ids = ((await res.json()) as { messages: Array<{ id: string }> }).messages.map((m) => m.id)
    expect(ids).toEqual(['m-main', 'm-untagged'])
  })

  it('leaves an ordinary (non-Big-Brother) league untouched', async () => {
    h.bigBrother = false
    expect((await readThread()).ids).toEqual(ALL_ROOMS.map((m) => m.id))
  })
})

describe('S3 posting into a Big Brother room through the shared thread route', () => {
  it('refuses a post into the HOH room from someone who is not in it', async () => {
    const res = await postThread({ body: 'let me in', metadata: { bbChannel: 'hoh_room' } })
    expect(res.status).toBe(403)
    expect(h.createLeagueChatMessage).not.toHaveBeenCalled()
  })

  it('lets the Head of Household post there, and records the room', async () => {
    h.channels = HOH
    const res = await postThread({ body: 'nominations tonight', metadata: { bbChannel: 'hoh_room' } })
    expect(res.status).toBe(200)
    const opts = h.createLeagueChatMessage.mock.calls[0]![3] as { metadata: Record<string, unknown> }
    expect(opts.metadata.bbChannel).toBe('hoh_room')
  })

  it('files an untagged post in the main house', async () => {
    await postThread({ body: 'hello house' })
    const opts = h.createLeagueChatMessage.mock.calls[0]![3] as { metadata: Record<string, unknown> }
    expect(opts.metadata.bbChannel).toBe('main')
  })

  it('the redraft communication POST refuses the same forged room', async () => {
    const req = createMockNextRequest('http://localhost/api/redraft/communication/chat', {
      method: 'POST',
      body: { leagueId: 'L1', body: 'jury talk', metadata: { bbChannel: 'jury' } },
    })
    const res = await redraftPOST(req as never)
    expect(res.status).toBe(403)
    expect(h.createLeagueChatMessage).not.toHaveBeenCalled()
  })
})
