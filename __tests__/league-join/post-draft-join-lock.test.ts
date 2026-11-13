// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * POST /api/leagues/join after the draft has started.
 *
 * Survivor already locked late joins. Best Ball (Classic and tournament) and Guillotine did not: a
 * manager joining after the draft was handed a FRESH roster — no players, and in a tournament no
 * contest entry, because entries are written when the draft runs. Those formats now refuse a fresh
 * roster once the draft has started, while taking over a team that was drafted (an orphan, an open
 * seat, an imported placeholder) keeps working, because that is how an abandoned team gets a
 * manager back.
 *
 * Also here: a private league's approved Find a League request joins without a code.
 */

const m = vi.hoisted(() => ({
  session: { user: { id: 'u-new' } } as { user?: { id?: string } } | null,
  league: {} as Record<string, unknown>,
  draftStatus: null as string | null,
  claim: { claimed: false } as { claimed: boolean; rosterId?: string },
  unclaimed: 0,
  rosterCreate: vi.fn(async () => ({ id: 'roster-new' })),
  validate: vi.fn(async () => ({ valid: true, preview: { leagueId: 'L1' } })),
  gate: vi.fn(async () => ({ outcome: 'allow' })),
  careerGate: vi.fn(async () => ({ canJoin: true })),
  request: null as { status: string } | null,
  existingRoster: null as { id: string } | null,
  outerLeague: { id: 'L1', platform: 'manual', settings: {} } as Record<string, unknown> | null,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/http/served-origin', () => ({ getServedOrigin: () => 'https://allfantasy.ai' }))
vi.mock('@/lib/geo/paidLeagueGeo', () => ({ paidLeagueGeoVerdict: vi.fn(), paidLeagueGeoMessage: vi.fn() }))
vi.mock('@/lib/league-invite', () => ({ validateFantasyInviteCode: m.validate }))
vi.mock('@/lib/league-join/joinDivisionGate', () => ({ evaluateJoinDivisionGate: m.gate, divisionGateRefusal: vi.fn() }))
vi.mock('@/lib/league-join/careerJoinGate', () => ({
  evaluateCareerJoinGate: m.careerGate,
  careerJoinRefusal: vi.fn(),
}))
vi.mock('@/lib/league-join/classRequests', () => ({ requestClassException: vi.fn() }))
vi.mock('@/lib/league-join/notifyCommissionerOfJoin', () => ({ notifyCommissionerOfJoin: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-finance/joinGate', () => ({
  assertPaidJoinAllowed: vi.fn(async () => ({ ok: true })),
  linkDuesToRoster: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-import/placeholderClaim', () => ({ claimPlaceholderRoster: vi.fn(async () => m.claim) }))
vi.mock('@/lib/identity/linkedAccounts', () => ({ findExistingLeagueClaim: vi.fn(async () => null) }))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))
vi.mock('@/lib/league-join/sleeperOwnershipClaim', () => ({
  CLAIM_REFUSAL_MESSAGE: {},
  listClaimableSleeperTeams: vi.fn(),
  startSleeperTeamClaim: vi.fn(),
  verifySleeperTeamClaim: vi.fn(),
}))

const tx = {
  $queryRaw: vi.fn(async () => []),
  roster: {
    findUnique: vi.fn(async (args: { where: { id?: string } }) => (args.where.id ? { id: args.where.id } : null)),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => m.unclaimed),
    create: m.rosterCreate,
  },
  league: { findUnique: vi.fn(async () => m.league) },
  draftSession: { findFirst: vi.fn(async () => (m.draftStatus ? { status: m.draftStatus } : null)) },
  userProfile: { findFirst: vi.fn(async () => ({ displayName: 'Pat', sleeperUsername: null })) },
  appUser: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ email: 'pat@example.com' })) },
  redraftLeagueMember: { findUnique: vi.fn(async () => null), create: vi.fn(), upsert: vi.fn(async () => ({})) },
  leagueEntrySlot: { findFirst: vi.fn(async () => null), update: vi.fn() },
  leagueTeam: { count: vi.fn(async () => 0), upsert: vi.fn(async () => ({})) },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    league: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => m.outerLeague) },
    leagueFinance: { findUnique: vi.fn(async () => null) },
    findLeagueSpotRequest: { findUnique: vi.fn(async () => m.request) },
    roster: { findUnique: vi.fn(async () => m.existingRoster) },
  },
}))

import { POST } from '@/app/api/leagues/join/route'
import { draftHasStarted, postDraftJoinLockKind } from '@/lib/league-join/postDraftJoinLock'

const req = (body: unknown) => ({ json: async () => body }) as never

function nativeLeague(o: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    name: 'Draft Night',
    platform: 'manual',
    leagueSize: 12,
    leagueVariant: null,
    leagueType: 'redraft',
    bestBallMode: false,
    guillotineMode: false,
    userId: 'owner',
    ...o,
  }
}

beforeEach(() => {
  m.session = { user: { id: 'u-new' } }
  m.league = nativeLeague()
  m.draftStatus = null
  m.claim = { claimed: false }
  m.unclaimed = 0
  m.request = null
  m.existingRoster = null
  m.outerLeague = { id: 'L1', platform: 'manual', settings: {} }
  m.rosterCreate.mockClear()
  m.validate.mockClear()
  m.gate.mockClear()
})

