/**
 * Scout: the membership gate, and facts in place of labels.
 *
 * ── 🛑 WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * The first version of `lib/core-app/scout.ts` read `lib/decision-os/psychology-os` directly — a
 * clean cached feed with no entitlement or membership check — and handed every opponent's labels,
 * scores and trajectory to every caller. Milestone 32 then withheld characterisation from everyone,
 * and the 2026-09-30 ruling retired every psychology leftover. Scout now shows standings FACTS.
 *
 * Two properties survive every one of those changes and are pinned here:
 *   1. A NON-MEMBER GETS NOTHING. `leagueId` arrives from the URL; a loader that trusts the page to
 *      have gated it would hand a stranger every manager's name and record.
 *   2. NO CHARACTERISATION, FROM ANY SOURCE. The profile feed is mocked with a loud fake profile; if
 *      a refactor ever reads it again, the label text shows up in the serialized payload.
 *
 * ⚠ EVERY ASSERTION BELOW IS WRITTEN TO BE ABLE TO FAIL — see the positive controls (the member
 * cases assert names and records ARE present, so the absence checks are not passing on an empty
 * payload).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  matchupFindMany: vi.fn(),
  membership: vi.fn(),
  standings: vi.fn(),
  loadProfiles: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    weeklyMatchup: { findMany: h.matchupFindMany },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/core-app/leagueStandings', () => ({ getLeagueStandings: h.standings }))
// Mocked so that a regression which reads the feed again is VISIBLE, not so that Scout can use it.
vi.mock('@/lib/decision-os/psychology-os', () => ({
  createPsychologyOsLoaders: () => ({ loadProfiles: h.loadProfiles, drainOutcomes: () => ({}) }),
}))
vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 4 })),
  resolveCurrentWeek: vi.fn(async () => null),
}))

import { getScoutData } from '@/lib/core-app/scout'

const ME = 'user-1'

const team = (externalId: string, over: Record<string, unknown> = {}) => ({
  id: `row-${externalId}`,
  externalId,
  ownerName: `Owner ${externalId}`,
  teamName: `Team ${externalId}`,
  avatarUrl: null,
  claimedByUserId: null,
  ...over,
})

const boardTeam = (rosterId: string, seed: number, wins: number, losses: number) => ({
  rosterId,
  seed,
  record: { wins, losses, ties: 0 },
  pointsFor: 400 - seed * 10,
  pointsAgainst: 380,
  form: ['W', 'L', 'W'],
  zone: seed <= 2 ? 'playoff' : 'out',
  gamesBack: seed <= 2 ? -1 : 1,
  powerRank: seed,
})

const standings = () => ({
  available: true,
  seasonComplete: false,
  board: {
    season: 2026,
    throughWeek: 3,
    orderBasis: 'Order is winning percentage, then points for, then head-to-head.',
    hasHeadToHead: true,
    teams: [boardTeam('rival', 1, 3, 0), boardTeam('mine', 2, 2, 1), boardTeam('third', 3, 0, 3)],
    h2h: { mine: { rival: { wins: 0, losses: 1, ties: 0 } } },
  },
})

beforeEach(() => {
  vi.resetAllMocks()
  h.leagueFindUnique.mockResolvedValue({ id: 'lg1', name: 'The Gauntlet', sport: 'NFL', platformLeagueId: 'plat1', season: 2026, status: 'in_season' })
  h.teamFindMany.mockResolvedValue([team('mine', { claimedByUserId: ME }), team('rival'), team('third')])
  h.matchupFindMany.mockResolvedValue([
    { rosterId: 'mine', matchupId: 1 },
    { rosterId: 'rival', matchupId: 1 },
    { rosterId: 'third', matchupId: 2 },
  ])
  h.standings.mockResolvedValue(standings())
  h.loadProfiles.mockResolvedValue([
    { managerId: 'rival', labels: ['Aggressive trader', 'Win-now'], evidenceCount: 44, trajectory: { summary: 'Rebuilder in 2023' } },
  ])
})

const member = { ok: true, access: { leagueId: 'lg1', leagueSport: 'NFL', isCommissioner: false, isMember: true, isOwner: false, via: 'claim' } }

describe('Scout refuses a non-member outright', () => {
  it('names no manager, no record and no standing', async () => {
    h.membership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
    const data = await getScoutData('lg1', ME)
    expect(data?.managers.available).toBe(false)
    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('rival')
    expect(serialized).not.toContain('Owner')
    expect(h.teamFindMany).not.toHaveBeenCalled()
    expect(h.standings).not.toHaveBeenCalled()
  })

  it('says a failed membership check failed, rather than calling the viewer a non-member', async () => {
    h.membership.mockRejectedValue(new Error('db down'))
    const data = await getScoutData('lg1', ME)
    expect(data?.managers.available).toBe(false)
    if (data && !data.managers.available) {
      expect(data.managers.reason).toMatch(/could not be checked/)
      expect(data.managers.reason).not.toMatch(/not a member/)
    }
  })
})

describe('Scout shows facts, never a characterisation', () => {
  it('a member gets every manager with their seed, record and form (the positive control)', async () => {
    h.membership.mockResolvedValue(member)
    const data = await getScoutData('lg1', ME)
    if (!data?.managers.available) throw new Error('expected managers')
    const rival = data.managers.data.find((m) => m.managerId === 'rival')
    expect(rival?.standing).toMatchObject({ seed: 1, record: { wins: 3, losses: 0, ties: 0 }, form: ['W', 'L', 'W'] })
    expect(JSON.stringify(data)).toContain('Owner rival')
  })

  it('never reads the profile feed, and no label reaches the payload', async () => {
    h.membership.mockResolvedValue(member)
    const data = await getScoutData('lg1', ME)
    expect(h.loadProfiles).not.toHaveBeenCalled()
    const serialized = JSON.stringify(data)
    for (const leak of ['Aggressive trader', 'Win-now', 'Rebuilder in 2023', 'evidenceCount', 'observations']) {
      expect(serialized).not.toContain(leak)
    }
  })

  it('pins this week’s opponent first, then follows the table’s own order', async () => {
    h.membership.mockResolvedValue(member)
    h.matchupFindMany.mockResolvedValue([
      { rosterId: 'mine', matchupId: 1 },
      { rosterId: 'third', matchupId: 1 },
      { rosterId: 'rival', matchupId: 2 },
    ])
    const data = await getScoutData('lg1', ME)
    if (!data?.managers.available) throw new Error('expected managers')
    expect(data.managers.data.map((m) => m.managerId)).toEqual(['third', 'rival', 'mine'])
  })

  it('carries your head-to-head record against this week’s opponent', async () => {
    h.membership.mockResolvedValue(member)
    const data = await getScoutData('lg1', ME)
    expect(data?.opponent).toEqual({ managerId: 'rival', teamName: 'Team rival', headToHead: { wins: 0, losses: 1, ties: 0 } })
    expect(data?.you?.standing?.seed).toBe(2)
  })

  it('reports no head-to-head when you have not played them, rather than a 0-0 record', async () => {
    h.membership.mockResolvedValue(member)
    const s = standings()
    s.board.h2h = { mine: { rival: { wins: 0, losses: 0, ties: 0 } } }
    h.standings.mockResolvedValue(s)
    const data = await getScoutData('lg1', ME)
    expect(data?.opponent?.headToHead).toBeNull()
  })

  it('states the basis, and the Standings loader’s own reason when there is no table', async () => {
    h.membership.mockResolvedValue(member)
    const ok = await getScoutData('lg1', ME)
    expect(ok?.basis).toEqual({ available: true, data: expect.objectContaining({ season: 2026, throughWeek: 3, seasonComplete: false }) })

    h.standings.mockResolvedValue({ available: false, reason: 'nothing has been scored in 2026 yet.', leagueName: 'x', history: [] })
    const none = await getScoutData('lg1', ME)
    expect(none?.basis).toEqual({ available: false, reason: 'nothing has been scored in 2026 yet.' })
    // Managers are still listed — an empty table is not an empty league.
    expect(none?.managers.available && none.managers.data.length).toBe(3)
    if (none?.managers.available) expect(none.managers.data.every((m) => m.standing === null)).toBe(true)
  })

  it('a failed teams read says so, rather than claiming nothing was imported', async () => {
    h.membership.mockResolvedValue(member)
    h.teamFindMany.mockRejectedValue(new Error('timeout'))
    const data = await getScoutData('lg1', ME)
    if (data && !data.managers.available) expect(data.managers.reason).toMatch(/could not be read/)
    else throw new Error('expected an unavailable list')
  })
})
