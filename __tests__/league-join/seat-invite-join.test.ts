// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * POST /api/leagues/join with a seat-specific invite link (`/join?code=…&team=<Roster.id>`, step 4b-3 of
 * docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md): the joiner gets THAT team, through the one seat writer,
 * and a team someone has taken since is refused by name rather than swapped for another. Same harness as
 * imported-league-member-join.test.ts.
 */

const m = vi.hoisted(() => ({
  session: { user: { id: 'u-new' } } as { user?: { id?: string } } | null,
  platform: 'manual' as string,
  assignSeat: vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, rosterId: 'roster-open-3', teamNumber: 3, alreadyHeld: false })),
  existingMember: null as { id: string } | null,
  memberCreate: vi.fn(async () => ({ id: 'mem-1' })),
  memberUpsert: vi.fn(async () => ({ id: 'mem-1' })),
  rosterCreate: vi.fn(async () => ({ id: 'roster-new' })),
  claimPlaceholder: vi.fn(async () => ({ claimed: false })),
  leagueSettings: {} as Record<string, unknown>,
  paidGeoBlocked: false,
}))
vi.mock('@/lib/geo/paidLeagueGeo', () => ({
  paidLeagueGeoVerdict: vi.fn(async () => ({ blocked: m.paidGeoBlocked, stateCode: 'MT', stateName: 'Montana', reason: 'state' })),
  paidLeagueGeoMessage: (_v: unknown, context: string) => `Paid leagues aren't available in Montana (${context})`,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/http/served-origin', () => ({ getServedOrigin: () => 'https://allfantasy.ai' }))
vi.mock('@/lib/league-invite', () => ({
  validateFantasyInviteCode: vi.fn(async () => ({ valid: true, preview: { leagueId: 'L1' } })),
}))
vi.mock('@/lib/league-join/careerJoinGate', () => ({
  evaluateCareerJoinGate: vi.fn(async () => ({ canJoin: true })),
  careerJoinRefusal: vi.fn(),
}))
vi.mock('@/lib/league-join/classRequests', () => ({ requestClassException: vi.fn() }))
vi.mock('@/lib/league-finance/joinGate', () => ({
  assertPaidJoinAllowed: vi.fn(async () => ({ ok: true })),
  linkDuesToRoster: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-import/placeholderClaim', () => ({ claimPlaceholderRoster: m.claimPlaceholder }))
vi.mock('@/lib/league/leagueSeats', () => ({ assignLeagueSeat: m.assignSeat }))
vi.mock('@/lib/identity/linkedAccounts', () => ({ findExistingLeagueClaim: vi.fn(async () => null) }))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))
const claim = vi.hoisted(() => ({
  start: vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, code: 'AF-7K2Q', expiresAt: 'x', teamName: 'Hammer Time', leagueName: 'Death Squad' })),
  verify: vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: false, reason: 'code_not_found', seenTeamName: 'Hammer Time' })),
  list: vi.fn(async () => [{ externalId: '1', teamName: 'Hammer Time', ownerName: 'joe', avatarUrl: null }]),
}))
vi.mock('@/lib/league-join/sleeperOwnershipClaim', () => ({
  CLAIM_REFUSAL_MESSAGE: { not_member: 'Join this league first.', code_not_found: 'We could not find the code in your Sleeper team name yet.', linked_elsewhere: 'linked' },
  listClaimableSleeperTeams: claim.list,
  startSleeperTeamClaim: claim.start,
  verifySleeperTeamClaim: claim.verify,
}))

const tx = {
  $queryRaw: vi.fn(async () => []),
  roster: {
    // The joiner holds no roster yet (by user key); a roster asked for by id exists.
    findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => (where.id ? { id: where.id } : null)),
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
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    redraftLeagueMember: { findUnique: vi.fn(async () => m.existingMember) },
    league: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => ({ settings: m.leagueSettings })) },
    // Free league: the paid-league state check (lib/geo/paidLeagueGeo) is not reached.
    leagueFinance: { findUnique: vi.fn(async () => null) },
  },
}))

import { POST } from '@/app/api/leagues/join/route'

function req(body: unknown) {
  return { json: async () => body } as never
}

beforeEach(() => {
  m.session = { user: { id: 'u-new' } }
  m.platform = 'manual'
  m.claimPlaceholder.mockClear()
  m.rosterCreate.mockClear()
  m.assignSeat.mockClear()
  m.assignSeat.mockResolvedValue({ ok: true, rosterId: 'roster-open-3', teamNumber: 3, alreadyHeld: false })
})

describe('joining by a seat-specific invite link', () => {
  it('seats the joiner on the team the link names, not on whatever the name match would pick', async () => {
    const res = await POST(req({ code: 'ABC123', rosterId: 'roster-open-3' }))
    expect(res.status).toBe(200)
    expect(m.assignSeat).toHaveBeenCalledWith(expect.anything(), { leagueId: 'L1', rosterId: 'roster-open-3', userId: 'u-new' })
    expect(m.claimPlaceholder).not.toHaveBeenCalled()
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('refuses a team someone has taken since, by name, instead of handing out another', async () => {
    m.assignSeat.mockResolvedValueOnce({ ok: false, code: 'ROSTER_TAKEN', message: 'That team is already claimed.' })
    const res = await POST(req({ code: 'ABC123', rosterId: 'roster-open-3' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('That team has already been claimed. Ask your commissioner for a new link.')
    expect(m.claimPlaceholder).not.toHaveBeenCalled()
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('a team that is not in this league is a 404', async () => {
    m.assignSeat.mockResolvedValueOnce({ ok: false, code: 'ROSTER_NOT_FOUND', message: 'Roster not found in this league.' })
    expect((await POST(req({ code: 'ABC123', rosterId: 'someone-elses' }))).status).toBe(404)
  })

  it('without a team in the link, the ordinary assignment runs as before', async () => {
    await POST(req({ code: 'ABC123' }))
    expect(m.assignSeat).not.toHaveBeenCalled()
    expect(m.claimPlaceholder).toHaveBeenCalledTimes(1)
  })

  it('an imported league still joins as a member only, whatever the link names', async () => {
    m.platform = 'sleeper'
    const body = await (await POST(req({ code: 'ABC123', rosterId: 'roster-open-3' }))).json()
    expect(body.memberOnly).toBe(true)
    expect(m.assignSeat).not.toHaveBeenCalled()
  })
})
