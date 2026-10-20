import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn() }))

import { buildNflRedraftPlayoffRuntimeState } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { resolveNflRedraftPlayoffRuntime, rulesWithPlayoffTeamOverride } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'

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

const rules = (customTiebreakers: string[] | null) => ({
  general: { sport: 'NFL', format: 'redraft' },
  playoffs: { teamCount: 2, seedingRules: 'standard_standings', standingsTiebreakers: ['points_for', 'head_to_head'], customTiebreakers },
  schedule: { regularSeasonLength: 14 },
})

const games = async () => [
  { week: 3, type: 'regular', homeRosterId: 'h2h-winner', awayRosterId: 'more-points', homeScore: 120, awayScore: 100, status: 'final' },
]

describe('the resolver carries the commissioner\'s order', () => {
  it('from the league rules into the seeds', async () => {
    const custom = await resolveNflRedraftPlayoffRuntime({ preloadedSeason: season as never }, { loadRules: async () => rules(['points_for', 'head_to_head']) as never, loadRegularSeasonMatchups: games })
    const legacy = await resolveNflRedraftPlayoffRuntime({ preloadedSeason: season as never }, { loadRules: async () => rules(null) as never, loadRegularSeasonMatchups: games })
    if (!custom.ok || !legacy.ok) throw new Error('resolve failed')
    expect(custom.state.seeds.map((s) => s.rosterId)).toEqual(['more-points', 'h2h-winner'])
    expect(legacy.state.seeds.map((s) => s.rosterId)).toEqual(['h2h-winner', 'more-points'])
  })

  it('through a playoff-team-count override, which rebuilds the rules from the resolved state', async () => {
    const resolved = await resolveNflRedraftPlayoffRuntime({ preloadedSeason: season as never }, { loadRules: async () => rules(['points_for', 'head_to_head']) as never, loadRegularSeasonMatchups: games })
    if (!resolved.ok) throw new Error('resolve failed')
    const rebuilt = buildNflRedraftPlayoffRuntimeState({
      leagueId: resolved.state.leagueId, seasonId: resolved.state.seasonId, season: resolved.state.season, week: resolved.state.week,
      rules: rulesWithPlayoffTeamOverride(resolved.state, 2),
      teams: resolved.state.teams,
      regularSeasonMatchups: resolved.regularSeasonMatchups,
    })
    expect(rebuilt.seeds.map((s) => s.rosterId)).toEqual(['more-points', 'h2h-winner'])
    expect(rebuilt.settings.tiebreakers).toEqual(['win_pct', 'points_for', 'head_to_head', 'roster_id'])
  })
})
