/**
 * The chopped team's players (lib/guillotine/choppedReleases.ts): written at the chop so the league
 * home's chop moment and the war room can show them, once per team per week; "claimed" read from the
 * rosters themselves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  releases: [] as Array<Record<string, unknown>>,
  roster: [] as Array<{ rosterId: string; playerId: string; playerName: string; position: string; team: string | null; sport: string; droppedAt: Date | null; seasonId: string }>,
}))

const fake = vi.hoisted(() => ({
  guillotineWaiverRelease: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      db.releases.find((r) => r.leagueId === where.leagueId && r.scoringPeriod === where.scoringPeriod && r.eliminatedRosterId === where.eliminatedRosterId) ?? null),
    createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { db.releases.push(...data); return { count: data.length } }),
  },
  redraftRosterPlayer: {
    findMany: vi.fn(async ({ where }: { where: { rosterId?: string; playerId?: { in: string[] }; droppedAt?: null; roster?: { seasonId: string } } }) =>
      db.roster.filter((p) =>
        // Only what the query asks for: a query without `droppedAt: null` sees dropped players too.
        (!('droppedAt' in where) || p.droppedAt == null) &&
        (where.rosterId == null || p.rosterId === where.rosterId) &&
        (where.playerId == null || where.playerId.in.includes(p.playerId)) &&
        (where.roster == null || p.seasonId === where.roster.seasonId))),
  },
  redraftSeason: { findFirst: vi.fn(async () => ({ id: 's-2026' })) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: fake }))

import { claimedPlayerIds, recordChoppedReleases } from '@/lib/guillotine/choppedReleases'

const AT = new Date('2026-11-04T05:00:00Z')
const player = (rosterId: string, playerId: string, over: Partial<(typeof db.roster)[number]> = {}) =>
  ({ rosterId, playerId, playerName: playerId.toUpperCase(), position: 'PG', team: 'BOS', sport: 'NBA', droppedAt: null, seasonId: 's-2026', ...over })

beforeEach(() => {
  db.releases = []
  db.roster = [player('rr-b', 'p1'), player('rr-b', 'p2', { position: 'C', team: null }), player('rr-b', 'p-old', { droppedAt: new Date('2026-10-01') }), player('rr-a', 'p9')]
})

describe('recordChoppedReleases', () => {
  it('lists every player the chopped team still holds, with when he can be claimed', async () => {
    expect(await recordChoppedReleases({ leagueId: 'L1', guillotineSeasonId: 'g1', week: 3, redraftRosterIds: ['rr-b'], availableAt: AT })).toBe(2)
    expect(db.releases).toEqual([
      { seasonId: 'g1', leagueId: 'L1', eliminatedRosterId: 'rr-b', scoringPeriod: 3, playerId: 'p1', playerName: 'P1', position: 'PG', team: 'BOS', sport: 'NBA', releaseStatus: 'pending', availableAt: AT },
      { seasonId: 'g1', leagueId: 'L1', eliminatedRosterId: 'rr-b', scoringPeriod: 3, playerId: 'p2', playerName: 'P2', position: 'C', team: null, sport: 'NBA', releaseStatus: 'pending', availableAt: AT },
    ])
  })

  it('once per team per week: a retried or recovered chop lists nobody twice', async () => {
    const args = { leagueId: 'L1', guillotineSeasonId: 'g1', week: 3, redraftRosterIds: ['rr-b', 'rr-b'], availableAt: AT }
    expect(await recordChoppedReleases(args)).toBe(2)
    expect(await recordChoppedReleases(args)).toBe(0)
    expect(db.releases).toHaveLength(2)
    // The same team in another week is another list.
    expect(await recordChoppedReleases({ ...args, week: 4 })).toBe(2)
  })

  it('a team with nobody left writes nothing', async () => {
    db.roster = [player('rr-b', 'p1', { droppedAt: AT })]
    expect(await recordChoppedReleases({ leagueId: 'L1', guillotineSeasonId: 'g1', week: 3, redraftRosterIds: ['rr-b'], availableAt: AT })).toBe(0)
    expect(fake.guillotineWaiverRelease.createMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: [] }))
  })
})

describe('claimedPlayerIds', () => {
  it('a released player on a team in this season again is claimed; one still out there, or dropped again, is not', async () => {
    db.roster = [
      player('rr-a', 'p1'), // picked up
      player('rr-c', 'p2', { droppedAt: new Date('2026-11-05') }), // picked up, then dropped
      player('rr-z', 'p3', { seasonId: 's-2025' }), // on a team last season only
    ]
    expect(await claimedPlayerIds('L1', ['p1', 'p2', 'p3', 'p4'])).toEqual(new Set(['p1']))
  })

  it('no players, or no season: nobody is claimed', async () => {
    expect(await claimedPlayerIds('L1', [])).toEqual(new Set())
    fake.redraftSeason.findFirst.mockResolvedValueOnce(null as never)
    expect(await claimedPlayerIds('L1', ['p1'])).toEqual(new Set())
  })
})
