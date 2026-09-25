import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

/*
 * How league chat and the draft room point at each other — one table, two views, no schema
 * change (see lib/league-chat/draftChatLink.ts):
 *   - league chat folds the draft room in, tagged, while a draft is live; the pick feed stays out;
 *   - the reader's explicit includeDraft=1/0 wins;
 *   - the response names the draft and where its room is.
 */

const h = vi.hoisted(() => ({
  draftSession: { findFirst: vi.fn() },
  getLeagueChatMessages: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: async () => ({ leagueId: 'l1' }) }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: async () => false }))
vi.mock('@/lib/big-brother/BigBrotherChatChannels', () => ({ getAccessibleBbChannels: async () => [] }))
vi.mock('@/lib/chat-core/chatPresence', () => ({ markViewingChat: vi.fn(async () => false), readChatPresence: vi.fn(async () => []) }))
vi.mock('@/lib/chat-core/leagueChatRead', () => ({ markLeagueChatRead: vi.fn() }))
vi.mock('@/lib/league-chat/tradeChatCards', () => ({ syncTradeCardsForLeague: vi.fn(async () => undefined) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: h.draftSession,
    appUser: { findUnique: async () => ({ displayName: 'Casey', username: 'casey' }) },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: h.getLeagueChatMessages,
  createLeagueChatMessage: vi.fn(),
}))

import { resolveIncludeDraft, draftRoomHref } from '@/lib/league-chat/draftChatLink'
import { readLeagueDraftLink } from '@/lib/league-chat/readLeagueDraftLink'

type Body = {
  includeDraft: boolean
  draft: { live: boolean; status: string; href: string } | null
  messages: Array<{ id: string; source: string | null }>
}

async function get(query: string): Promise<Body> {
  const { GET } = await import('@/app/api/league/chat/route')
  const res = await GET(createMockNextRequest(`http://localhost/api/league/chat?leagueId=l1${query}`) as never)
  return (await res.json()) as Body
}

beforeEach(() => {
  h.draftSession.findFirst.mockReset()
  h.getLeagueChatMessages.mockReset().mockResolvedValue([
    { id: 'm1', senderUserId: 'u2', senderName: 'Sam', senderAvatarUrl: null, body: 'hi', createdAt: '2026-09-25T12:00:00.000Z', messageType: 'text', channelSource: null },
    { id: 'm2', senderUserId: 'u3', senderName: 'Kim', senderAvatarUrl: null, body: 'mock at 9?', createdAt: '2026-09-25T12:01:00.000Z', messageType: 'text', channelSource: 'draft' },
  ])
})

describe('resolveIncludeDraft', () => {
  it('follows the draft when the reader has not chosen, and the reader when they have', () => {
    expect(resolveIncludeDraft(null, true)).toBe(true)
    expect(resolveIncludeDraft(undefined, false)).toBe(false)
    expect(resolveIncludeDraft('0', true)).toBe(false)
    expect(resolveIncludeDraft('1', false)).toBe(true)
    expect(resolveIncludeDraft('yes', false)).toBe(false)
  })

  it('points at the league draft room', () => {
    expect(draftRoomHref('a b')).toBe('/league/a%20b/draft')
  })
})

describe('readLeagueDraftLink', () => {
  it('reads live for in_progress and paused, and not for a finished draft', async () => {
    h.draftSession.findFirst.mockResolvedValueOnce({ status: 'in_progress' })
    expect(await readLeagueDraftLink('l1')).toEqual({ live: true, status: 'in_progress', href: '/league/l1/draft' })
    h.draftSession.findFirst.mockResolvedValueOnce({ status: 'paused' })
    expect((await readLeagueDraftLink('l1'))?.live).toBe(true)
    h.draftSession.findFirst.mockResolvedValueOnce({ status: 'completed' })
    expect((await readLeagueDraftLink('l1'))?.live).toBe(false)
  })

  it('never throws — a chat must not fail because the draft lookup did', async () => {
    h.draftSession.findFirst.mockRejectedValueOnce(new Error('db down'))
    expect(await readLeagueDraftLink('l1')).toBeNull()
    h.draftSession.findFirst.mockResolvedValueOnce(null)
    expect(await readLeagueDraftLink('l1')).toBeNull()
  })
})

describe('GET /api/league/chat and the draft room', () => {
  /*
   * One request per case, several assertions each: re-entering this route inside one file
   * has hung the runner before (league-chat-get-excludes-pins.test.ts).
   */
  it('while a draft is live: folds the draft room in, keeps picks out, tags each row, names the room', async () => {
    h.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
    const data = await get('')
    expect(h.getLeagueChatMessages).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ includeDraftRoom: true, excludeMessageTypes: ['draft_pick'] }),
    )
    expect(data.includeDraft).toBe(true)
    expect(data.draft).toEqual({ live: true, status: 'in_progress', href: '/league/l1/draft' })
    expect(data.messages.map((m) => m.source)).toEqual([null, 'draft'])
  })

  it('the reader turning the draft room off wins, even mid-draft', async () => {
    h.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
    const data = await get('&includeDraft=0')
    const opts = h.getLeagueChatMessages.mock.calls[0]![1] as Record<string, unknown>
    expect(opts.includeDraftRoom).toBe(false)
    expect(opts.excludeMessageTypes).toBeUndefined()
    expect(data.includeDraft).toBe(false)
  })

  it('with no draft running, league chat is league chat', async () => {
    h.draftSession.findFirst.mockResolvedValue({ status: 'completed' })
    const data = await get('')
    expect((h.getLeagueChatMessages.mock.calls[0]![1] as Record<string, unknown>).includeDraftRoom).toBe(false)
    expect(data.draft?.live).toBe(false)
  })
})
