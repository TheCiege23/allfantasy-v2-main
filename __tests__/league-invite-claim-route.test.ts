import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  leagueInviteFindFirstMock,
  leagueTeamFindFirstMock,
  leagueTeamUpdateMock,
  leagueManagerClaimFindFirstMock,
  leagueManagerClaimCreateMock,
  leagueInviteUpdateMock,
  rosterFindManyMock,
  rosterFindFirstMock,
  rosterUpdateMock,
  redraftLeagueMemberUpsertMock,
  assignLeagueSeatMock,
  userProfileFindFirstMock,
  platformIdentityFindManyMock,
  transactionMock,
  resolveJoinRankGateMock,
} = vi.hoisted(() => ({
  resolveJoinRankGateMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  leagueInviteFindFirstMock: vi.fn(),
  leagueTeamFindFirstMock: vi.fn(),
  leagueTeamUpdateMock: vi.fn(),
  leagueManagerClaimFindFirstMock: vi.fn(),
  leagueManagerClaimCreateMock: vi.fn(),
  leagueInviteUpdateMock: vi.fn(),
  rosterFindManyMock: vi.fn(),
  rosterFindFirstMock: vi.fn(),
  rosterUpdateMock: vi.fn(),
  redraftLeagueMemberUpsertMock: vi.fn(),
  assignLeagueSeatMock: vi.fn(),
  userProfileFindFirstMock: vi.fn(),
  platformIdentityFindManyMock: vi.fn(),
  // Both forms: an array of queries (imported path) and an interactive callback (native path).
  transactionMock: vi.fn(async (ops: unknown): Promise<unknown> =>
    typeof ops === 'function' ? (ops as (tx: unknown) => Promise<unknown>)({}) : Promise.all(ops as Array<Promise<unknown>>),
  ),
}))

vi.mock('@/lib/league/leagueSeats', () => ({ assignLeagueSeat: assignLeagueSeatMock }))

// The ±2 level gate has its own suite (league-join-rank-gate.test.ts); here only its verdict matters.
vi.mock('@/lib/league-join/resolveJoinRankGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-join/resolveJoinRankGate')>()),
  resolveJoinRankGate: resolveJoinRankGateMock,
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueInvite: {
      findFirst: leagueInviteFindFirstMock,
      update: leagueInviteUpdateMock,
    },
    leagueTeam: {
      findFirst: leagueTeamFindFirstMock,
      update: leagueTeamUpdateMock,
    },
    leagueManagerClaim: {
      findFirst: leagueManagerClaimFindFirstMock,
      create: leagueManagerClaimCreateMock,
    },
    roster: {
      findMany: rosterFindManyMock,
      findFirst: rosterFindFirstMock,
      update: rosterUpdateMock,
    },
    redraftLeagueMember: {
      upsert: redraftLeagueMemberUpsertMock,
    },
    userProfile: {
      findFirst: userProfileFindFirstMock,
    },
    platformIdentity: {
      findMany: platformIdentityFindManyMock,
    },
    yahooConnection: {
      findFirst: vi.fn(),
    },
    mFLConnection: {
      findFirst: vi.fn(),
    },
    fantraxUser: {
      findFirst: vi.fn(),
    },
    $transaction: transactionMock,
  },
}))

