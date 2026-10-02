/**
 * Scout does not name last season's final opponent as THIS WEEK.
 *
 * `resolveCurrentWeek` answers a finished season with its LAST week — right for a standings
 * table, wrong for "the manager you play this week". All off-season Scout read "Week 17 of
 * 2025" and pinned that week's opponent to the top under a THIS WEEK tag.
 *
 * ⚠ THE IN-SEASON CASE IS ASSERTED TOO, so the fix cannot pass by never naming anyone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  matchupFindMany: vi.fn(),
  resolveAccess: vi.fn(),
  standings: vi.fn(),
  resolveWeek: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    weeklyMatchup: { findMany: h.matchupFindMany },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.resolveAccess }))
vi.mock('@/lib/core-app/leagueStandings', () => ({ getLeagueStandings: h.standings }))
vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: h.resolveWeek,
  resolveCurrentWeek: vi.fn(async () => null),
}))

import { getScoutData, weekIsBehindLeague } from '@/lib/core-app/scout'

const ME = 'user-1'
const team = (externalId: string, over: Record<string, unknown> = {}) => ({
  id: `row-${externalId}`,
  externalId,
  ownerName: `Owner ${externalId}`,
  teamName: `Team ${externalId}`,
  avatarUrl: null,
  wins: 9,
  losses: 8,
  ties: 0,
  claimedByUserId: null,
  ...over,
})

function league(over: Record<string, unknown>) {
  h.leagueFindUnique.mockResolvedValue({ id: 'lg1', name: 'The Gauntlet', sport: 'NFL', platformLeagueId: 'plat1', ...over })
}

beforeEach(() => {
  vi.resetAllMocks()
  h.resolveAccess.mockResolvedValue({ ok: true, access: { leagueId: 'lg1', leagueSport: 'NFL', isCommissioner: false, isMember: true, isOwner: false, via: 'claim' } })
  h.standings.mockResolvedValue({ available: false, reason: 'no table in this test', leagueName: 'x', history: [] })
  h.teamFindMany.mockResolvedValue([team('mine', { claimedByUserId: ME }), team('rival'), team('other')])
  h.matchupFindMany.mockResolvedValue([
    { rosterId: 'mine', matchupId: 4 },
    { rosterId: 'rival', matchupId: 4 },
    { rosterId: 'other', matchupId: 5 },
  ])
})

const tagged = (data: Awaited<ReturnType<typeof getScoutData>>) =>
  data && data.managers.available ? data.managers.data.filter((m) => m.isNextOpponent).map((m) => m.managerId) : []

describe('Scout — a finished season has no "this week"', () => {
  it('in season: names the week and pins this week’s opponent (the control)', async () => {
    league({ season: 2026, status: 'in_season' })
    h.resolveWeek.mockResolvedValue({ seasonYear: 2026, week: 4 })
    const data = await getScoutData('lg1', ME)
    expect(data?.week).toEqual({ seasonYear: 2026, week: 4 })
    expect(tagged(data)).toEqual(['rival'])
  })

  it('a league whose status says the season is over names no week and no opponent', async () => {
    league({ season: 2025, status: 'complete' })
    h.resolveWeek.mockResolvedValue({ seasonYear: 2025, week: 17 })
    const data = await getScoutData('lg1', ME)
    expect(data?.week).toBeNull()
    expect(tagged(data)).toEqual([])
    expect(h.matchupFindMany).not.toHaveBeenCalled()
  })

  it('rows from an older season than the league’s own are not this week', async () => {
    league({ season: 2026, status: 'pre_draft' })
    h.resolveWeek.mockResolvedValue({ seasonYear: 2025, week: 17 })
    const data = await getScoutData('lg1', ME)
    expect(data?.week).toBeNull()
    expect(tagged(data)).toEqual([])
  })
})

describe('weekIsBehindLeague', () => {
  const mar2027 = new Date('2027-03-10T12:00:00Z')
  const jan2027 = new Date('2027-01-05T12:00:00Z')
  const oct2026 = new Date('2026-10-02T12:00:00Z')

  it('is false for the season being played', () => {
    expect(weekIsBehindLeague({ seasonYear: 2026 }, { sport: 'NFL', season: 2026, status: 'in_season' }, oct2026)).toBe(false)
  })
  it('holds an NFL season through January, when fantasy playoffs can still be running', () => {
    expect(weekIsBehindLeague({ seasonYear: 2026 }, { sport: 'NFL', season: 2026, status: null }, jan2027)).toBe(false)
  })
  it('drops an NFL season once the next fantasy year has begun, even with no status synced', () => {
    expect(weekIsBehindLeague({ seasonYear: 2026 }, { sport: 'NFL', season: 2026, status: null }, mar2027)).toBe(true)
  })
  it('does not date another sport’s season by the football calendar', () => {
    expect(weekIsBehindLeague({ seasonYear: 2025 }, { sport: 'NBA', season: 2025, status: 'in_season' }, mar2027)).toBe(false)
  })
  it.each(['complete', 'completed', 'season_over', 'archived'])('treats status %s as over', (status) => {
    expect(weekIsBehindLeague({ seasonYear: 2026 }, { sport: 'NFL', season: 2026, status }, oct2026)).toBe(true)
  })
  it('reads lifecycleState when status is absent', () => {
    expect(weekIsBehindLeague({ seasonYear: 2026 }, { sport: 'NFL', season: 2026, status: null, lifecycleState: 'complete' }, oct2026)).toBe(true)
  })
})
