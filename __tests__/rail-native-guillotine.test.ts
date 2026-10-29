import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The rail's guillotine line for NATIVE guillotine leagues (2026-10-18).
 *
 * `getRailMatchups` reads `WeeklyMatchup`, which only provider importers write, so an AllFantasy-hosted
 * league — the owner's main league is a native NBA guillotine league — read "no head-to-head on file
 * this week" on /core and on the league page. These pin the line that replaces it: your points, your
 * rank among the survivors, the distance to the chop line, and the chopped / pre-chop / pre-draft
 * states — all from the tables the score sync and the chop already write.
 */

const db = vi.hoisted(() => ({
  leagues: [] as unknown[],
  seasons: [] as unknown[],
  links: [] as unknown[],
  chops: [] as unknown[],
  settings: [] as unknown[],
  players: [] as unknown[],
  stats: [] as unknown[],
  projections: [] as unknown[],
  h2h: [] as unknown[],
  calls: [] as string[],
}))

vi.mock('@/lib/prisma', () => {
  const track = <T,>(name: string, value: () => T) => async () => {
    db.calls.push(name)
    return value()
  }
  return {
    prisma: {
      league: {
        findMany: async (args: { select: Record<string, unknown> }) => {
          db.calls.push('league')
          return 'settings' in args.select ? db.settings : db.leagues
        },
      },
      redraftSeason: { findMany: track('redraftSeason', () => db.seasons) },
      roster: { findMany: track('roster', () => db.links) },
      guillotineRosterState: { findMany: track('guillotineRosterState', () => db.chops) },
      redraftRosterPlayer: { findMany: track('redraftRosterPlayer', () => db.players) },
      playerWeeklyScore: { findMany: track('playerWeeklyScore', () => db.stats) },
      fantasyProjection: { findMany: track('fantasyProjection', () => db.projections) },
      redraftMatchup: { findMany: track('redraftMatchup', () => db.h2h) },
      // The imported half of `getRailMatchups`: nothing on file, as for every native league.
      weeklyMatchup: { groupBy: async () => [], findMany: async () => [] },
      leagueTeam: { findMany: async () => [] },
      matchupFact: { findMany: async () => [] },
      $queryRaw: async () => [],
      $queryRawUnsafe: async () => [],
    },
  }
})

/* The league's own scoring is the real engine's job; here a stat line's `pts` IS its fantasy points. */
vi.mock('@/lib/redraft/scoringEngine', () => ({
  buildLeagueStatScorer: () => (stats: Record<string, number>) => stats.pts ?? 0,
  isScoringStarterSlot: (slot: string) => slot !== 'bench' && slot !== 'ir',
  leagueIsBestBall: () => false,
}))
vi.mock('@/lib/redraft/weekLineupSlots', () => ({
  loadWeekLineups: async () => new Map(),
  weekSlotType: (row: { slotType: string }) => row.slotType,
}))

import { guillotineLine } from '@/lib/core-app/railGuillotineLine'
import { getNativeRailMatchups } from '@/lib/core-app/nativeRailMatchups'
import { getRailMatchups } from '@/lib/core-app/railMatchups'

