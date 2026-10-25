// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The rail row of an odd-team native league's leftover team: its week is a bye row, so the row was
 * "unpaired". With the extra matchup it is a pairing against the chosen team, with both scores and
 * the line; the chosen team keeps its own game and carries the line too.
 */

const extra = vi.hoisted(() => ({ view: vi.fn() }))
vi.mock('@/lib/redraft/oddTeamExtraMatchup', () => ({ readExtraMatchupViewForSeason: extra.view }))

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

import { getNativeRailMatchups } from '@/lib/core-app/nativeRailMatchups'

const H = 'league-h'
const roster = (id: string, ownerId: string) => ({ id, ownerId, ownerName: ownerId, teamName: `Team ${id}`, avatarUrl: null, isEliminated: false })
const VIEW = {
  role: 'leftover', otherRosterId: 'y', teamName: 'Team y', reason: 'top_scorer', countsForYou: true,
  yourScore: 120.25, theirScore: 101.5, final: false,
  label: "Extra matchup vs Team y (last week's top scorer)",
  line: "Extra matchup vs Team y (last week's top scorer) · 120.3–101.5",
}

beforeEach(() => {
  extra.view.mockReset()
  db.calls = []
  db.leagues = [{ id: H, sport: 'NFL', platform: 'allfantasy', leagueVariant: null, leagueType: 'redraft', guillotineMode: false, bestBallMode: false, guillotineConfig: null, leagueSettings: null }]
  db.seasons = [{ id: 'sh', leagueId: H, season: 2026, status: 'active', currentWeek: 6, sport: 'NFL', rosters: [roster('x', 'me'), roster('y', 'u9'), roster('z', 'u8')] }]
  db.links = []; db.chops = []; db.settings = [{ id: H, settings: {} }]; db.players = []; db.stats = []; db.projections = []
  db.h2h = [{ seasonId: 'sh', leagueId: H, week: 6, homeRosterId: 'x', awayRosterId: null, homeScore: 120.25, awayScore: 0, status: 'active' }]
})

describe('the rail row of an extra matchup', () => {
  it('the leftover team is paired with the chosen team, both scores and the line', async () => {
    extra.view.mockResolvedValue(VIEW)
    const { byLeague } = await getNativeRailMatchups('me', [H])
    expect(extra.view).toHaveBeenCalledWith({ seasonId: 'sh', week: 6, redraftRosterId: 'x' })
    expect(byLeague[H]).toMatchObject({ unpaired: false, opponentTeam: 'Team y', yourScore: 120.25, opponentScore: 101.5, scored: true })
    expect(byLeague[H]!.extraMatchup).toEqual({ label: VIEW.label, line: VIEW.line, yourScore: 120.25, theirScore: 101.5 })
  })

  it('the chosen team keeps its own game and carries the line', async () => {
    db.h2h = [{ seasonId: 'sh', leagueId: H, week: 6, homeRosterId: 'x', awayRosterId: 'z', homeScore: 101.5, awayScore: 90, status: 'active' }]
    extra.view.mockResolvedValue({ ...VIEW, role: 'opponent', teamName: 'Team y', line: 'Extra matchup: Team y plays you this week' })
    const { byLeague } = await getNativeRailMatchups('me', [H])
    expect(byLeague[H]).toMatchObject({ opponentTeam: 'Team z', yourScore: 101.5, opponentScore: 90 })
    expect(byLeague[H]!.extraMatchup?.line).toBe('Extra matchup: Team y plays you this week')
  })

  it('a bye with no pick stays a bye; an even league is never read', async () => {
    extra.view.mockResolvedValue(null)
    expect((await getNativeRailMatchups('me', [H])).byLeague[H]).toMatchObject({ unpaired: true })
    db.seasons = [{ ...(db.seasons[0] as object), rosters: [roster('x', 'me'), roster('y', 'u9')] }]
    extra.view.mockClear()
    await getNativeRailMatchups('me', [H])
    expect(extra.view).not.toHaveBeenCalled()
  })
})
