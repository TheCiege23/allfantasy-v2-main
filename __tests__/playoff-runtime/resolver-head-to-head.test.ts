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

/*
 * Points for decides before head-to-head (owner, 2026-10-20), so the head-to-head cases use two teams
 * level on record AND points. The winner of their meeting sorts LAST alphabetically, so the name
 * fallback cannot produce the head-to-head answer by luck.
 */
const levelSeason = { ...season, rosters: [roster('more-points', 9, 5, 1500), roster('h2h-winner', 9, 5, 1500), roster('c', 5, 9, 1400), roster('d', 4, 10, 1300)] }
const moreWinsMeeting = async () => [
  { week: 3, type: 'regular', homeRosterId: 'more-points', awayRosterId: 'h2h-winner', homeScore: 120, awayScore: 100, status: 'final' },
]

describe('playoff resolver feeds regular-season results to the head-to-head tiebreaker', () => {
  it('seeds the head-to-head winner first between equal records and points', async () => {
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: levelSeason as never },
      { loadRules: async () => rulesWith('standard_standings') as never, loadRegularSeasonMatchups: moreWinsMeeting },
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.seeds.map((row) => row.rosterId)).toEqual(['more-points', 'h2h-winner'])
    expect(resolved.regularSeasonMatchups).toHaveLength(1)
  })

  it('degrades to no head-to-head when the results cannot be read', async () => {
    // Default loader against a prisma mock with no redraftMatchup delegate: it throws inside and
    // must return [] rather than failing the resolve. Level on points too, so with no head-to-head
    // the name order decides — the opposite of the result above.
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: levelSeason as never },
      { loadRules: async () => rulesWith('standard_standings') as never },
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.seeds.map((row) => row.rosterId)).toEqual(['h2h-winner', 'more-points'])
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
