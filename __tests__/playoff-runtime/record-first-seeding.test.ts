import { describe, expect, it } from 'vitest'
import {
  buildNflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffRulesInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { getDefaultLeagueSettingsForVariant } from '@/lib/sport-defaults/LeagueDefaultSettingsService'

/** The sport default as it was stored before this fix: points first, no record key at all. */
const LEGACY_DEFAULT_TIEBREAKERS = ['points_for', 'head_to_head', 'points_against']

function rules(overrides: Partial<NflRedraftPlayoffRulesInput['playoffs']> = {}): NflRedraftPlayoffRulesInput {
  return {
    playoffs: {
      teamCount: 2,
      seedingRules: 'standard_standings',
      tiebreakerRules: LEGACY_DEFAULT_TIEBREAKERS,
      standingsTiebreakers: LEGACY_DEFAULT_TIEBREAKERS,
      ...overrides,
    },
    schedule: { regularSeasonLength: 14 },
  }
}

function game(week: number, home: string, away: string, homeScore: number, awayScore: number, status = 'final') {
  return { week, homeRosterId: home, awayRosterId: away, homeScore, awayScore, status }
}

describe('playoff seeding is by record first', () => {
  it('(a) seeds the better record above a higher-scoring team with a worse record', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules(),
      teams: [
        { rosterId: 'scorer', wins: 8, losses: 6, pointsFor: 1800 },
        { rosterId: 'winner', wins: 10, losses: 4, pointsFor: 1500 },
        { rosterId: 'c', wins: 6, losses: 8, pointsFor: 1400 },
        { rosterId: 'd', wins: 4, losses: 10, pointsFor: 1300 },
      ],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['winner', 'scorer'])
    expect(state.settings.tiebreakers[0]).toBe('win_pct')
  })

  it('(a) counts a tie as half a win', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules(),
      teams: [
        { rosterId: 'eight-six', wins: 8, losses: 6, ties: 0, pointsFor: 1900 },
        { rosterId: 'eight-five-one', wins: 8, losses: 5, ties: 1, pointsFor: 1000 },
        { rosterId: 'c', wins: 2, losses: 12, pointsFor: 2000 },
      ],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['eight-five-one', 'eight-six'])
  })

  it('(b) breaks a two-team record tie on head-to-head before points for', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules({ teamCount: 2 }),
      teams: [
        { rosterId: 'more-points', wins: 9, losses: 5, pointsFor: 1800 },
        { rosterId: 'h2h-winner', wins: 9, losses: 5, pointsFor: 1500 },
        { rosterId: 'c', wins: 5, losses: 9, pointsFor: 1400 },
      ],
      regularSeasonMatchups: [
        game(2, 'h2h-winner', 'more-points', 120, 110),
        game(9, 'more-points', 'h2h-winner', 100, 130),
        // Not final, so it does not count even though more-points "won" it.
        game(14, 'more-points', 'h2h-winner', 200, 10, 'scheduled'),
      ],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['h2h-winner', 'more-points'])
    const standings = state.teams.map((row) => row.rosterId)
    expect(standings.indexOf('h2h-winner')).toBeLessThan(standings.indexOf('more-points'))
  })

  it('(b) falls through to points for when head-to-head is split', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules({ teamCount: 2 }),
      teams: [
        { rosterId: 'fewer-points', wins: 9, losses: 5, pointsFor: 1500 },
        { rosterId: 'more-points', wins: 9, losses: 5, pointsFor: 1800 },
      ],
      regularSeasonMatchups: [game(2, 'fewer-points', 'more-points', 120, 110), game(9, 'more-points', 'fewer-points', 130, 100)],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['more-points', 'fewer-points'])
  })

  it('(b) in a three-way tie, a team that beat both others wins it; the rest fall through to points', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules({ teamCount: 3 }),
      teams: [
        { rosterId: 'x', wins: 9, losses: 5, pointsFor: 1700 },
        { rosterId: 'y', wins: 9, losses: 5, pointsFor: 1600 },
        { rosterId: 'sweeper', wins: 9, losses: 5, pointsFor: 1200 },
        { rosterId: 'z', wins: 1, losses: 13, pointsFor: 900 },
      ],
      regularSeasonMatchups: [
        game(1, 'sweeper', 'x', 100, 90),
        game(2, 'sweeper', 'y', 100, 90),
      ],
    })
    // sweeper beat x and y; x and y never met, so neither was swept and they fall through to
    // points for, where x leads.
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['sweeper', 'x', 'y'])
  })

  it('(b) in a three-way tie, a team that lost to both others ranks last of the three', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules({ teamCount: 3 }),
      teams: [
        { rosterId: 'swept', wins: 9, losses: 5, pointsFor: 1900 },
        { rosterId: 'm', wins: 9, losses: 5, pointsFor: 1600 },
        { rosterId: 'n', wins: 9, losses: 5, pointsFor: 1500 },
        { rosterId: 'z', wins: 1, losses: 13, pointsFor: 900 },
      ],
      regularSeasonMatchups: [game(1, 'm', 'swept', 100, 90), game(2, 'n', 'swept', 100, 90)],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['m', 'n', 'swept'])
  })

  it('(b) in a three-way tie with no sweeper, head-to-head is skipped', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15, rules: rules({ teamCount: 3 }),
      teams: [
        { rosterId: 'p', wins: 9, losses: 5, pointsFor: 1700 },
        { rosterId: 'q', wins: 9, losses: 5, pointsFor: 1600 },
        { rosterId: 'r', wins: 9, losses: 5, pointsFor: 1500 },
      ],
      // A rock-paper-scissors cycle: nobody beat both others.
      regularSeasonMatchups: [game(1, 'p', 'q', 100, 90), game(2, 'q', 'r', 100, 90), game(3, 'r', 'p', 100, 90)],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['p', 'q', 'r'])
  })

  it('(c) leaves a points-only league seeded by points, even with record and head-to-head data', () => {
    const state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'l', seasonId: 's', season: 2026, week: 15,
      rules: rules({ seedingRules: 'points_only', standingsTiebreakers: ['win_pct', 'head_to_head', 'points_for'] }),
      teams: [
        { rosterId: 'winner', wins: 14, losses: 0, pointsFor: 1500 },
        { rosterId: 'scorer', wins: 0, losses: 14, pointsFor: 1800 },
        { rosterId: 'c', wins: 7, losses: 7, pointsFor: 1600 },
      ],
      regularSeasonMatchups: [game(1, 'winner', 'scorer', 100, 90)],
    })
    expect(state.seeds.map((row) => row.rosterId)).toEqual(['scorer', 'c'])
    expect(state.settings.tiebreakers).toEqual(['points_for', 'roster_id'])
  })
})

describe('default tiebreaker lists lead with record', () => {
  for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
    it(`${sport} playoff default starts with win_pct then head_to_head then points_for`, () => {
      expect(resolveDefaultPlayoffConfig(sport).tiebreaker_rules?.slice(0, 3)).toEqual(['win_pct', 'head_to_head', 'points_for'])
      expect(getDefaultLeagueSettingsForVariant(sport, null).standings_tiebreakers.slice(0, 3)).toEqual([
        'win_pct',
        'head_to_head',
        'points_for',
      ])
    })
  }
})
