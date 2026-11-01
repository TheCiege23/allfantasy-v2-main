import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League chat pins: only the commissioner and co-commissioners (with the chat permission) pin or
 * unpin. User's decision, 2026-10-31 — any member could pin before.
 *
 * Driven through the three route handlers with the REAL `getLeagueRole` and `leagueChatModerator`
 * over a small in-memory league, so the rule under test is the one production runs — the same rule
 * an @everyone announcement uses, minus the native-only part (a pin notifies nobody).
 */

type League = { id: string; userId: string; platform: string; settings: unknown }
type Team = { id?: string; leagueId: string; claimedByUserId: string | null; isCommissioner: boolean; isCoCommissioner: boolean; role: string | null }

const fx = vi.hoisted(() => ({
  user: '' as string,
  leagues: [] as League[],
  teams: [] as Team[],
  pinsCreated: [] as Array<{ leagueId: string; userId: string; body: string }>,
  pinsDeleted: [] as string[],
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: fx.user })) }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async (leagueId: string) => ({ leagueId })) }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null) }))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (threadId: string) => threadId.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (threadId: string) => threadId.replace(/^league:/, ''),
}))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThreadTypedMessage: vi.fn(),
  deletePinMessage: vi.fn(),
  getPlatformThreadMessages: vi.fn(async () => []),
}))
vi.mock('@/lib/chat-core/league-message-proxy', () => ({ bracketMessagesToPlatform: vi.fn(() => []) }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: vi.fn(async (leagueId: string, userId: string, body: string) => {
    fx.pinsCreated.push({ leagueId, userId, body })
    return { id: `pin-${fx.pinsCreated.length}` }
  }),
  getLeagueChatMessages: vi.fn(async () => [{ id: 'pin-old', messageType: 'pin' }]),
}))

vi.mock('@/lib/prisma', () => {
  const matchTeam = (t: Team, where: Record<string, unknown>) =>
    t.leagueId === where.leagueId && t.claimedByUserId === where.claimedByUserId &&
    (where.isCoCommissioner === undefined || t.isCoCommissioner === where.isCoCommissioner)
  const prisma = {
    league: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => fx.leagues.find((l) => l.id === where.id) ?? null) },
    leagueTeam: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => fx.teams.find((t) => matchTeam(t, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => fx.teams.filter((t) => matchTeam(t, where))),
    },
    roster: { findFirst: vi.fn(async () => null) },
    bracketLeagueMember: { findUnique: vi.fn(async () => null) },
    leagueChatMessage: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ message: `message ${where.id}` })),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        fx.pinsDeleted.push(where.id)
        return { count: 1 }
      }),
    },
  }
  return { prisma, default: prisma }
})

import { POST as pin } from '@/app/api/shared/chat/threads/[threadId]/pin/route'
import { POST as unpin } from '@/app/api/shared/chat/threads/[threadId]/unpin/route'
import { GET as pinned } from '@/app/api/shared/chat/threads/[threadId]/pinned/route'

const ctx = { params: Promise.resolve({ threadId: 'league:HOME' }) }
const json = (body: unknown) =>
  new Request('http://localhost/api/shared/chat/threads/league:HOME/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
const team = (claimedByUserId: string, flags: Partial<Team> = {}): Team => ({
  leagueId: 'HOME',
  claimedByUserId,
  isCommissioner: false,
  isCoCommissioner: false,
  role: null,
  ...flags,
})

beforeEach(() => {
  fx.pinsCreated = []
  fx.pinsDeleted = []
  fx.leagues = [{ id: 'HOME', userId: 'owner', platform: 'sleeper', settings: {} }]
  fx.teams = [team('owner', { isCommissioner: true }), team('co', { id: 'coTeam', isCoCommissioner: true }), team('member')]
})

describe('league chat pins', () => {
  it('refuses a plain member, pins nothing, and says who can', async () => {
    fx.user = 'member'
    const res = await pin(json({ messageId: 'm1' }), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/commissioner and co-commissioners/)
    expect(fx.pinsCreated).toEqual([])
  })

  it('lets the commissioner pin — in an imported league too, which announcements refuse', async () => {
    fx.user = 'owner'
    const res = await pin(json({ messageId: 'm1' }), ctx)
    expect(res.status).toBe(200)
    expect(fx.pinsCreated).toEqual([{ leagueId: 'HOME', userId: 'owner', body: JSON.stringify({ messageId: 'm1', snippet: 'message m1' }) }])
  })

  it('lets a co-commissioner pin, unless the commissioner took away their chat permission', async () => {
    fx.user = 'co'
    expect((await pin(json({ messageId: 'm1' }), ctx)).status).toBe(200)

    fx.leagues[0].settings = { co_commissioner_scopes: { coTeam: ['trades'] } }
    expect((await pin(json({ messageId: 'm2' }), ctx)).status).toBe(403)
    expect(fx.pinsCreated).toHaveLength(1)
  })

  it('refuses a co-commissioner whose claimed team is viewer-only', async () => {
    fx.user = 'co'
    fx.teams[1].role = 'viewer'
    expect((await pin(json({ messageId: 'm1' }), ctx)).status).toBe(403)
  })

  it('applies the same rule to unpin', async () => {
    fx.user = 'member'
    expect((await unpin(json({ pinMessageId: 'pin-old' }), ctx)).status).toBe(403)
    expect(fx.pinsDeleted).toEqual([])

    fx.user = 'co'
    expect((await unpin(json({ pinMessageId: 'pin-old' }), ctx)).status).toBe(200)
    expect(fx.pinsDeleted).toEqual(['pin-old'])
  })

  it('shows every member the board, and tells the conversation who may change it', async () => {
    fx.user = 'member'
    const asMember = await (await pinned(new Request('http://localhost') as never, ctx)).json()
    expect(asMember).toMatchObject({ pinned: [{ id: 'pin-old' }], canPin: false })

    fx.user = 'owner'
    expect(await (await pinned(new Request('http://localhost') as never, ctx)).json()).toMatchObject({ canPin: true })
  })
})
