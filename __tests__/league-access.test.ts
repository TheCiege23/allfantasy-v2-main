import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Canonical league-membership predicate.
 *
 * The bug this guards: gating on `LeagueTeam.platformUserId` (nullable, populated only
 * by the native open-slot claim path) 403s real members of imported leagues, whose
 * membership lives in `Roster.platformUserId` (NOT NULL). Every one of the four member
 * paths below must grant access.
 */

const { leagueFindUniqueMock } = vi.hoisted(() => ({ leagueFindUniqueMock: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: leagueFindUniqueMock } },
}))

import { assertLeagueMember, resolveLeagueAccess, type LeagueAccessVia } from '@/lib/league-access'

const LEAGUE_ID = 'league-uuid-1'
const OWNER_ID = 'owner-uuid-1'
const MEMBER_ID = 'member-uuid-2'
const STRANGER_ID = 'stranger-uuid-3'

/** A league row with NO membership relation rows — each test opts one path in. */
function leagueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAGUE_ID,
    sport: 'NFL',
    userId: OWNER_ID,
    redraftMembers: [],
    teams: [],
    rosters: [],
    ...overrides,
  }
}

function arrangeLeague(overrides: Record<string, unknown> = {}) {
  vi.clearAllMocks()
  leagueFindUniqueMock.mockResolvedValue(leagueRow(overrides))
}

/** The four independent ways membership is really established in this schema. */
const MEMBER_PATHS: Array<{
  name: string
  via: LeagueAccessVia
  userId: string
  row: Record<string, unknown>
  expectCommissioner: boolean
}> = [
  {
    name: 'owner (League.userId)',
    via: 'owner',
    userId: OWNER_ID,
    row: {},
    expectCommissioner: true,
  },
  {
    name: 'redraft member (RedraftLeagueMember.userId)',
    via: 'redraft_member',
    userId: MEMBER_ID,
    row: { redraftMembers: [{ role: 'MEMBER' }] },
    expectCommissioner: false,
  },
  {
    name: 'claim-only manager (LeagueTeam.claimedByUserId)',
    via: 'claimed_team',
    userId: MEMBER_ID,
    row: { teams: [{ isCommissioner: false, isCoCommissioner: false }] },
    expectCommissioner: false,
  },
  {
    name: 'Roster-only imported (Sleeper) member (Roster.platformUserId)',
    via: 'roster',
    userId: MEMBER_ID,
    row: { rosters: [{ id: 'roster-1' }] },
    expectCommissioner: false,
  },
]

