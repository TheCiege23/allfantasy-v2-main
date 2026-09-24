import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 THE WEIGHTED LOTTERY PAIRED EACH TEAM WITH WHICHEVER ROSTER ID SORTED ALONGSIDE IT.
 *
 * `getStandingsForLottery` sorted `LeagueTeam` and `Roster` rows by id and zipped them by index.
 * Ids are random, so the pairing was arbitrary: a team's record set the odds, and the pick it won
 * went to another manager's roster. Every fixture below uses id orders that DISAGREE with
 * ownership, which is what the zip could never survive.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique } } }))

import { getStandingsForLottery } from '@/lib/draft-lottery/standingsForLottery'

const team = (
  id: string,
  owner: { externalId?: string; claimedByUserId?: string | null; platformUserId?: string | null },
  stats: { wins: number; losses?: number; pointsFor?: number; currentRank?: number | null },
) => ({
  id,
  externalId: owner.externalId ?? `ext-${id}`,
  claimedByUserId: owner.claimedByUserId ?? null,
  platformUserId: owner.platformUserId ?? null,
  ownerName: `Owner ${id}`,
  teamName: `Team ${id}`,
  wins: stats.wins,
  losses: stats.losses ?? 0,
  ties: 0,
  pointsFor: stats.pointsFor ?? 1000,
  currentRank: stats.currentRank ?? null,
})

beforeEach(() => vi.clearAllMocks())

describe('getStandingsForLottery — each team keeps its own roster', () => {
  it("attaches a team's standings to the roster it owns, not the one at its sorted index", async () => {
    findUnique.mockResolvedValue({
      leagueSize: 3,
      // By id: t1, t2, t3 and r1, r2, r3 — but t1 owns r2, t2 owns r3 (by owner), t3 owns r1.
      rosters: [
        { id: 'r1', platformUserId: 'u-t3' },
        { id: 'r2', platformUserId: 'u-t1' },
        { id: 'r3', platformUserId: 'u-t2' },
      ],
      teams: [
        team('t1', { externalId: 'r2' }, { wins: 2, currentRank: 3 }),
        team('t2', { claimedByUserId: 'u-t2' }, { wins: 9, currentRank: 1 }),
        team('t3', { externalId: 'r1' }, { wins: 6, currentRank: 2 }),
      ],
    })

    const rows = await getStandingsForLottery('L1')

    expect(rows.map((r) => [r.displayName, r.rosterId, r.wins, r.rank])).toEqual([
      ['Team t1', 'r2', 2, 3],
      ['Team t2', 'r3', 9, 1],
      ['Team t3', 'r1', 6, 2],
    ])
    expect(rows.map((r) => r.teamIndex)).toEqual([0, 1, 2])
  })

  it('an unresolvable team keeps the positional fallback, among rosters no team owns — never a duplicate', async () => {
    findUnique.mockResolvedValue({
      leagueSize: 3,
      rosters: [
        { id: 'r1', platformUserId: 'u-x' },
        { id: 'r2', platformUserId: 'u-y' },
        { id: 'r3', platformUserId: 'u-z' },
      ],
      teams: [
        team('t1', { externalId: 'r3' }, { wins: 1 }),
        team('t2', {}, { wins: 5 }),
        team('t3', {}, { wins: 7 }),
      ],
    })

    const rows = await getStandingsForLottery('L1')

    // t1 takes the roster it owns; t2 and t3 pair positionally with what is left (r1, r2).
    expect(rows.map((r) => [r.displayName, r.rosterId])).toEqual([
      ['Team t1', 'r3'],
      ['Team t2', 'r1'],
      ['Team t3', 'r2'],
    ])
    expect(new Set(rows.map((r) => r.rosterId)).size).toBe(rows.length)
  })

  it('when nothing resolves, the result is exactly the old pairing — no league gets worse', async () => {
    findUnique.mockResolvedValue({
      leagueSize: 2,
      rosters: [
        { id: 'r1', platformUserId: null },
        { id: 'r2', platformUserId: null },
      ],
      teams: [team('t1', {}, { wins: 3 }), team('t2', {}, { wins: 4 })],
    })

    const rows = await getStandingsForLottery('L1')

    expect(rows.map((r) => [r.displayName, r.rosterId, r.teamIndex, r.rank])).toEqual([
      ['Team t1', 'r1', 0, 1],
      ['Team t2', 'r2', 1, 2],
    ])
  })

  it('iterates teams, not leagueSize: no invented placeholder rows, and a roster with no team still counts', async () => {
    findUnique.mockResolvedValue({
      leagueSize: 6,
      rosters: [
        { id: 'r1', platformUserId: 'u-1' },
        { id: 'r2', platformUserId: 'u-2' },
        { id: 'r3', platformUserId: 'u-3' },
      ],
      teams: [team('t1', { claimedByUserId: 'u-2' }, { wins: 4 }), team('t2', { claimedByUserId: 'u-1' }, { wins: 8 })],
    })

    const rows = await getStandingsForLottery('L1')

    expect(rows.map((r) => [r.displayName, r.rosterId, r.teamIndex])).toEqual([
      ['Team t1', 'r2', 0],
      ['Team t2', 'r1', 1],
      ['Team 3', 'r3', 2],
    ])
    expect(rows.some((r) => r.rosterId.startsWith('placeholder-'))).toBe(false)
  })

  it('a league with no team rows keeps the old roster-and-leagueSize behaviour', async () => {
    findUnique.mockResolvedValue({
      leagueSize: 3,
      rosters: [
        { id: 'r1', platformUserId: 'u-1' },
        { id: 'r2', platformUserId: 'u-2' },
      ],
      teams: [],
    })

    const rows = await getStandingsForLottery('L1')

    expect(rows.map((r) => [r.displayName, r.rosterId])).toEqual([
      ['Team 1', 'r1'],
      ['Team 2', 'r2'],
      ['Team 3', 'placeholder-3'],
    ])
  })

  it('reads the ownership columns the resolver needs', async () => {
    findUnique.mockResolvedValue({ leagueSize: 0, rosters: [], teams: [] })
    await getStandingsForLottery('L1')
    const select = findUnique.mock.calls[0]![0].select
    expect(select.rosters.select).toMatchObject({ id: true, platformUserId: true })
    expect(select.teams.select).toMatchObject({ id: true, externalId: true, claimedByUserId: true, platformUserId: true })
  })
})