describe('the post-draft lock, as a rule', () => {
  it('knows which formats fix their teams at the draft', () => {
    expect(postDraftJoinLockKind({ bestBallMode: true })).toBe('best_ball')
    expect(postDraftJoinLockKind({ leagueVariant: 'best_ball' })).toBe('best_ball')
    expect(postDraftJoinLockKind({ leagueType: 'best_ball' })).toBe('best_ball')
    expect(postDraftJoinLockKind({ guillotineMode: true })).toBe('guillotine')
    expect(postDraftJoinLockKind({ leagueVariant: 'guillotine' })).toBe('guillotine')
    expect(postDraftJoinLockKind({ leagueType: 'guillotine' })).toBe('guillotine')
    expect(postDraftJoinLockKind({ leagueVariant: 'survivor' })).toBe('survivor')
    expect(postDraftJoinLockKind({ leagueVariant: 'survivor_guillotine', guillotineMode: true })).toBe('survivor')
    expect(postDraftJoinLockKind({ leagueType: 'redraft' })).toBeNull()
    expect(postDraftJoinLockKind({ leagueType: 'dynasty' })).toBeNull()
  })

  it('reads "started" as any draft status past pre_draft', () => {
    expect(draftHasStarted(null)).toBe(false)
    expect(draftHasStarted('pre_draft')).toBe(false)
    expect(draftHasStarted('in_progress')).toBe(true)
    expect(draftHasStarted('paused')).toBe(true)
    expect(draftHasStarted('completed')).toBe(true)
  })
})

describe.each([
  ['Best Ball (bestBallMode)', { bestBallMode: true, leagueType: 'best_ball' }, /Best Ball league has already drafted/],
  ['Best Ball tournament (leagueType only)', { leagueType: 'best_ball', bestBallVariant: 'tournament' }, /Best Ball league has already drafted/],
  ['Guillotine (guillotineMode)', { guillotineMode: true, leagueType: 'guillotine' }, /Guillotine league has already drafted/],
  ['Guillotine (leagueVariant)', { leagueVariant: 'guillotine' }, /Guillotine league has already drafted/],
])('%s after the draft has started', (_label, fields, message) => {
  beforeEach(() => {
    m.league = nativeLeague(fields)
  })

  it('refuses a new manager instead of handing them an empty roster', async () => {
    m.draftStatus = 'in_progress'
    const res = await POST(req({ code: 'ABC123' }))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('DRAFT_STARTED')
    expect(body.error).toMatch(message)
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('still lets a manager take over a drafted team that has no manager', async () => {
    m.draftStatus = 'completed'
    m.claim = { claimed: true, rosterId: 'roster-orphan' }
    const res = await POST(req({ code: 'ABC123' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, leagueId: 'L1' })
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('still offers the team picker when unclaimed teams exist', async () => {
    m.draftStatus = 'completed'
    m.unclaimed = 2
    const res = await POST(req({ code: 'ABC123' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, claimPrompt: true })
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('joins as before while the league has not drafted', async () => {
    m.draftStatus = 'pre_draft'
    const res = await POST(req({ code: 'ABC123' }))
    expect(res.status).toBe(200)
    expect(m.rosterCreate).toHaveBeenCalledTimes(1)
  })
})

describe('formats that were open after the draft stay open', () => {
  it('a redraft league still adds a manager after its draft', async () => {
    m.draftStatus = 'completed'
    const res = await POST(req({ code: 'ABC123' }))
    expect(res.status).toBe(200)
    expect(m.rosterCreate).toHaveBeenCalledTimes(1)
  })

  it('Survivor keeps its own message and still refuses even a takeover', async () => {
    m.league = nativeLeague({ leagueVariant: 'survivor' })
    m.draftStatus = 'in_progress'
    m.claim = { claimed: true, rosterId: 'roster-orphan' }
    const res = await POST(req({ code: 'ABC123' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Survivor leagues lock new joins after the draft starts.')
  })
})

describe('joining a private league after the commissioner approved the request', () => {
  it('takes the seat without a code, through every usual gate', async () => {
    m.request = { status: 'accepted' }
    m.careerGate.mockClear()
    const res = await POST(req({ action: 'join_approved_request', leagueId: 'L1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, leagueId: 'L1', alreadyMember: false })
    expect(m.validate).not.toHaveBeenCalled()
    // The join's rank gate is the career-level gate (lib/league-join/careerJoinGate.ts) since #3420.
    expect(m.careerGate).toHaveBeenCalledWith('u-new', 'L1', undefined, expect.anything())
    expect(m.rosterCreate).toHaveBeenCalledTimes(1)
  })

  it('an approval does not get round the post-draft lock', async () => {
    m.request = { status: 'accepted' }
    m.league = nativeLeague({ bestBallMode: true })
    m.draftStatus = 'in_progress'
    const res = await POST(req({ action: 'join_approved_request', leagueId: 'L1' }))
    expect(res.status).toBe(409)
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: 'pending' }, 403, 'REQUEST_PENDING'],
    [{ status: 'declined' }, 403, 'REQUEST_DECLINED'],
    [null, 403, 'NOT_APPROVED'],
  ])('refuses a request that is %o', async (request, status, code) => {
    m.request = request
    const res = await POST(req({ action: 'join_approved_request', leagueId: 'L1' }))
    expect(res.status).toBe(status)
    expect((await res.json()).code).toBe(code)
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('a manager already in the league is sent to it', async () => {
    m.existingRoster = { id: 'r1' }
    const res = await POST(req({ action: 'join_approved_request', leagueId: 'L1' }))
    expect(await res.json()).toMatchObject({ success: true, leagueId: 'L1', alreadyMember: true })
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('an imported league is never joined this way', async () => {
    m.request = { status: 'accepted' }
    m.outerLeague = { id: 'L1', platform: 'sleeper', settings: {} }
    const res = await POST(req({ action: 'join_approved_request', leagueId: 'L1' }))
    expect(res.status).toBe(404)
    expect(m.rosterCreate).not.toHaveBeenCalled()
  })

  it('needs a league id', async () => {
    const res = await POST(req({ action: 'join_approved_request' }))
    expect(res.status).toBe(400)
  })
})
