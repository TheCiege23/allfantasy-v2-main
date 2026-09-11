import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  notifyCommissionerChangeMock,
  checkAndTriggerRatingIfOffseasonMock,
  leagueFindUniqueMock,
  leagueUpdateMock,
  leagueSeasonUpsertMock,
  leagueTeamUpdateManyMock,
  leagueTeamCountMock,
  findLeagueListingUpsertMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  notifyCommissionerChangeMock: vi.fn(),
  checkAndTriggerRatingIfOffseasonMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
  leagueSeasonUpsertMock: vi.fn(),
  leagueTeamUpdateManyMock: vi.fn(),
  leagueTeamCountMock: vi.fn(),
  findLeagueListingUpsertMock: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({
  notifyCommissionerChange: notifyCommissionerChangeMock,
}))

vi.mock('@/lib/commissioner/CommissionerRatingTrigger', () => ({
  checkAndTriggerRatingIfOffseason: checkAndTriggerRatingIfOffseasonMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
    leagueSeason: {
      upsert: leagueSeasonUpsertMock,
    },
    leagueTeam: {
      updateMany: leagueTeamUpdateManyMock,
      count: leagueTeamCountMock,
    },
    findLeagueListing: {
      upsert: findLeagueListingUpsertMock,
    },
  },
}))