describe('guillotineLine — the row mapping', () => {
  const field = (scores: number[]) => scores.map((points, i) => ({ rosterId: `r${i + 1}`, points, projected: null }))

  it('alive: rank among the survivors and the distance above the chop line', () => {
    // 16 alive, points on the board for all; you (r8) at 100, the lowest at 87.6.
    const scores = [150, 140, 130, 125, 120, 115, 110, 100, 99, 98, 97, 96, 95, 94, 93, 87.6]
    const { line, standing } = guillotineLine({ week: 11, firstChopWeek: 10, me: { rosterId: 'r8', points: 100, projected: 120, eliminated: false, choppedWeek: null }, field: field(scores) })
    expect(line).toMatchObject({ state: 'alive', rank: 8, aliveCount: 16, chopMargin: 12.4, basis: 'points', points: 100, projected: 120 })
    expect(standing?.elimination).toBe(true)
  })

  it('chop zone: lowest survivor, with the deficit to the first safe score', () => {
    const { line } = guillotineLine({ week: 11, firstChopWeek: 10, me: { rosterId: 'r3', points: 80, projected: null, eliminated: false, choppedWeek: null }, field: field([120, 83.2, 80]) })
    expect(line).toMatchObject({ state: 'chop_zone', rank: 3, aliveCount: 3, chopMargin: -3.2 })
  })

  it('chop zone honours teamsPerChop: second-lowest is in the zone when two go', () => {
    const { line } = guillotineLine({ week: 11, firstChopWeek: 10, teamsPerChop: 2, me: { rosterId: 'r2', points: 85, projected: null, eliminated: false, choppedWeek: null }, field: field([120, 85, 80]) })
    expect(line).toMatchObject({ state: 'chop_zone', chopMargin: -35 })
  })

  it('eliminated: says which week you were chopped and ranks nothing', () => {
    const { line, standing } = guillotineLine({ week: 12, firstChopWeek: 10, me: { rosterId: 'r9', points: null, projected: null, eliminated: true, choppedWeek: 10 }, field: field([100, 90]) })
    expect(line).toMatchObject({ state: 'eliminated', choppedWeek: 10, rank: null })
    expect(standing).toBeNull()
  })

  it('before the first chop week: names the first chop week, still ranks once scores exist', () => {
    const { line } = guillotineLine({ week: 3, firstChopWeek: 10, me: { rosterId: 'r1', points: 140, projected: null, eliminated: false, choppedWeek: null }, field: field([140, 120, 100]) })
    expect(line).toMatchObject({ state: 'before_first_chop', firstChopWeek: 10, rank: 1, chopMargin: 40 })
  })

  it('no scores yet in a chop week: no rank, no invented margin', () => {
    const { line, standing } = guillotineLine({
      week: 10,
      firstChopWeek: 10,
      me: { rosterId: 'r1', points: null, projected: null, eliminated: false, choppedWeek: null },
      field: [{ rosterId: 'r1', points: null, projected: null }, { rosterId: 'r2', points: null, projected: null }],
    })
    expect(line).toMatchObject({ state: 'no_scores', rank: null, chopMargin: null, aliveCount: 2 })
    expect(standing).toBeNull()
  })

  it('no scores but a fully projected field ranks on projection, and says so', () => {
    const { line } = guillotineLine({
      week: 10,
      firstChopWeek: 10,
      me: { rosterId: 'r1', points: null, projected: 110, eliminated: false, choppedWeek: null },
      field: [{ rosterId: 'r1', points: null, projected: 110 }, { rosterId: 'r2', points: null, projected: 100 }],
    })
    expect(line).toMatchObject({ state: 'alive', rank: 1, chopMargin: 10, basis: 'projected' })
  })

  it('preseason: no season yet, carries the draft time', () => {
    const { line } = guillotineLine({ week: null, firstChopWeek: 10, draftAt: '2026-10-20T00:00:00.000Z', me: { rosterId: '', points: null, projected: null, eliminated: false, choppedWeek: null }, field: [] })
    expect(line).toMatchObject({ state: 'preseason', draftAt: '2026-10-20T00:00:00.000Z', firstChopWeek: 10 })
  })
})