describe('POST /api/league/invite/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'af-user-1' } })
    resolveJoinRankGateMock.mockResolvedValue({
      allowed: true,
      bypassed: false,
      basis: 'level',
      sport: 'NFL',
      userClass: 5,
      userRankLevel: 5,
      minRankLevel: null,
      maxRankLevel: null,
      reason: 'LISTING_MISSING',
    })
    leagueInviteFindFirstMock.mockResolvedValue({
      id: 'invite-1',
      leagueId: 'league-1',
      useCount: 0,
      maxUses: 50,
      expiresAt: null,
      league: {
        id: 'league-1',
        platform: 'sleeper',
      },
    })
    leagueManagerClaimFindFirstMock.mockResolvedValue(null)
    rosterFindFirstMock.mockResolvedValue(null)
    redraftLeagueMemberUpsertMock.mockResolvedValue({ id: 'member-1' })
    transactionMock.mockImplementation(async (ops: unknown): Promise<unknown> =>
      typeof ops === 'function'
        ? (ops as (tx: unknown) => Promise<unknown>)({
            leagueManagerClaim: { create: leagueManagerClaimCreateMock },
            leagueInvite: { update: leagueInviteUpdateMock },
          })
        : Promise.all(ops as Array<Promise<unknown>>),
    )
    rosterFindManyMock.mockResolvedValue([
      {
        id: 'roster-1',
        platformUserId: 'sleeper-user-1',
        playerData: {
          import: {
            sourceTeamId: 'team-1',
          },
        },
      },
    ])
    platformIdentityFindManyMock.mockResolvedValue([])
    userProfileFindFirstMock.mockResolvedValue({ sleeperUserId: 'sleeper-user-1' })
    leagueTeamUpdateMock.mockResolvedValue({ id: 'team-row-1' })
    rosterUpdateMock.mockResolvedValue({ id: 'roster-1' })
    leagueManagerClaimCreateMock.mockResolvedValue({ id: 'claim-1' })
    leagueInviteUpdateMock.mockResolvedValue({ id: 'invite-1' })
  })

  it('allows claiming the matched imported placeholder and rebinds the roster', async () => {
    leagueTeamFindFirstMock.mockResolvedValue({
      id: 'team-row-1',
      leagueId: 'league-1',
      externalId: 'team-1',
      claimedByUserId: null,
      isOrphan: false,
      platformUserId: 'sleeper-user-1',
    })

    const { POST } = await import('@/app/api/league/invite/claim/route')
    const req = new Request('http://localhost/api/league/invite/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', teamExternalId: 'team-1' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, leagueId: 'league-1' })
    expect(rosterUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'roster-1' },
        data: expect.objectContaining({ platformUserId: 'af-user-1' }),
      })
    )
    expect(leagueManagerClaimCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platformUserId: 'sleeper-user-1' }),
      })
    )
  })

  it('rejects claiming a different imported manager slot', async () => {
    userProfileFindFirstMock.mockResolvedValue({ sleeperUserId: 'sleeper-user-2' })
    leagueTeamFindFirstMock.mockResolvedValue({
      id: 'team-row-2',
      leagueId: 'league-1',
      externalId: 'team-2',
      claimedByUserId: null,
      isOrphan: false,
      platformUserId: 'sleeper-user-1',
    })

    const { POST } = await import('@/app/api/league/invite/claim/route')
    const req = new Request('http://localhost/api/league/invite/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', teamExternalId: 'team-2' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      error: 'This imported team belongs to a different linked manager account.',
    })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  /**
   * A league created on AllFantasy keys each team by its roster id. The import match below never
   * found it, so the claim set only the team's `claimedByUserId` and left the roster owned by its
   * `open-slot-` placeholder: the manager could see the draft and never pick.
   */
  it('hands a native open team to the claimant through the seat writer', async () => {
    leagueInviteFindFirstMock.mockResolvedValue({
      id: 'invite-1',
      leagueId: 'league-1',
      useCount: 0,
      maxUses: 50,
      expiresAt: null,
      league: { id: 'league-1', platform: 'manual' },
    })
    leagueTeamFindFirstMock.mockResolvedValue({
      id: 'team-row-3',
      leagueId: 'league-1',
      externalId: 'roster-3',
      claimedByUserId: null,
      isOrphan: true,
      platformUserId: 'open-slot-league-1-3',
    })
    assignLeagueSeatMock.mockResolvedValue({ ok: true, rosterId: 'roster-3', teamNumber: 3, alreadyHeld: false })

    const { POST } = await import('@/app/api/league/invite/claim/route')
    const req = new Request('http://localhost/api/league/invite/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', teamExternalId: 'roster-3' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(assignLeagueSeatMock).toHaveBeenCalledWith(expect.anything(), {
      leagueId: 'league-1',
      rosterId: 'roster-3',
      userId: 'af-user-1',
    })
    // The imported branch's roster lookup by sourceTeamId is not what decides a native claim.
    expect(rosterFindManyMock).not.toHaveBeenCalled()
  })

  it('refuses a native team to a manager outside the league level range, before any seat is written', async () => {
    leagueInviteFindFirstMock.mockResolvedValue({
      id: 'invite-1',
      leagueId: 'league-1',
      useCount: 0,
      maxUses: 50,
      expiresAt: null,
      league: { id: 'league-1', platform: 'manual' },
    })
    leagueTeamFindFirstMock.mockResolvedValue({
      id: 'team-row-3',
      leagueId: 'league-1',
      externalId: 'roster-3',
      claimedByUserId: null,
      isOrphan: true,
      platformUserId: 'open-slot-league-1-3',
    })
    resolveJoinRankGateMock.mockResolvedValue({
      allowed: false,
      bypassed: false,
      basis: 'level',
      sport: 'NFL',
      userClass: 1,
      userRankLevel: 1,
      minRankLevel: 8,
      maxRankLevel: 12,
      reason: 'OUTSIDE_RANK_RANGE',
    })

    const { POST } = await import('@/app/api/league/invite/claim/route')
    const req = new Request('http://localhost/api/league/invite/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', teamExternalId: 'roster-3' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'RANK_GATE_BLOCKED', minRankLevel: 8, maxRankLevel: 12, userRankLevel: 1 })
    expect(resolveJoinRankGateMock).toHaveBeenCalledWith({ leagueId: 'league-1', userId: 'af-user-1' })
    expect(assignLeagueSeatMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('refuses a second team to someone who already holds one', async () => {
    rosterFindFirstMock.mockResolvedValue({ id: 'roster-1' })
    leagueTeamFindFirstMock.mockResolvedValue({
      id: 'team-row-3',
      leagueId: 'league-1',
      externalId: 'roster-3',
      claimedByUserId: null,
      isOrphan: true,
      platformUserId: 'open-slot-league-1-3',
    })
    const { POST } = await import('@/app/api/league/invite/claim/route')
    const req = new Request('http://localhost/api/league/invite/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', teamExternalId: 'roster-3' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(409)
    expect(transactionMock).not.toHaveBeenCalled()
  })
})