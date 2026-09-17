import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @everyone announcements: the head commissioner AND co-commissioners may send, and the composer's
 * league list offers exactly the leagues the send accepts. User's decision, 2026-09-17.
 *
 * Driven through both route handlers, with the real `getLeagueRole` over a small in-memory
 * league/team fixture, so the permission rule under test is the one production runs.
 */

type League = { id: string; userId: string; platform: string; name: string; sport: string; leagueType: string | null; scoringPresetId: string | null; settings: unknown }
type Team = { leagueId: string; claimedByUserId: string | null; isCommissioner: boolean; isCoCommissioner: boolean; role: string | null }

const fx = vi.hoisted(() => ({
  session: { user: { id: '' } } as { user?: { id?: string } } | null,
  leagues: [] as League[],
  teams: [] as Team[],
  chatPosts: [] as Array<{ leagueId: string; userId: string; text: string }>,
  notified: [] as string[],
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => fx.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/prisma', () => {
  const matchTeam = (t: Team, where: Record<string, unknown>) =>
    (where.leagueId === undefined || t.leagueId === where.leagueId) &&
    (where.claimedByUserId === undefined || t.claimedByUserId === where.claimedByUserId)
  const prisma = {
    league: {
      // Honours `userId` too: the old owner-only check (`getLeagueIfCommissioner`) filtered on it,
      // and a double that ignored it let that check pass for everyone.
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; userId?: string } }) =>
          fx.leagues.find((l) => l.id === where.id && (where.userId === undefined || l.userId === where.userId)) ?? null,
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => fx.leagues.find((l) => l.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { userId?: string; id?: { in: string[] } } }) =>
        fx.leagues.filter((l) => (where.userId ? l.userId === where.userId : where.id ? where.id.in.includes(l.id) : true)),
      ),
    },
    leagueTeam: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => fx.teams.find((t) => matchTeam(t, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        fx.teams.filter((t) => matchTeam(t, where) && (!where.OR || t.isCommissioner || t.isCoCommissioner)),
      ),
    },
    roster: {
      findFirst: vi.fn(async () => null),
      groupBy: vi.fn(async () => []),
    },
  }
  return { prisma, default: prisma }
})

vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: vi.fn(async (leagueId: string, userId: string, text: string) => {
    fx.chatPosts.push({ leagueId, userId, text })
    return { id: `m-${fx.chatPosts.length}` }
  }),
}))
vi.mock('@/lib/commissioner-settings/CommissionerAnnouncementService', () => ({ getLeagueChatThreadId: vi.fn(async () => null) }))
vi.mock('@/lib/platform/chat-service', () => ({ createSystemMessage: vi.fn() }))
vi.mock('@/lib/draft-notifications/DraftNotificationService', () => ({ getLeagueMemberAppUserIds: vi.fn(async () => ['m1', 'm2']) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (n: { meta: { leagueId: string } }) => {
    fx.notified.push(n.meta.leagueId)
  }),
}))

import { POST as broadcast } from '@/app/api/commissioner/broadcast/route'
import { GET as listLeagues } from '@/app/api/commissioner/leagues/route'

const league = (id: string, userId: string, platform: string): League => ({
  id,
  userId,
  platform,
  name: id,
  sport: 'NFL',
  leagueType: 'redraft',
  scoringPresetId: null,
  settings: {},
})
const team = (leagueId: string, claimedByUserId: string, flags: Partial<Team> = {}): Team => ({
  leagueId,
  claimedByUserId,
  isCommissioner: false,
  isCoCommissioner: false,
  role: null,
  ...flags,
})

let seq = 0
/** A fresh user per test, so the per-user rate limit never carries between cases. */
function signIn(prefix: string): string {
  const id = `${prefix}-${++seq}`
  fx.session = { user: { id } }
  return id
}

function post(leagueIds: string[], message = 'Draft moved to Sunday') {
  return broadcast(
    new Request('http://localhost/api/commissioner/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueIds, message }),
    }) as never,
  )
}

beforeEach(() => {
  fx.chatPosts = []
  fx.notified = []
})

