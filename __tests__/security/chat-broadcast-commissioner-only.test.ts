/**
 * `/api/shared/chat/threads/[threadId]/broadcast` let ANY thread member post a `broadcast` — the
 * commissioner-announcement style. A broadcast now needs the head commissioner or a co-commissioner
 * of a league the thread belongs to, and that league is derived SERVER-SIDE:
 *   - `league:<id>` virtual rooms carry it in the id;
 *   - a stored `settings.leagueChatThreadId` link counts only when it passes the write-side check
 *     (lib/league/leagueChatThreadLink.ts): the league's own `league:<id>` room. A platform thread
 *     records no league, so a link naming one — a DM or huddle the commissioner happens to be in —
 *     is ignored, which also covers rows saved before the writers were checked.
 * The client's `leagueIds` (CommissionerBroadcastForm sends them) are never trusted.
 *
 * The REAL route runs. The League table is an in-memory fake whose `findMany` evaluates the JSON-path
 * filter the route sends, so the thread → league derivation is exercised, not assumed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeLeague = { id: string; settings: Record<string, unknown> | null }

const h = vi.hoisted(() => ({
  me: 'u-me',
  leagues: [] as Array<{ id: string; settings: Record<string, unknown> | null }>,
  roles: {} as Record<string, string | null>,
  create: vi.fn(),
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: h.me }) }))
vi.mock('@/lib/platform/chat-service', () => ({ createPlatformThreadTypedMessage: h.create }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async (leagueId: string) => h.roles[leagueId] ?? null),
}))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (threadId: string) => threadId.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (threadId: string) => threadId.replace(/^league:/, '') || null,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: async ({ where }: { where: { settings: { path: string[]; equals: unknown } } }) => {
        const { path, equals } = where.settings
        return h.leagues
          .filter((l: FakeLeague) => {
            let v: unknown = l.settings
            for (const key of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined
            return v === equals
          })
          .map((l: FakeLeague) => ({ id: l.id }))
      },
    },
  },
}))

import { POST } from '@/app/api/shared/chat/threads/[threadId]/broadcast/route'

async function broadcast(threadId: string, extra: Record<string, unknown> = {}) {
  const req = new Request(`http://localhost/api/shared/chat/threads/${encodeURIComponent(threadId)}/broadcast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ announcement: 'Trade deadline is Friday', ...extra }),
  })
  return POST(req as never, { params: { threadId: encodeURIComponent(threadId) } } as never)
}

beforeEach(() => {
  h.create.mockReset()
  h.create.mockResolvedValue({ id: 'b-1', messageType: 'broadcast' })
  h.leagues = [
    { id: 'L-linked', settings: { leagueChatThreadId: 'thread-league-chat' } },
    // Bad links already saved: my own leagues pointed at a DM and a huddle I am a member of (the
    // real `createPlatformThreadTypedMessage` checks only membership, so it would post there).
    { id: 'L-mine', settings: { leagueChatThreadId: 'thread-my-dm' } },
    { id: 'L-mine-2', settings: { leagueChatThreadId: 'thread-my-huddle' } },
    { id: 'L-nolink', settings: {} },
  ]
  h.roles = { 'L-linked': 'member', 'L-mine': 'commissioner', 'L-mine-2': 'co_commissioner', 'L-nolink': 'commissioner' }
})

describe('broadcast is for the commissioner of the league the thread belongs to', () => {
  it('refuses an ordinary member of the linked league', async () => {
    const res = await broadcast('thread-league-chat')
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it("ignores client-sent leagueIds — commissioning ANOTHER league does not unlock this thread", async () => {
    const res = await broadcast('thread-league-chat', { leagueIds: ['L-mine'], notifyEveryone: true })
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses a thread no league links to (a DM or unlinked huddle), even for a commissioner elsewhere', async () => {
    const res = await broadcast('thread-some-dm', { leagueIds: ['L-nolink'] })
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it.each([
    ['a DM', 'thread-my-dm', 'L-mine'],
    ['a huddle', 'thread-my-huddle', 'L-mine-2'],
  ])(
    "ignores a bad link already stored — %s its own commissioner linked is not the league's chat",
    async (_label, threadId, leagueId) => {
      const res = await broadcast(threadId, { leagueIds: [leagueId], notifyEveryone: true })
      expect(res.status).toBe(403)
      expect(h.create).not.toHaveBeenCalled()
    },
  )

  it('ignores a platform-thread link even for the commissioner of the league that stored it', async () => {
    h.roles['L-linked'] = 'commissioner'
    expect((await broadcast('thread-league-chat')).status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it("lets the head commissioner broadcast into their league's own room", async () => {
    h.roles['L-linked'] = 'commissioner'
    const res = await broadcast('league:L-linked', { leagueIds: ['L-linked'], notifyEveryone: true })
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith('u-me', 'league:L-linked', 'broadcast', { announcement: 'Trade deadline is Friday' })
  })

  it('lets a co-commissioner broadcast too', async () => {
    h.roles['L-linked'] = 'co_commissioner'
    expect((await broadcast('league:L-linked')).status).toBe(200)
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('derives the league of a league:<id> room from the id itself', async () => {
    expect((await broadcast('league:L-linked')).status).toBe(403)
    h.roles['L-linked'] = 'commissioner'
    await broadcast('league:L-linked')
    expect(h.create).toHaveBeenCalledTimes(1)
  })
})
