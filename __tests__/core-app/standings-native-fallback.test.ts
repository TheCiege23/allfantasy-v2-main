// @vitest-environment node
/**
 * Your record in an AllFantasy-native league when no `LeagueTeam` is claimed by you (2026-10-01).
 * The Career Wire and the home brief both diff `snapshotStandings`; before this a native seat the
 * `LeagueTeam` mirror did not tie to you never produced a result, however many games you played.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ teamFind: vi.fn(), redraftFind: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    redraftRoster: { findMany: h.redraftFind },
  },
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: vi.fn() }))

import { diffStandings, snapshotStandings } from '@/lib/core-app/sinceLastVisit'
import { buildCareerFeed } from '@/lib/core-app/careerFeed'
import { decorateChanges, type CareerWireData, type WireLeague } from '@/lib/core-app/careerWireModel'

const roster = (leagueId: string, season: number, w: number, l: number, seed: number | null) => ({
  leagueId,
  wins: w,
  losses: l,
  ties: 0,
  playoffSeed: seed,
  season: { season },
})

beforeEach(() => {
  h.teamFind.mockReset().mockResolvedValue([])
  h.redraftFind.mockReset().mockResolvedValue([])
})

describe('snapshotStandings — native fallback', () => {
  it('🛑 an unclaimed native seat reads its record and seed from the season roster', async () => {
    h.redraftFind.mockResolvedValue([roster('af-home', 2026, 1, 2, 7)])
    const out = await snapshotStandings('u1', ['af-home'])
    expect(h.redraftFind.mock.calls[0][0].where).toEqual({ leagueId: { in: ['af-home'] }, ownerId: 'u1' })
    expect(out).toEqual({ 'af-home': { rank: 7, wins: 1, losses: 2, ties: 0 } })
  })

  it('a claimed team is never overridden, and only the unclaimed leagues are looked up', async () => {
    h.teamFind.mockResolvedValue([{ leagueId: 'af-ice', currentRank: 2, wins: 3, losses: 0, ties: 0 }])
    h.redraftFind.mockResolvedValue([roster('af-home', 2026, 1, 2, 7)])
    const out = await snapshotStandings('u1', ['af-ice', 'af-home'])
    expect(h.redraftFind.mock.calls[0][0].where.leagueId).toEqual({ in: ['af-home'] })
    expect(out['af-ice']).toEqual({ rank: 2, wins: 3, losses: 0, ties: 0 })
    expect(out['af-home']).toMatchObject({ wins: 1, losses: 2 })
  })

  it('a league with TWO claimed teams stays dropped — the fallback does not resurrect it', async () => {
    h.teamFind.mockResolvedValue([
      { leagueId: 'af-dup', currentRank: 1, wins: 1, losses: 0, ties: 0 },
      { leagueId: 'af-dup', currentRank: 4, wins: 0, losses: 1, ties: 0 },
    ])
    expect(await snapshotStandings('u1', ['af-dup'])).toEqual({})
    expect(h.redraftFind).not.toHaveBeenCalled()
  })

  it('the newest season wins, whatever order the rows arrive in', async () => {
    h.redraftFind.mockResolvedValue([roster('af-home', 2026, 2, 1, 3), roster('af-home', 2025, 9, 5, 1)])
    expect((await snapshotStandings('u1', ['af-home']))['af-home']).toMatchObject({ wins: 2, losses: 1, rank: 3 })
  })

  it('a seed before any game is not a rank', async () => {
    h.redraftFind.mockResolvedValue([roster('af-home', 2026, 0, 0, 5)])
    expect((await snapshotStandings('u1', ['af-home']))['af-home']).toEqual({ rank: null, wins: 0, losses: 0, ties: 0 })
  })

  it('a failed read is no fallback, not a failed snapshot', async () => {
    h.teamFind.mockResolvedValue([{ leagueId: 'af-ice', currentRank: 2, wins: 3, losses: 0, ties: 0 }])
    h.redraftFind.mockRejectedValue(new Error('P2021'))
    expect(await snapshotStandings('u1', ['af-ice', 'af-home'])).toEqual({ 'af-ice': { rank: 2, wins: 3, losses: 0, ties: 0 } })
  })
})

describe('native result → Career Wire feed', () => {
  it('two visits a week apart put the native game in the feed, labelled AllFantasy', async () => {
    h.redraftFind.mockResolvedValueOnce([roster('af-home', 2026, 1, 2, 7)])
    const before = await snapshotStandings('u1', ['af-home'])
    h.redraftFind.mockResolvedValueOnce([roster('af-home', 2026, 2, 2, 4)])
    const after = await snapshotStandings('u1', ['af-home'])

    const changes = diffStandings(
      { takenAt: '2026-09-24T12:00:00Z', standings: before, injuries: {} },
      { takenAt: '2026-10-01T12:00:00Z', standings: after, injuries: {} },
      new Map([['af-home', 'Home League']]),
    )
    expect(changes).toEqual([expect.objectContaining({ leagueId: 'af-home', won: 1, lost: 0, rank: 4, previousRank: 7 })])

    const leagues = [{ leagueId: 'af-home', leagueName: 'Home League', platform: 'allfantasy' }] as unknown as WireLeague[]
    const wire = { leagues, changes: decorateChanges(changes, leagues), platforms: [] } as unknown as CareerWireData
    const feed = buildCareerFeed({ wire, stakes: [], now: new Date('2026-10-01T12:00:00Z') } as Parameters<typeof buildCareerFeed>[0])
    expect(feed).toEqual([
      expect.objectContaining({ kind: 'result', tone: 'good', leagueId: 'af-home', platform: 'AllFantasy', title: 'Climbed to #4' }),
    ])
  })
})
