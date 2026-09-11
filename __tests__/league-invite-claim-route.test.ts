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
  rosterUpdateMock,
  userProfileFindFirstMock,
  platformIdentityFindManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  leagueInviteFindFirstMock: vi.fn(),
  leagueTeamFindFirstMock: vi.fn(),
  leagueTeamUpdateMock: vi.fn(),
  leagueManagerClaimFindFirstMock: vi.fn(),
  leagueManagerClaimCreateMock: vi.fn(),
  leagueInviteUpdateMock: vi.fn(),
  rosterFindManyMock: vi.fn(),
  rosterUpdateMock: vi.fn(),
  userProfileFindFirstMock: vi.fn(),
  platformIdentityFindManyMock: vi.fn(),
  transactionMock: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
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
      update: rosterUpdateMock,
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
    /*
     * 🛑 THE CLAIM WRITER SETTLES BOTH AXES, AND NOTHING ASSERTED IT UNTIL NOW.
     * `leagueTeamUpdateMock` was wired up in this file's setup and never checked, so the route
     * could have stopped writing the lifecycle fields entirely and every test here stayed green.
     *
     * A person accepting an invite is the strongest evidence a seat is live that the system ever
     * gets — it is a user action, not an inference over an unclassified row — which is the only
     * way UNKNOWN is allowed to become CURRENT.
     */
    expect(leagueTeamUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'team-row-1' },
        data: expect.objectContaining({
          claimedByUserId: 'af-user-1',
          isOrphan: false,
          lifecycleState: 'CURRENT',
          managerKind: 'HUMAN',
        }),
      }),
    )
    /* A claim is not an archival event and must never stamp one. */
    const claimData = leagueTeamUpdateMock.mock.calls[0]?.[0]?.data ?? {}
    expect(claimData.lifecycleState).not.toBe('ARCHIVED')
    expect(claimData.archivedAt ?? null).toBeNull()
    expect(claimData.archiveReason ?? null).toBeNull()

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
})