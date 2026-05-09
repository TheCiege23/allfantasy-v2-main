/**
 * canAccessLeagueDraft — unit tests (mocked Prisma, no DB).
 *
 * Verifies the three membership tiers that grant draft access:
 *   1. League owner  (league.userId === userId  via isCommissioner)
 *   2. Roster member (rosters.platformUserId === userId)
 *   3. League-team member (league_teams.platformUserId OR claimedByUserId === userId)
 *
 * Also verifies non-member and missing-userId denials.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted Prisma mock — must be hoisted so vi.mock factory can reference it.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => {
  const leagueFindFirst = vi.fn(async () => null as null | { userId: string })
  const rosterFindFirst = vi.fn(async () => null as null | { id: string })
  const leagueTeamFindFirst = vi.fn(async () => null as null | { id: string })
  return {
    league: { findFirst: leagueFindFirst },
    roster: { findFirst: rosterFindFirst },
    leagueTeam: { findFirst: leagueTeamFindFirst },
    _mocks: { leagueFindFirst, rosterFindFirst, leagueTeamFindFirst },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: db }))

// DEV bypass disabled for all tests (production-parity).
vi.stubEnv('NODE_ENV', 'production')

const { canAccessLeagueDraft } = await import('@/lib/live-draft-engine/auth')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEAGUE = 'league-abc'
const USER = 'user-xyz'

function allowCommissioner() {
  db._mocks.leagueFindFirst.mockResolvedValue({ userId: USER })
}
function denyCommissioner() {
  db._mocks.leagueFindFirst.mockResolvedValue({ userId: 'other-owner' })
}
function allowRoster() {
  db._mocks.rosterFindFirst.mockResolvedValue({ id: 'roster-1' })
}
function allowTeamByPlatformUserId() {
  db._mocks.leagueTeamFindFirst.mockResolvedValue({ id: 'team-1' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canAccessLeagueDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db._mocks.leagueFindFirst.mockResolvedValue(null)
    db._mocks.rosterFindFirst.mockResolvedValue(null)
    db._mocks.leagueTeamFindFirst.mockResolvedValue(null)
  })

  // --- Unauthenticated ---

  it('denies when userId is undefined', async () => {
    expect(await canAccessLeagueDraft(LEAGUE, undefined)).toBe(false)
    expect(db._mocks.leagueFindFirst).not.toHaveBeenCalled()
  })

  it('denies when userId is empty string', async () => {
    expect(await canAccessLeagueDraft(LEAGUE, '')).toBe(false)
  })

  // --- League owner (isCommissioner path) ---

  it('allows when user is league owner (league.userId match)', async () => {
    allowCommissioner()
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(true)
    expect(db._mocks.rosterFindFirst).not.toHaveBeenCalled()
    expect(db._mocks.leagueTeamFindFirst).not.toHaveBeenCalled()
  })

  // --- Roster member ---

  it('allows when rosters.platformUserId matches userId', async () => {
    denyCommissioner()
    allowRoster()
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(true)
    expect(db._mocks.leagueTeamFindFirst).not.toHaveBeenCalled()
  })

  it('passes (leagueId, platformUserId) to roster query', async () => {
    denyCommissioner()
    allowRoster()
    await canAccessLeagueDraft(LEAGUE, USER)
    expect(db._mocks.rosterFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: LEAGUE, platformUserId: USER } }),
    )
  })

  // --- League-team member: platformUserId ---

  it('allows when league_teams.platformUserId matches userId', async () => {
    denyCommissioner()
    // roster: no row
    allowTeamByPlatformUserId()
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(true)
  })

  it('passes OR clause with platformUserId and claimedByUserId to leagueTeam query', async () => {
    denyCommissioner()
    allowTeamByPlatformUserId()
    await canAccessLeagueDraft(LEAGUE, USER)
    expect(db._mocks.leagueTeamFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          leagueId: LEAGUE,
          OR: [{ platformUserId: USER }, { claimedByUserId: USER }],
        },
      }),
    )
  })

  // --- League-team member: claimedByUserId ---

  it('allows when league_teams.claimedByUserId matches userId', async () => {
    denyCommissioner()
    // roster: no row
    // leagueTeam: found via claimedByUserId (same mock, just verifying intent via description)
    db._mocks.leagueTeamFindFirst.mockImplementation(async ({ where }: any) => {
      const orClauses: Array<{ platformUserId?: string; claimedByUserId?: string }> =
        where?.OR ?? []
      const match = orClauses.some(
        (c) => c.claimedByUserId === USER || c.platformUserId === USER,
      )
      return match ? { id: 'team-claimed' } : null
    })
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(true)
  })

  // --- Non-member ---

  it('denies when user has no league owner, roster, or league_teams row', async () => {
    denyCommissioner()
    // roster: null (default mock)
    // leagueTeam: null (default mock)
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(false)
  })

  it('checks all three tiers in order before denying', async () => {
    denyCommissioner()
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(false)
    expect(db._mocks.leagueFindFirst).toHaveBeenCalledTimes(1)
    expect(db._mocks.rosterFindFirst).toHaveBeenCalledTimes(1)
    expect(db._mocks.leagueTeamFindFirst).toHaveBeenCalledTimes(1)
  })

  // --- /drafts route parity: same access as session API ---

  it('allows access for the same membership criteria used by the draft session API', async () => {
    // The session API calls canAccessLeagueDraft(leagueId, userId) directly.
    // /drafts/[draftId] calls canAccessLeagueDraft(context.leagueId, userId) after resolving the context.
    // Both must allow when the user is a league_teams member (the production case: platformUserId in league_teams).
    denyCommissioner()
    // roster: no row (user not in AllFantasy roster system yet)
    // leagueTeam: has a row (user imported from Sleeper)
    allowTeamByPlatformUserId()
    expect(await canAccessLeagueDraft(LEAGUE, USER)).toBe(true)
  })
})