describe('C2C commissioner renew / continue-to-next-year', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-1' } })
    notifyCommissionerChangeMock.mockResolvedValue(undefined)
    checkAndTriggerRatingIfOffseasonMock.mockResolvedValue(undefined)
    leagueSeasonUpsertMock.mockResolvedValue({ id: 'ls-1' })
    leagueTeamUpdateManyMock.mockResolvedValue({ count: 0 })
    leagueTeamCountMock.mockResolvedValue(1)
    findLeagueListingUpsertMock.mockResolvedValue({ id: 'listing-1' })
    leagueUpdateMock.mockResolvedValue({ id: 'league-1' })

    leagueFindUniqueMock.mockResolvedValue({
      userId: 'commissioner-1',
      season: 2026,
      settings: {
        league_type: 'c2c',
        c2cTaxiLockMode: 'season_start',
        c2cCustomSetting: 'keep-me',
      },
      leagueVariant: 'merged_devy_c2c',
      isDynasty: true,
      sport: 'NFL',
      name: 'C2C Test League',
      scoring: 'ppr',
      teams: [
        {
          id: 't1',
          teamName: 'Team One',
          ownerName: 'Owner One',
          isOrphan: false,
          isCommissioner: true,
          wins: 10,
          losses: 4,
          pointsFor: 1510,
          platformUserId: 'u1',
          currentRank: 1,
        },
      ],
    })
  })

  it('advances season and preserves C2C settings when commissioner continues to next year', async () => {
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')

    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duesEnabled: true, duesAmount: 25, listInFinder: false }),
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.nextSeason).toBe(2027)

    const lastUpdateCall = leagueUpdateMock.mock.calls[leagueUpdateMock.mock.calls.length - 1]?.[0]
    expect(lastUpdateCall.data.season).toBe(2027)
    expect(lastUpdateCall.data.status).toBe('pre_draft')
    expect(lastUpdateCall.data.settings.c2cTaxiLockMode).toBe('season_start')
    expect(lastUpdateCall.data.settings.c2cCustomSetting).toBe('keep-me')
    expect(lastUpdateCall.data.settings.renewal_completed_for_season).toBe(2027)
  })

  it('🛑 removing a member ARCHIVES it with a reason, and touches no other axis', async () => {
    /*
     * This is ONE OF ONLY TWO WRITERS IN THE CODEBASE THAT GENUINELY MEANT WHAT `isOrphan` WAS
     * READ TO MEAN. A commissioner deliberately removing a member is a departure; the other five
     * meanings of that flag — a vacant seat at creation, a provider seat with no manager, an
     * elimination — are not. So this is the writer that must archive, and the assertions below
     * are as much about what it does NOT do.
     *
     * ⚠ THE EXISTING TESTS IN THIS FILE NEVER REACHED THIS BRANCH. Neither posts
     * `removeMemberIds`, so `if (removeMemberIds.length > 0)` was dead in every run and
     * `leagueTeamUpdateManyMock` — wired up in the setup above — was only ever exercised by the
     * sweep and the stats reset. The archival write could have been deleted outright and this
     * suite would have stayed green.
     */
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')

    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeMemberIds: ['t9'] }),
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)

    const removal = leagueTeamUpdateManyMock.mock.calls
      .map((c) => c[0])
      .find((a) => a?.where?.id?.in?.includes('t9'))
    expect(removal, 'the removal branch never ran — removeMemberIds was not honoured').toBeTruthy()

    /* Scoped to the named members, and never to a commissioner. */
    expect(removal.where).toMatchObject({ leagueId: 'league-1', isCommissioner: false })

    expect(removal.data.lifecycleState, 'an admin removal IS a departure').toBe('ARCHIVED')
    expect(removal.data.archivedAt, 'an archive must be stamped, not merely flagged').toBeTruthy()
    expect(removal.data.archiveReason, 'the reason records WHICH of the meanings put it here').toBe(
      'commissioner_removed_at_renewal',
    )
    /* The legacy flag keeps being written so no unmigrated reader changes meaning. */
    expect(removal.data.isOrphan).toBe(true)

    /*
     * 🛑 `managerKind` IS DELIBERATELY UNTOUCHED, AND THIS PINS THAT. Removal says the franchise
     * left; it says nothing about who was running it, and a removed human is not thereby VACANT.
     * Writing a manager state here would invent one — the exact habit this batch exists to end.
     */
    expect(removal.data.managerKind, 'removal must not invent a manager state').toBeUndefined()
    expect(removal.data.eliminatedAt, 'removal is not an elimination').toBeUndefined()
  })

  it('🛑 the orphan sweep is three disjoint statements, and only ONE may archive', async () => {
    /*
     * The sweep used to be a single `updateMany` whose `OR` collected four populations sitting on
     * OPPOSITE sides of the lifecycle axis and stamped one flag across all of them — which is how
     * `isOrphan` came to mean seven things. It is now three statements, and this pins which one is
     * allowed to say a franchise departed.
     *
     * ⚠ WRITTEN BECAUSE THE MUTATION CONTROL FOUND NOTHING. Flipping bucket (b) from CURRENT to
     * ARCHIVED — turning every orphan-placeholder seat in the league into a departed one — left all
     * 30 tests in this area green. A classification nobody guards is the thing this batch keeps
     * finding, and I had just added one.
     */
    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')
    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })

    const calls = leagueTeamUpdateManyMock.mock.calls.map((c) => c[0])

    /* (a) administratively removed — the ONLY branch that may archive. */
    const removed = calls.find((a) => a?.where?.ownerName === 'Removed')
    expect(removed, 'the Removed branch is gone').toBeTruthy()
    expect(removed.data.lifecycleState).toBe('ARCHIVED')
    expect(removed.data.archiveReason).toBe('commissioner_removed_at_renewal')

    /* (b) orphan-placeholder seats — CURRENT, and the manager axis deliberately untouched. */
    const orphanish = calls.find((a) => a?.where?.NOT?.ownerName === 'Removed')
    expect(orphanish, 'the orphan-prefix branch is gone').toBeTruthy()
    expect(orphanish.data.lifecycleState, 'a placeholder seat has NOT left the league').toBe(
      'CURRENT',
    )
    expect(orphanish.data.lifecycleState).not.toBe('ARCHIVED')
    /*
     * 🛑 THE PREFIX IS OVERLOADED, SO THE MANAGER AXIS MUST STAY UNKNOWN. `startsWith('orphan-')`
     * matches seats written by four different writers — two meaning VACANT, two meaning AI, one of
     * which reuses the same plain prefix — and the only discriminator is `ownerName: 'AI Manager'`,
     * a DISPLAY STRING. Classifying on a label that exists to be rendered is how the next of these
     * gets built.
     */
    expect(orphanish.data.managerKind, 'the orphan- prefix cannot prove a manager kind').toBeUndefined()
    expect(orphanish.data.archivedAt).toBeUndefined()

    /* (c) bare flagged rows — genuinely unclassifiable, so NO axis is written. */
    const bare = calls.find((a) => a?.where?.isOrphan === true && a?.where?.NOT?.OR)
    expect(bare, 'the unclassifiable branch is gone').toBeTruthy()
    expect(bare.data.lifecycleState, 'a bare isOrphan proves nothing').toBeUndefined()
    expect(bare.data.managerKind, 'a bare isOrphan proves nothing').toBeUndefined()
    /* It still writes the legacy flag, so unmigrated readers see no change. */
    expect(bare.data.isOrphan).toBe(true)
  })

  it('allows commissioner league-type update to c2c and forces dynasty=true', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      userId: 'commissioner-1',
      season: 2026,
      settings: {},
      leagueVariant: 'redraft',
      isDynasty: false,
      sport: 'NFL',
      name: 'Redraft League',
      scoring: 'standard',
      teams: [
        {
          id: 't1',
          teamName: 'Team One',
          ownerName: 'Owner One',
          isOrphan: false,
          isCommissioner: true,
          wins: 8,
          losses: 6,
          pointsFor: 1300,
          platformUserId: 'u1',
          currentRank: 2,
        },
      ],
    })

    const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')

    const req = new Request('http://localhost/api/commissioner/leagues/league-1/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueType: 'c2c' }),
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)

    const typeChangeCall = leagueUpdateMock.mock.calls.find(
      (c) => c?.[0]?.data?.leagueVariant === 'c2c',
    )?.[0]

    expect(typeChangeCall).toBeTruthy()
    expect(typeChangeCall.data.isDynasty).toBe(true)
  })
})