describe('getNativeRailMatchups — DB-first loader', () => {
  const G = 'league-g'
  const H = 'league-h'
  const roster = (id: string, ownerId: string, isEliminated = false) => ({ id, ownerId, ownerName: ownerId, teamName: `Team ${id}`, avatarUrl: null, isEliminated })

  beforeEach(() => {
    db.calls = []
    db.leagues = [
      { id: G, sport: 'NBA', platform: 'allfantasy', leagueVariant: 'guillotine', leagueType: 'redraft', guillotineMode: false, bestBallMode: false, guillotineConfig: { eliminationStartWeek: 2, teamsPerChop: 1 }, leagueSettings: null },
      { id: H, sport: 'NFL', platform: 'allfantasy', leagueVariant: null, leagueType: 'redraft', guillotineMode: false, bestBallMode: false, guillotineConfig: null, leagueSettings: null },
    ]
    db.seasons = [
      { id: 'sg', leagueId: G, season: 2026, status: 'active', currentWeek: 3, sport: 'NBA', rosters: [roster('a', 'me'), roster('b', 'u2'), roster('c', 'u3'), roster('d', 'u4', true)] },
      { id: 'sh', leagueId: H, season: 2026, status: 'active', currentWeek: 6, sport: 'NFL', rosters: [roster('x', 'me'), roster('y', 'u9')] },
    ]
    // Roster `d` was chopped in week 2, filed in the engine's id space (Roster.id `L-d`).
    db.links = [{ id: 'L-d', leagueId: G, platformUserId: 'u4', redraftRosterId: 'd' }, { id: 'L-a', leagueId: G, platformUserId: 'me', redraftRosterId: 'a' }]
    db.chops = [{ leagueId: G, rosterId: 'L-d', choppedInPeriod: 2 }]
    db.settings = [{ id: G, settings: {} }]
    db.players = [
      { rosterId: 'a', playerId: 'p1', slotType: 'PG', position: 'PG', sport: 'NBA' },
      { rosterId: 'a', playerId: 'p2', slotType: 'bench', position: 'C', sport: 'NBA' },
      { rosterId: 'b', playerId: 'p3', slotType: 'SG', position: 'SG', sport: 'NBA' },
      { rosterId: 'c', playerId: 'p4', slotType: 'C', position: 'C', sport: 'NBA' },
    ]
    const at = new Date('2026-10-18T12:00:00Z')
    db.stats = [
      { playerId: 'p1', sport: 'NBA', season: 2026, week: 3, stats: { pts: 112.4 }, updatedAt: at },
      { playerId: 'p2', sport: 'NBA', season: 2026, week: 3, stats: { pts: 500 }, updatedAt: at }, // benched: never counts
      { playerId: 'p3', sport: 'NBA', season: 2026, week: 3, stats: { pts: 130 }, updatedAt: at },
      { playerId: 'p4', sport: 'NBA', season: 2026, week: 3, stats: { pts: 100 }, updatedAt: at },
    ]
    db.projections = [{ playerId: 'p1', sport: 'NBA', season: '2026', week: 3, projectedPoints: 120 }]
    db.h2h = [{ seasonId: 'sh', leagueId: H, week: 6, homeRosterId: 'y', awayRosterId: 'x', homeScore: 88.5, awayScore: 91.25, status: 'active' }]
  })

  it('builds the guillotine line from the live field, excluding chopped teams and the bench', async () => {
    const { byLeague } = await getNativeRailMatchups('me', [G, H])
    const row = byLeague[G]!
    expect(row).toMatchObject({ unpaired: true, native: true, yourScore: 112.4, scored: true, season: 2026, week: 3, eliminated: false })
    expect(row.guillotine).toMatchObject({ state: 'alive', rank: 2, aliveCount: 3, chopMargin: 12.4, points: 112.4, projected: 120, firstChopWeek: 2 })
    expect(row.yourProjection).toMatchObject({ projected: 120, pricedFrom: 1, starterCount: 1 })
    expect(row.freshAt).toBe('2026-10-18T12:00:00.000Z')
  })

  it('a chopped team says when, and is not ranked', async () => {
    const { byLeague } = await getNativeRailMatchups('u4', [G])
    expect(byLeague[G]!.guillotine).toMatchObject({ state: 'eliminated', choppedWeek: 2 })
    expect(byLeague[G]!.eliminated).toBe(true)
  })

  it('in the chop zone when you are the lowest survivor', async () => {
    const { byLeague } = await getNativeRailMatchups('u3', [G])
    expect(byLeague[G]!.guillotine).toMatchObject({ state: 'chop_zone', rank: 3, chopMargin: -12.4 })
  })

  it('before the first chop week', async () => {
    ;(db.seasons[0] as { currentWeek: number }).currentWeek = 1
    const { byLeague } = await getNativeRailMatchups('me', [G])
    expect(byLeague[G]!.guillotine).toMatchObject({ state: 'before_first_chop', firstChopWeek: 2 })
  })

  it('no stat rows yet: points are a dash, not a confident zero', async () => {
    db.stats = []
    db.projections = []
    const { byLeague } = await getNativeRailMatchups('me', [G])
    expect(byLeague[G]!.guillotine).toMatchObject({ state: 'no_scores', points: null, rank: null })
    expect(byLeague[G]!.scored).toBe(false)
  })

  it('pre-draft (no season): the member gets the draft time', async () => {
    db.seasons = []
    ;(db.leagues[0] as Record<string, unknown>).leagueSettings = { draftDateUtc: new Date('2026-10-20T00:00:00Z') }
    const { byLeague } = await getNativeRailMatchups('me', [G])
    expect(byLeague[G]!.guillotine).toMatchObject({ state: 'preseason', draftAt: '2026-10-20T00:00:00.000Z' })
    // A non-member gets nothing.
    expect((await getNativeRailMatchups('stranger', [G])).byLeague[G]).toBeUndefined()
  })

  it('a native head-to-head league reads its RedraftMatchup row', async () => {
    const { byLeague } = await getNativeRailMatchups('me', [H])
    expect(byLeague[H]).toMatchObject({ yourTeam: 'Team x', yourScore: 91.25, opponentTeam: 'Team y', opponentScore: 88.5, unpaired: false, scored: true, week: 6 })
    expect(byLeague[H]!.guillotine).toBeUndefined()
  })

  it('reads set-based: one query per table however many leagues, and nothing for a stranger', async () => {
    await getNativeRailMatchups('me', [G, H])
    const counts = db.calls.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {})
    // `league` twice: the classification read and the guillotine leagues' settings.
    expect(counts).toEqual({ league: 2, redraftSeason: 1, roster: 1, guillotineRosterState: 1, redraftRosterPlayer: 1, playerWeeklyScore: 1, fantasyProjection: 1, redraftMatchup: 1 })
    expect((await getNativeRailMatchups('stranger', [G, H])).byLeague).toEqual({})
  })

  it('getRailMatchups — the loader /core and the league page call — now carries the native rows', async () => {
    const rail = await getRailMatchups('me', [
      { id: G, platformLeagueId: 'native-pid-g', elimination: true },
      { id: H, platformLeagueId: 'native-pid-h' },
    ])
    expect(rail.byLeague[G]?.guillotine).toMatchObject({ state: 'alive', rank: 2, aliveCount: 3 })
    expect(rail.byLeague[H]).toMatchObject({ yourScore: 91.25, opponentTeam: 'Team y' })
  })
})
