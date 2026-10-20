import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn() }))

import { resolveNflRedraftPlayoffRuntime } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'

const roster = (id: string, wins: number, losses: number, pointsFor: number) => ({
  id, ownerId: `o-${id}`, ownerName: id, teamName: id, wins, losses, ties: 0,
  pointsFor, pointsAgainst: 0, playoffSeed: null, isEliminated: false,
})

const season = {
  id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, status: 'active',
  currentWeek: 15, playoffStartWeek: 15, totalWeeks: 17,
  rosters: [roster('more-points', 9, 5, 1800), roster('h2h-winner', 9, 5, 1500), roster('c', 5, 9, 1400), roster('d', 4, 10, 1300)],
  playoffRounds: [], playoffBracket: null,
}

const rulesWith = (seedingRules: string) => ({
  general: { sport: 'NFL', format: 'redraft' },
  playoffs: { teamCount: 2, seedingRules, standingsTiebreakers: ['points_for', 'head_to_head', 'points_against'] },
  schedule: { regularSeasonLength: 14 },
})

const h2hGames = async () => [
  { week: 3, type: 'regular', homeRosterId: 'h2h-winner', awayRosterId: 'more-points', homeScore: 120, awayScore: 100, status: 'final' },
]

describe('playoff resolver feeds regular-season results to the head-to-head tiebreaker', () => {
  it('seeds the head-to-head winner first between equal records', async () => {
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: season as never },
      { loadRules: async () => rulesWith('standard_standings') as never, loadRegularSeasonMatchups: h2hGames },
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.seeds.map((row) => row.rosterId)).toEqual(['h2h-winner', 'more-points'])
    expect(resolved.regularSeasonMatchups).toHaveLength(1)
  })

  it('degrades to no head-to-head (points decide) when the results cannot be read', async () => {
    // Default loader against a prisma mock with no redraftMatchup delegate: it throws inside and
    // must return [] rather than failing the resolve.
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: season as never },
      { loadRules: async () => rulesWith('standard_standings') as never },
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.seeds.map((row) => row.rosterId)).toEqual(['more-points', 'h2h-winner'])
  })

  it('keeps a points-only league on points', async () => {
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: { ...season, rosters: [roster('winner', 14, 0, 1000), ...season.rosters] } as never },
      { loadRules: async () => rulesWith('points_only') as never, loadRegularSeasonMatchups: h2hGames },
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.seeds.map((row) => row.rosterId)).toEqual(['more-points', 'h2h-winner'])
    expect(resolved.state.settings.pointsOnlySeeding).toBe(true)
  })
})