describe('resolveLeagueAccess — canonical membership predicate', () => {
  beforeEach(() => arrangeLeague())

  it('grants access via EVERY member path (collect-all-offenders)', async () => {
    const offenders: string[] = []

    for (const path of MEMBER_PATHS) {
      arrangeLeague(path.row)
      const access = await resolveLeagueAccess(LEAGUE_ID, path.userId)

      if (!access) {
        offenders.push(`${path.name}: returned null (403) — this member is locked out`)
        continue
      }
      if (!access.isMember) offenders.push(`${path.name}: isMember=false`)
      if (access.via !== path.via) offenders.push(`${path.name}: via=${access.via}, expected ${path.via}`)
      if (access.isCommissioner !== path.expectCommissioner) {
        offenders.push(
          `${path.name}: isCommissioner=${access.isCommissioner}, expected ${path.expectCommissioner}`,
        )
      }
      if (access.leagueId !== LEAGUE_ID) offenders.push(`${path.name}: leagueId=${access.leagueId}`)
    }

    expect(offenders).toEqual([])
  })

  it('NEGATIVE CONTROL: the same loop reports offenders when a path is genuinely broken', async () => {
    // Proves the assertion above can fail. The Roster path is the one the bug broke, so
    // simulate the pre-fix behaviour (Roster row absent) and require it to be reported.
    const offenders: string[] = []
    for (const path of MEMBER_PATHS) {
      arrangeLeague(path.via === 'roster' ? {} : path.row)
      const access = await resolveLeagueAccess(LEAGUE_ID, path.userId)
      if (!access?.isMember) offenders.push(`${path.name}: locked out`)
    }
    expect(offenders).toEqual([
      'Roster-only imported (Sleeper) member (Roster.platformUserId): locked out',
    ])
  })

  it('denies an authenticated non-member (403)', async () => {
    expect(await resolveLeagueAccess(LEAGUE_ID, STRANGER_ID)).toBeNull()
  })

  it('denies an anonymous caller without touching the database', async () => {
    expect(await resolveLeagueAccess(LEAGUE_ID, undefined)).toBeNull()
    expect(await resolveLeagueAccess(LEAGUE_ID, null)).toBeNull()
    expect(await resolveLeagueAccess(LEAGUE_ID, '')).toBeNull()
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns null when the league does not exist', async () => {
    leagueFindUniqueMock.mockResolvedValue(null)
    expect(await resolveLeagueAccess(LEAGUE_ID, OWNER_ID)).toBeNull()
  })

  it('consults all three membership relations, scoped to the caller, in one query', async () => {
    await resolveLeagueAccess(LEAGUE_ID, MEMBER_ID)
    expect(leagueFindUniqueMock).toHaveBeenCalledTimes(1)

    const select = leagueFindUniqueMock.mock.calls[0]?.[0]?.select ?? {}
    const offenders: string[] = []
    for (const relation of ['redraftMembers', 'teams', 'rosters']) {
      if (!select[relation]) offenders.push(`${relation} not consulted`)
    }
    // The nullable column must never be the thing membership is derived from.
    if (select.teams?.where?.platformUserId !== undefined) {
      offenders.push('teams filtered on the nullable platformUserId')
    }
    if (select.teams?.where?.claimedByUserId !== MEMBER_ID) {
      offenders.push('teams not filtered on claimedByUserId for this caller')
    }
    if (select.rosters?.where?.platformUserId !== MEMBER_ID) {
      offenders.push('rosters not filtered on platformUserId for this caller')
    }
    expect(offenders).toEqual([])
  })

  it('surfaces commissioner status from the paths that confer it', async () => {
    const offenders: string[] = []

    arrangeLeague({ redraftMembers: [{ role: 'COMMISSIONER' }] })
    if (!(await resolveLeagueAccess(LEAGUE_ID, MEMBER_ID))?.isCommissioner) {
      offenders.push('RedraftLeagueMember COMMISSIONER not honored')
    }

    arrangeLeague({ teams: [{ isCommissioner: false, isCoCommissioner: true }] })
    if (!(await resolveLeagueAccess(LEAGUE_ID, MEMBER_ID))?.isCommissioner) {
      offenders.push('LeagueTeam co-commissioner not honored')
    }

    expect(offenders).toEqual([])
  })

  it('does not downgrade a redraft commissioner who also holds a Roster row', async () => {
    // Ordering guard: Roster never confers commissioner, so if it were matched first a
    // real commissioner would silently become a plain member.
    arrangeLeague({ redraftMembers: [{ role: 'COMMISSIONER' }], rosters: [{ id: 'roster-1' }] })
    const access = await resolveLeagueAccess(LEAGUE_ID, MEMBER_ID)
    expect(access?.isCommissioner).toBe(true)
    expect(access?.via).toBe('redraft_member')
  })

  it('fails closed when a stale fixture omits the membership relations entirely', async () => {
    // Degrading to "not a member" is the safe direction; it must never throw, and must
    // never accidentally grant.
    leagueFindUniqueMock.mockResolvedValue({ id: LEAGUE_ID, sport: 'NFL', userId: OWNER_ID })
    expect(await resolveLeagueAccess(LEAGUE_ID, MEMBER_ID)).toBeNull()
    expect(await resolveLeagueAccess(LEAGUE_ID, OWNER_ID)).toMatchObject({ isMember: true })
  })
})

describe('assertLeagueMember', () => {
  beforeEach(() => arrangeLeague())

  it('throws a 403-tagged error for a non-member', async () => {
    await expect(assertLeagueMember(LEAGUE_ID, STRANGER_ID)).rejects.toMatchObject({
      message: 'Forbidden',
      status: 403,
    })
  })

  it('resolves for a Roster-only imported member instead of throwing', async () => {
    arrangeLeague({ rosters: [{ id: 'roster-1' }] })
    await expect(assertLeagueMember(LEAGUE_ID, MEMBER_ID)).resolves.toMatchObject({
      isMember: true,
      via: 'roster',
    })
  })
})
