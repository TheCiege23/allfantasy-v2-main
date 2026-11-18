/**
 * Screens that look up "my team" follow the team a manager switched to.
 *
 * A manager who runs several teams in one league picks one in the league header; that choice rides
 * on the request as the active-team cookie. These are the two shared readers the remaining callers
 * were moved onto: the roster `where` and the core app's claimed team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cookie: '' as string, rosterFindMany: vi.fn(), teamFindFirst: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'af_active_teams' && h.cookie ? { value: h.cookie } : undefined) }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { roster: { findMany: h.rosterFindMany }, leagueTeam: { findFirst: h.teamFindFirst } },
}))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null) }))

import { viewingRosterWhere } from '@/lib/league/viewerTeams'
import { managedRosterWhere } from '@/lib/league/rosterManager'
import { createLeagueContext } from '@/lib/core-app/leagueContext'

const FIRST = { id: 'roster-first-1', redraftRosterId: null }
const SECOND = { id: 'roster-second-2', redraftRosterId: null }

beforeEach(() => {
  vi.resetAllMocks()
  h.cookie = ''
})

describe('the roster a screen reads', () => {
  it('is the one team of a manager with one team', async () => {
    h.rosterFindMany.mockResolvedValue([FIRST])
    expect(await viewingRosterWhere('L', 'u1')).toEqual({ leagueId: 'L', id: FIRST.id })
    // Both ways of running a team are asked for: the owner key and the managed-by column.
    expect(h.rosterFindMany.mock.calls[0][0].where).toEqual(managedRosterWhere('L', 'u1'))
  })

  it('is the team switched to when a manager runs several, and the first when none is chosen', async () => {
    h.rosterFindMany.mockResolvedValue([FIRST, SECOND])
    expect(await viewingRosterWhere('L', 'u1')).toEqual({ leagueId: 'L', id: FIRST.id })
    h.cookie = SECOND.id
    expect(await viewingRosterWhere('L', 'u1')).toEqual({ leagueId: 'L', id: SECOND.id })
    // A remembered team from some other league is not one of theirs here: the first again.
    h.cookie = 'roster-elsewhere-9'
    expect(await viewingRosterWhere('L', 'u1')).toEqual({ leagueId: 'L', id: FIRST.id })
  })

  it('is the co-owned team for a co-owner, and finds nothing for someone with no team', async () => {
    expect(await viewingRosterWhere('L', 'u1', 'roster-coowned-3')).toEqual({ leagueId: 'L', id: 'roster-coowned-3' })
    expect(h.rosterFindMany).not.toHaveBeenCalled()
    h.rosterFindMany.mockResolvedValue([])
    expect(await viewingRosterWhere('L', 'u2')).toEqual({ leagueId: 'L', platformUserId: 'u2' })
  })
})

describe('the claimed team the core app reads', () => {
  it('is one read, as before, when no team has been switched to', async () => {
    h.teamFindFirst.mockResolvedValue({ id: 't1', externalId: FIRST.id })
    const ctx = createLeagueContext('L', 'u1')
    expect(await ctx.claimedTeam()).toMatchObject({ id: 't1' })
    expect(await ctx.claimedTeam()).toMatchObject({ id: 't1' })
    expect(h.teamFindFirst).toHaveBeenCalledTimes(1)
    expect(h.teamFindFirst.mock.calls[0][0].where).toEqual({ leagueId: 'L', claimedByUserId: 'u1' })
  })

  it('is the team switched to, and falls back when that team is not theirs in this league', async () => {
    h.cookie = SECOND.id
    h.teamFindFirst.mockImplementation(async ({ where }: { where: { externalId?: { in: string[] } } }) =>
      where.externalId ? (where.externalId.in.includes(SECOND.id) ? { id: 't2', externalId: SECOND.id } : null) : { id: 't1', externalId: FIRST.id })
    expect(await createLeagueContext('L', 'u1').claimedTeam()).toMatchObject({ id: 't2' })
    expect(h.teamFindFirst.mock.calls[0][0].where).toEqual({ leagueId: 'L', claimedByUserId: 'u1', externalId: { in: [SECOND.id] } })

    h.cookie = 'roster-elsewhere-9'
    expect(await createLeagueContext('L', 'u1').claimedTeam()).toMatchObject({ id: 't1' })
  })
})
