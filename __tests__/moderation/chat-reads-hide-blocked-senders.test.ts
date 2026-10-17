// @vitest-environment node
/**
 * Four chat READ routes that showed the messages of people the viewer had blocked — league chat's
 * GET was fixed on 2026-09-25, these were not. Each must: hide a blocked sender, keep the viewer's
 * own and author-less rows, and answer 503 — never an unfiltered transcript — when the block list
 * cannot be read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const blockList = vi.hoisted(() => ({ fn: vi.fn<(u: string) => Promise<Set<string>>>() }))
vi.mock('@/lib/moderation/BlockUserService', async () => {
  class BlockListUnavailableError extends Error {}
  return { BlockListUnavailableError, getBlockedSenderSetForRead: (u: string) => blockList.fn(u) }
})

const prismaMock = vi.hoisted(() => ({
  draftRoomChatMessage: { findMany: vi.fn() },
  mockDraftChat: { findMany: vi.fn() },
  bracketLeagueMember: { findUnique: vi.fn() },
  bracketLeagueMessage: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/draft/access', () => ({ canAccessLeague: async () => true }))
vi.mock('@/lib/mock-draft-engine/MockDraftSessionService', () => ({ canAccessMockDraft: async () => true }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'me' }) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/big-brother/bbChatChannelAccess', () => ({
  filterBbReadableMessages: async (_l: string, _u: string, m: unknown[]) => m,
  resolveBbWriteChannel: vi.fn(),
}))
const leagueMsgs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ getLeagueChatMessages: leagueMsgs, createLeagueChatMessage: vi.fn() }))

import { BlockListUnavailableError } from '@/lib/moderation/BlockUserService'

const T = new Date('2026-09-29T02:00:00.000Z')
const outage = () =>
  blockList.fn.mockImplementation(async () => {
    throw new BlockListUnavailableError('down')
  })

beforeEach(() => {
  vi.clearAllMocks()
  blockList.fn.mockImplementation(async () => new Set(['sam']))
  prismaMock.draftRoomChatMessage.findMany.mockResolvedValue([
    { id: 'd-sam', userId: 'sam', authorDisplayName: 'Sam', authorAvatar: null, message: 'x', type: 'user', createdAt: T },
    { id: 'd-me', userId: 'me', authorDisplayName: 'Me', authorAvatar: null, message: 'y', type: 'user', createdAt: T },
    { id: 'd-sys', userId: null, authorDisplayName: null, authorAvatar: null, message: 'pick', type: 'system', createdAt: T },
  ])
  prismaMock.mockDraftChat.findMany.mockResolvedValue([
    { id: 'k-sam', userId: 'sam', displayName: 'Sam', content: 'x', createdAt: T },
    { id: 'k-jo', userId: 'jo', displayName: 'Jo', content: 'y', createdAt: T },
  ])
  prismaMock.bracketLeagueMember.findUnique.mockResolvedValue({ id: 'mem' })
  prismaMock.bracketLeagueMessage.findMany.mockResolvedValue([
    { id: 'b-sam', userId: 'sam', message: 'x', createdAt: T },
    { id: 'b-jo', userId: 'jo', message: 'y', createdAt: T },
  ])
  leagueMsgs.mockResolvedValue([
    { id: 'l-sam', senderUserId: 'sam', body: 'x' },
    { id: 'l-me', senderUserId: 'me', body: 'y' },
    { id: 'l-sys', senderUserId: null, body: 'notice' },
  ])
})

async function draftHistory() {
  const { GET } = await import('@/app/api/draft/chat/history/route')
  const res = await GET(createMockNextRequest('http://localhost/api/draft/chat/history?sessionId=live:L1') as never)
  return { status: res.status, data: (await res.json()) as { messages?: Array<{ id: string; authorUserId?: string | null }> } }
}
async function mockChat() {
  const { GET } = await import('@/app/api/mock-draft/[draftId]/chat/route')
  const res = await GET(createMockNextRequest('http://localhost/api/mock-draft/D9/chat') as never, { params: Promise.resolve({ draftId: 'D9' }) })
  return { status: res.status, data: (await res.json()) as { messages?: Array<{ id: string }>; viewerUserId?: string } }
}
async function bracketChat() {
  const { GET } = await import('@/app/api/bracket/leagues/[leagueId]/chat/route')
  const res = await GET(createMockNextRequest('http://localhost/api/bracket/leagues/B1/chat') as never, { params: { leagueId: 'B1' } })
  return { status: res.status, data: (await res.json()) as { messages?: Array<{ id: string }> } }
}
async function redraftChat() {
  const { GET } = await import('@/app/api/redraft/communication/chat/route')
  const res = await GET(createMockNextRequest('http://localhost/api/redraft/communication/chat?leagueId=L1') as never)
  return { status: res.status, data: (await res.json()) as { messages?: Array<{ id: string }> } }
}
const ids = (d: { messages?: Array<{ id: string }> }) => (d.messages ?? []).map((m) => m.id)

describe('draft shell chat history', () => {
  it('hides a blocked sender, keeps you and system rows, and now returns each author', async () => {
    const { status, data } = await draftHistory()
    expect(status).toBe(200)
    expect(ids(data)).toEqual(['d-me', 'd-sys'])
    expect(data.messages?.find((m) => m.id === 'd-me')?.authorUserId).toBe('me')
  })
  it('answers 503 when the block list cannot be read', async () => {
    outage()
    const { status, data } = await draftHistory()
    expect(status).toBe(503)
    expect(data.messages).toBeUndefined()
  })
})

describe('mock draft chat', () => {
  it('hides a blocked sender and tells the panel who is reading', async () => {
    const { status, data } = await mockChat()
    expect(status).toBe(200)
    expect(ids(data)).toEqual(['k-jo'])
    expect(data.viewerUserId).toBe('me')
  })
  it('answers 503 when the block list cannot be read', async () => {
    outage()
    expect((await mockChat()).status).toBe(503)
  })
})

describe('bracket pool chat', () => {
  it('hides a blocked sender', async () => {
    const { status, data } = await bracketChat()
    expect(status).toBe(200)
    expect(ids(data)).toEqual(['b-jo'])
  })
  it('answers 503 when the block list cannot be read', async () => {
    outage()
    expect((await bracketChat()).status).toBe(503)
  })
})

describe('redraft communication chat', () => {
  it('hides a blocked sender, keeps you and author-less notices', async () => {
    const { status, data } = await redraftChat()
    expect(status).toBe(200)
    expect(ids(data)).toEqual(['l-me', 'l-sys'])
  })
  it('answers 503 when the block list cannot be read', async () => {
    outage()
    expect((await redraftChat()).status).toBe(503)
  })
})

describe('[control] with nobody blocked, every row comes through', () => {
  it('all four routes', async () => {
    blockList.fn.mockImplementation(async () => new Set())
    expect(ids((await draftHistory()).data)).toEqual(['d-sam', 'd-me', 'd-sys'])
    expect(ids((await mockChat()).data)).toEqual(['k-sam', 'k-jo'])
    expect(ids((await bracketChat()).data).sort()).toEqual(['b-jo', 'b-sam'])
    expect(ids((await redraftChat()).data)).toEqual(['l-sam', 'l-me', 'l-sys'])
  })
})
