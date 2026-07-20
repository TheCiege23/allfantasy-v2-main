// @vitest-environment node
/**
 * lib/league-access.ts — THE canonical league-membership predicate.
 *
 * Four different "is this user a member" predicates existed across the codebase, each anchored on a
 * different column, so a user could be a member by one definition and a non-member by another. Two
 * of them gated real surfaces on columns that do not cover the whole membership population:
 *
 *   server/services/matchupCenterService.ts   LeagueTeam.platformUserId  -> 403'd 98/176 real members
 *   app/api/leagues/[id]/matchups/route.ts    owner|redraft|claim        -> 403'd 134/176 real members
 *
 * (Both measured against production 2026-07-20. `Roster.platformUserId` is the largest membership
 * population and neither gate included it.)
 *
 * These tests pin the union predicate: owner | redraft | roster | claim. Each member path is
 * asserted independently, because the regression being fixed is precisely "one path works, another
 * silently 403s". Uses a filtering in-memory Prisma fake so the real query shapes are exercised
 * rather than just asserting call arguments.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, store } = vi.hoisted(() => {
  const store = {
    leagues: new Map<string, { id: string; sport: string; userId: string | null }>(),
    redraftMembers: [] as { leagueId: string; userId: string; role: string }[],
    rosters: [] as { leagueId: string; platformUserId: string }[],
    leagueTeams: [] as { leagueId: string; claimedByUserId: string | null; platformUserId: string | null }[],
  }

  const prismaMock = {
    league: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.leagues.get(where.id) ?? null),
    },
    redraftLeagueMember: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { leagueId: string; userId: string } } }) => {
        const { leagueId, userId } = where.leagueId_userId
        return store.redraftMembers.find((m) => m.leagueId === leagueId && m.userId === userId) ?? null
      }),
    },
    roster: {
      count: vi.fn(async ({ where }: { where: { leagueId: string; platformUserId: string } }) =>
        store.rosters.filter((r) => r.leagueId === where.leagueId && r.platformUserId === where.platformUserId).length
      ),
    },
    leagueTeam: {
      count: vi.fn(async ({ where }: { where: { leagueId: string; claimedByUserId: string } }) =>
        store.leagueTeams.filter(
          (t) => t.leagueId === where.leagueId && t.claimedByUserId === where.claimedByUserId
        ).length
      ),
    },
  }

  return { prismaMock, store }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { resolveLeagueMembership, resolveLeagueAccess, assertLeagueMember } = await import('@/lib/league-access')

const LEAGUE = 'league-uuid-1'
const OWNER = 'user-owner'
const REDRAFT = 'user-redraft'
const ROSTER = 'user-roster'
const CLAIM = 'user-claim'
const STRANGER = 'user-stranger'

beforeEach(() => {
  store.leagues.clear()
  store.redraftMembers.length = 0
  store.rosters.length = 0
  store.leagueTeams.length = 0
  vi.clearAllMocks()

  store.leagues.set(LEAGUE, { id: LEAGUE, sport: 'NFL', userId: OWNER })
  store.redraftMembers.push({ leagueId: LEAGUE, userId: REDRAFT, role: 'MEMBER' })
  store.rosters.push({ leagueId: LEAGUE, platformUserId: ROSTER })
  // claim-only manager: claimedByUserId set, platformUserId NULL (the nullable column)
  store.leagueTeams.push({ leagueId: LEAGUE, claimedByUserId: CLAIM, platformUserId: null })
})

describe('resolveLeagueMembership — every member path is admitted', () => {
  it('admits all four member paths, and reports how each was proved', async () => {
    const cases: { userId: string; expectedVia: string }[] = [
      { userId: OWNER, expectedVia: 'owner' },
      { userId: REDRAFT, expectedVia: 'redraft' },
      { userId: ROSTER, expectedVia: 'roster' },
      { userId: CLAIM, expectedVia: 'claim' },
    ]

    // Collect every offender, then assert the list is empty — an expect() inside the loop would
    // abort on the first miss and leave the remaining paths unchecked, which is exactly how the
    // original bug stayed invisible.
    const offenders: string[] = []
    for (const c of cases) {
      const r = await resolveLeagueMembership(LEAGUE, c.userId)
      if (!r.ok) offenders.push(`${c.userId}: expected member, got ${r.reason} (${r.status})`)
      else if (r.access.via !== c.expectedVia) offenders.push(`${c.userId}: via=${r.access.via}, expected ${c.expectedVia}`)
      else if (!r.access.isMember) offenders.push(`${c.userId}: isMember=false`)
    }

    expect(offenders).toEqual([])
    expect(cases).toHaveLength(4) // non-empty floor: an empty case list must not read as a pass
  })

  it('negative control — removing each membership row makes exactly that user a non-member', async () => {
    const offenders: string[] = []

    store.redraftMembers.length = 0
    const redraft = await resolveLeagueMembership(LEAGUE, REDRAFT)
    if (redraft.ok) offenders.push('redraft member still admitted after its row was removed')

    store.rosters.length = 0
    const roster = await resolveLeagueMembership(LEAGUE, ROSTER)
    if (roster.ok) offenders.push('roster member still admitted after its row was removed')

    store.leagueTeams.length = 0
    const claim = await resolveLeagueMembership(LEAGUE, CLAIM)
    if (claim.ok) offenders.push('claim manager still admitted after its row was removed')

    expect(offenders).toEqual([])
  })
})

describe('resolveLeagueMembership — ordering: anonymous 401, missing 404, non-member 403', () => {
  it('returns 401 for an anonymous caller, without querying the league', async () => {
    const r = await resolveLeagueMembership(LEAGUE, null)
    expect(r).toEqual({ ok: false, reason: 'anonymous', status: 401 })
    expect(prismaMock.league.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for a league that does not exist', async () => {
    const r = await resolveLeagueMembership('no-such-league', OWNER)
    expect(r).toEqual({ ok: false, reason: 'not_found', status: 404 })
  })

  it('returns 403 for an authenticated non-member', async () => {
    const r = await resolveLeagueMembership(LEAGUE, STRANGER)
    expect(r).toEqual({ ok: false, reason: 'not_member', status: 403 })
  })
})

describe('LeagueTeam.platformUserId is NOT part of the gate', () => {
  it('does not admit a user who only appears in LeagueTeam.platformUserId', async () => {
    const PLATFORM_ONLY = 'user-platform-only'
    store.leagueTeams.push({ leagueId: LEAGUE, claimedByUserId: null, platformUserId: PLATFORM_ONLY })

    const r = await resolveLeagueMembership(LEAGUE, PLATFORM_ONLY)
    expect(r.ok).toBe(false)

    // The gate must never query leagueTeam on that column — it is nullable and covers a different
    // population than rosters, which is what produced the 55.7% false-negative rate.
    const claimQueries = prismaMock.leagueTeam.count.mock.calls.map((c) => JSON.stringify(c[0]))
    const offenders = claimQueries.filter((q) => q.includes('platformUserId'))
    expect(offenders).toEqual([])
  })
})

describe('back-compat: existing callers keep their contract', () => {
  it('resolveLeagueAccess still returns null for every no-access case', async () => {
    const offenders: string[] = []
    for (const [label, uid] of [['anonymous', null], ['stranger', STRANGER]] as const) {
      const r = await resolveLeagueAccess(LEAGUE, uid)
      if (r !== null) offenders.push(`${label}: expected null, got ${JSON.stringify(r)}`)
    }
    const missing = await resolveLeagueAccess('no-such-league', OWNER)
    if (missing !== null) offenders.push('missing league: expected null')
    expect(offenders).toEqual([])
  })

  it('assertLeagueMember still throws 403 for ALL failure modes, including a missing league', async () => {
    // Widening this to 404 would silently change the response of ~28 existing callers and leak
    // league existence, so it is pinned deliberately.
    const offenders: string[] = []
    for (const [label, leagueId, uid] of [
      ['anonymous', LEAGUE, null],
      ['stranger', LEAGUE, STRANGER],
      ['missing league', 'no-such-league', OWNER],
    ] as const) {
      let status: unknown = 'did not throw'
      try {
        await assertLeagueMember(leagueId, uid)
      } catch (e) {
        status = (e as { status?: number }).status
      }
      if (status !== 403) offenders.push(`${label}: expected throw 403, got ${String(status)}`)
    }
    expect(offenders).toEqual([])
  })

  it('assertLeagueMember returns access for a roster-only member (the regression this fixes)', async () => {
    const access = await assertLeagueMember(LEAGUE, ROSTER)
    expect(access.isMember).toBe(true)
    expect(access.via).toBe('roster')
    expect(access.isOwner).toBe(false)
  })
})
