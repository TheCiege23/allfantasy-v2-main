// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * POST /api/leagues/join for an IMPORTED league: join as a member, never take or make a team.
 *
 * It used to hand an imported team to whoever's display name matched the owner's (no proof of the
 * Sleeper account), and to create a fresh empty roster — a thirteenth team in a twelve-team Sleeper
 * league — when nothing matched. A leaguemate arriving from a shared recap wants the league's chat;
 * a RedraftLeagueMember row is what admits them to it.
 */

const m = vi.hoisted(() => ({
  session: { user: { id: 'u-new' } } as { user?: { id?: string } } | null,
  platform: 'sleeper' as string,
  existingMember: null as { id: string } | null,
  memberCreate: vi.fn(async () => ({ id: 'mem-1' })),
  memberUpsert: vi.fn(async () => ({ id: 'mem-1' })),
  rosterCreate: vi.fn(async () => ({ id: 'roster-new' })),
  claimPlaceholder: vi.fn(async () => ({ claimed: false })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/http/served-origin', () => ({ getServedOrigin: () => 'https://allfantasy.ai' }))
vi.mock('@/lib/league-invite', () => ({
  validateFantasyInviteCode: vi.fn(async () => ({ valid: true, preview: { leagueId: 'L1' } })),
}))
vi.mock('@/lib/league-join/joinDivisionGate', () => ({
  evaluateJoinDivisionGate: vi.fn(async () => ({ outcome: 'allow' })),
  divisionGateRefusal: vi.fn(),
}))
vi.mock('@/lib/league-join/classRequests', () => ({ requestClassException: vi.fn() }))
vi.mock('@/lib/league-finance/joinGate', () => ({
  assertPaidJoinAllowed: vi.fn(async () => ({ ok: true })),
  linkDuesToRoster: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-import/placeholderClaim', () => ({ claimPlaceholderRoster: m.claimPlaceholder }))
vi.mock('@/lib/identity/linkedAccounts', () => ({ findExistingLeagueClaim: vi.fn(async () => null) }))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))

const tx = {
  $queryRaw: vi.fn(async () => []),
  roster: {
    findUnique: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    create: m.rosterCreate,
  },
  league: {
    findUnique: vi.fn(async () => ({
      id: 'L1',
      name: 'Death Squad',
      platform: m.platform,
      leagueSize: 12,
      leagueVariant: null,
      userId: 'owner',
    })),
  },
  draftSession: { findFirst: vi.fn(async () => null) },
  userProfile: { findFirst: vi.fn(async () => ({ displayName: 'hamrsmash', sleeperUsername: 'hamrsmash' })) },
  appUser: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ email: 'x@example.com' })) },
  redraftLeagueMember: {
    findUnique: vi.fn(async () => m.existingMember),
    create: m.memberCreate,
    upsert: m.memberUpsert,
  },
  leagueEntrySlot: { findFirst: vi.fn(async () => null), update: vi.fn() },
  leagueTeam: { count: vi.fn(async () => 0), upsert: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}))

import { POST } from '@/app/api/leagues/join/route'

function req(body: unknown) {
  return { json: async () => body } as never
}

beforeEach(() => {
  m.session = { user: { id: 'u-new' } }
  m.platform = 'sleeper'
  m.existingMember = null
  m.memberCreate.mockClear()
  m.memberUpsert.mockClear()
  m.rosterCreate.mockClear()
  m.claimPlaceholder.mockClear()
})

describe('joining an imported league by its code', () => {
  it('joins as a member and lands in the chat — no team taken, none created', async () => {
    const res = await POST(req({ code: 'ABC123' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, leagueId: 'L1', memberOnly: true, alreadyMember: false })
    expect(m.memberCreate).toHaveBeenCalledWith({
      data: { leagueId: 'L1', userId: 'u-new', role: 'MEMBER', teamNumber: null },
    })
    // The display-name match ('hamrsmash' here) is never tried, and no phantom roster is made.
    expect(m.claimPlaceholder).not.toHaveBeenCalled()
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('a second visit is already a member, and writes nothing', async () => {
    m.existingMember = { id: 'mem-1' }
    const body = await (await POST(req({ code: 'ABC123' }))).json()
    expect(body).toMatchObject({ success: true, memberOnly: true, alreadyMember: true })
    expect(m.memberCreate).not.toHaveBeenCalled()
  })

  it('holds for every provider, not only Sleeper', async () => {
    for (const platform of ['espn', 'yahoo', 'fleaflicker', 'mfl', 'fantrax']) {
      m.platform = platform
      m.claimPlaceholder.mockClear()
      const body = await (await POST(req({ code: 'ABC123' }))).json()
      expect(body.memberOnly, platform).toBe(true)
      expect(m.claimPlaceholder, platform).not.toHaveBeenCalled()
    }
  })

  it('a league made here still seats the joiner as before', async () => {
    m.platform = 'manual'
    const body = await (await POST(req({ code: 'ABC123' }))).json()
    expect(body.memberOnly).toBeUndefined()
    expect(m.claimPlaceholder).toHaveBeenCalledTimes(1)
  })

  it('signed out is a 401 the page turns into "sign in to join"', async () => {
    m.session = null
    const res = await POST(req({ code: 'ABC123' }))
    expect(res.status).toBe(401)
  })
})
