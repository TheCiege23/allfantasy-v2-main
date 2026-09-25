import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A real source commissioner who JOINS an already-imported league was 403'd everywhere.
 *
 * `claimExistingLeagueForMember` attaches them to their own team, which the import marked
 * `isCommissioner` (the provider said so). `lib/league/permissions.ts getLeagueRole` already
 * reads that as 'commissioner', but `lib/commissioner/permissions.ts` — imported by ~118 routes
 * and services — checked ONLY `League.userId`, i.e. whoever happened to import first.
 *
 * Head commissioner only. A co-commissioner is NOT admitted here: the settings routes grant
 * co-commissioners what they may do through `requireCommissionerRole`, and widening this module
 * would hand them every commissioner-only action at once.
 */

const { leagueFindFirst, teamFindFirst } = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  teamFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: leagueFindFirst },
    leagueTeam: { findFirst: teamFindFirst },
  },
}))

import { assertCommissioner, getLeagueIfCommissioner, isCommissioner } from '@/lib/commissioner/permissions'

const LEAGUE = { id: 'lg1', userId: 'owner', name: 'League' }

/**
 * The fake DB: League rows filtered by the `where` actually sent, so a query that forgets
 * `userId` cannot pass by accident; team lookups answer with the claimed row for `claimant`.
 */
function db(claimed: null | { claimant: string; isCommissioner: boolean; isCoCommissioner?: boolean; role: string }) {
  leagueFindFirst.mockImplementation(async ({ where }: { where: { id: string; userId?: string } }) => {
    if (where.id !== LEAGUE.id) return null
    if (where.userId !== undefined && where.userId !== LEAGUE.userId) return null
    return LEAGUE
  })
  teamFindFirst.mockImplementation(async ({ where }: { where: { leagueId: string; claimedByUserId: string } }) => {
    if (!claimed || where.leagueId !== LEAGUE.id || where.claimedByUserId !== claimed.claimant) return null
    return {
      isCommissioner: claimed.isCommissioner,
      isCoCommissioner: claimed.isCoCommissioner ?? false,
      role: claimed.role,
    }
  })
}

async function all(userId: string) {
  const is = await isCommissioner(LEAGUE.id, userId)
  const got = await getLeagueIfCommissioner(LEAGUE.id, userId)
  let asserted: boolean
  try {
    await assertCommissioner(LEAGUE.id, userId)
    asserted = true
  } catch (err) {
    expect((err as { status?: number }).status).toBe(403)
    asserted = false
  }
  return { is, got: got?.id ?? null, asserted }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lib/commissioner/permissions', () => {
  it('the League.userId owner passes, in ONE query', async () => {
    db(null)
    expect(await all('owner')).toEqual({ is: true, got: 'lg1', asserted: true })
    // one League read per call, never a team lookup
    expect(teamFindFirst).not.toHaveBeenCalled()
  })

  it('a claimed team marked isCommissioner passes all three, and returns the League row', async () => {
    db({ claimant: 'joiner', isCommissioner: true, role: 'commissioner' })
    expect(await all('joiner')).toEqual({ is: true, got: 'lg1', asserted: true })
    const league = await getLeagueIfCommissioner(LEAGUE.id, 'joiner')
    expect(league).toEqual(LEAGUE)
  })

  it('a claimed CO-commissioner does not — they go through requireCommissionerRole', async () => {
    db({ claimant: 'co', isCommissioner: false, isCoCommissioner: true, role: 'co_commissioner' })
    expect(await all('co')).toEqual({ is: false, got: null, asserted: false })
  })

  it('a claimed ordinary member does not', async () => {
    db({ claimant: 'member', isCommissioner: false, role: 'member' })
    expect(await all('member')).toEqual({ is: false, got: null, asserted: false })
  })

  it('an unrelated user does not', async () => {
    db({ claimant: 'joiner', isCommissioner: true, role: 'commissioner' })
    expect(await all('stranger')).toEqual({ is: false, got: null, asserted: false })
  })

  it('a VIEWER-role team does not, even with isCommissioner set', async () => {
    db({ claimant: 'viewer', isCommissioner: true, role: 'viewer' })
    expect(await all('viewer')).toEqual({ is: false, got: null, asserted: false })
  })

  it('no user id is never a commissioner, and touches nothing', async () => {
    db({ claimant: 'joiner', isCommissioner: true, role: 'commissioner' })
    expect(await isCommissioner(LEAGUE.id, undefined)).toBe(false)
    expect(await getLeagueIfCommissioner(LEAGUE.id, undefined)).toBeNull()
    expect(leagueFindFirst).not.toHaveBeenCalled()
    expect(teamFindFirst).not.toHaveBeenCalled()
  })

  it('a league that does not exist is nobody’s, claimed team or not', async () => {
    db({ claimant: 'joiner', isCommissioner: true, role: 'commissioner' })
    expect(await isCommissioner('missing', 'joiner')).toBe(false)
    expect(await getLeagueIfCommissioner('missing', 'joiner')).toBeNull()
  })
})