function setup(users: { owner: string; co: string; member: string }) {
  fx.leagues = [league('HOME', users.owner, 'manual'), league('OTHER', 'someone-else', 'manual')]
  fx.teams = [
    team('HOME', users.owner, { isCommissioner: true }),
    team('HOME', users.co, { isCoCommissioner: true }),
    team('HOME', users.member),
  ]
}

describe('POST /api/commissioner/broadcast', () => {
  it('lets a co-commissioner send, as themselves', async () => {
    const co = signIn('co')
    setup({ owner: 'owner-x', co, member: 'member-x' })

    const res = await post(['HOME'])
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([{ leagueId: 'HOME', sent: true }])
    expect(fx.chatPosts).toEqual([{ leagueId: 'HOME', userId: co, text: '@everyone Draft moved to Sunday' }])
    expect(fx.notified).toEqual(['HOME'])
  })

  it('still lets the head commissioner send', async () => {
    const owner = signIn('owner')
    setup({ owner, co: 'co-x', member: 'member-x' })

    const body = await (await post(['HOME'])).json()

    expect(body.results).toEqual([{ leagueId: 'HOME', sent: true }])
  })

  it('refuses a plain member, and a league the sender has no role in, and sends nothing there', async () => {
    const member = signIn('member')
    setup({ owner: 'owner-x', co: 'co-x', member })

    const body = await (await post(['HOME', 'OTHER'])).json()

    expect(body.results).toEqual([
      { leagueId: 'HOME', sent: false, error: 'Forbidden' },
      { leagueId: 'OTHER', sent: false, error: 'Forbidden' },
    ])
    expect(fx.chatPosts).toEqual([])
    expect(fx.notified).toEqual([])
  })

  it('refuses a co-commissioner whose claimed team is marked viewer-only', async () => {
    const co = signIn('co')
    setup({ owner: 'owner-x', co, member: 'member-x' })
    fx.teams = fx.teams.map((t) => (t.claimedByUserId === co ? { ...t, role: 'viewer' } : t))

    const body = await (await post(['HOME'])).json()

    expect(body.results).toEqual([{ leagueId: 'HOME', sent: false, error: 'Forbidden' }])
  })

  it('stops a sixth send inside ten minutes, before anything goes out', async () => {
    const co = signIn('co')
    setup({ owner: 'owner-x', co, member: 'member-x' })

    for (let i = 0; i < 5; i++) expect((await post(['HOME'], `note ${i}`)).status).toBe(200)
    const sixth = await post(['HOME'], 'one too many')

    expect(sixth.status).toBe(429)
    expect(fx.chatPosts).toHaveLength(5)
    expect(fx.chatPosts.some((p) => p.text.includes('one too many'))).toBe(false)
  })

  it('does not count a malformed request against the limit', async () => {
    const co = signIn('co')
    setup({ owner: 'owner-x', co, member: 'member-x' })

    for (let i = 0; i < 6; i++) expect((await post(['HOME'], '')).status).toBe(400)
    expect((await post(['HOME'])).status).toBe(200)
  })
})

describe('GET /api/commissioner/leagues', () => {
  it('lists a co-commissioner’s league, and every listed league is one the send accepts', async () => {
    const co = signIn('co')
    setup({ owner: 'owner-x', co, member: 'member-x' })

    const listed = (await (await listLeagues()).json()).leagues.map((l: { id: string }) => l.id)
    expect(listed).toEqual(['HOME'])

    const body = await (await post(listed)).json()
    expect(body.results.every((r: { sent: boolean }) => r.sent)).toBe(true)
  })

  it('lists nothing for a plain member', async () => {
    const member = signIn('member')
    setup({ owner: 'owner-x', co: 'co-x', member })

    const body = await (await listLeagues()).json()
    expect(body.leagues).toEqual([])
  })

  it('still lists every league the user owns', async () => {
    const owner = signIn('owner')
    setup({ owner, co: 'co-x', member: 'member-x' })
    fx.leagues.push(league('IMPORTED', owner, 'sleeper'))

    const body = await (await listLeagues()).json()
    expect(body.leagues.map((l: { id: string; isNative: boolean }) => [l.id, l.isNative])).toEqual([
      ['HOME', true],
      ['IMPORTED', false],
    ])
  })
})
