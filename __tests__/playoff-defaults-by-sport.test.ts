import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUniqueMock, leagueUpdateMock } = vi.hoisted(() => ({
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
  },
}))

describe('Prompt 19 playoff defaults by sport and variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fills missing playoff keys during bootstrap while preserving existing overrides', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-1',
      sport: 'NFL',
      leagueVariant: 'IDP',
      settings: {
        playoff_team_count: 8,
        standings_tiebreakers: ['head_to_head'],
        playoff_structure: {
          bracket_type: 'single_elimination',
          playoff_weeks: 4,
          first_round_byes: null,
          total_rounds: null,
          seeding_rules: null,
          tiebreaker_rules: null,
        },
      },
    })
    leagueUpdateMock.mockResolvedValueOnce({ id: 'league-1' })

    const { bootstrapLeaguePlayoffConfig } = await import('@/lib/playoff-defaults/LeaguePlayoffBootstrapService')
    const result = await bootstrapLeaguePlayoffConfig('league-1')

    expect(result.playoffConfigApplied).toBe(true)
    expect(leagueUpdateMock).toHaveBeenCalledTimes(1)

    const nextSettings = leagueUpdateMock.mock.calls[0]?.[0]?.data?.settings
    expect(nextSettings.playoff_team_count).toBe(8)
    expect(nextSettings.standings_tiebreakers).toEqual(['head_to_head'])
    expect(nextSettings.playoff_structure.bracket_type).toBe('single_elimination')
    expect(nextSettings.playoff_structure.first_round_byes).toBe(2)
    expect(nextSettings.playoff_structure.total_rounds).toBe(3)
    expect(nextSettings.playoff_structure.seeding_rules).toBe('standard_standings')
    expect(nextSettings.playoff_structure.tiebreaker_rules).toEqual(
      expect.arrayContaining(['points_for', 'head_to_head'])
    )
  })

  it('is idempotent when playoff keys are already fully configured', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-2',
      sport: 'NBA',
      leagueVariant: 'STANDARD',
      settings: {
        playoff_team_count: 6,
        standings_tiebreakers: ['points_for', 'head_to_head'],
        playoff_structure: {
          playoff_team_count: 6,
          playoff_weeks: 3,
          first_round_byes: 2,
          bracket_type: 'single_elimination',
          consolation_plays_for: 'pick',
          playoff_start_week: 22,
          seeding_rules: 'standard_standings',
          tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
          bye_rules: 'top_two_seeds_bye',
          matchup_length: 1,
          total_rounds: 3,
          consolation_bracket_enabled: true,
          third_place_game_enabled: true,
          toilet_bowl_enabled: false,
          championship_length: 1,
          reseed_behavior: 'fixed_bracket',
        },
      },
    })

    const { bootstrapLeaguePlayoffConfig } = await import('@/lib/playoff-defaults/LeaguePlayoffBootstrapService')
    const result = await bootstrapLeaguePlayoffConfig('league-2')

    expect(result.playoffConfigApplied).toBe(false)
    expect(leagueUpdateMock).not.toHaveBeenCalled()
  })

  it('uses per-key fallback for seeding and standings tiebreakers', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      sport: 'SOCCER',
      leagueVariant: 'STANDARD',
      settings: {
        playoff_structure: {
          seeding_rules: 'division_winners_first',
          bye_rules: null,
        },
      },
    })

    const { getSeedingRulesForLeague } = await import('@/lib/playoff-defaults/PlayoffSeedingResolver')
    const { getStandingsTiebreakersForLeague } = await import('@/lib/playoff-defaults/StandingsTiebreakerResolver')

    const seeding = await getSeedingRulesForLeague('league-3')
    const tiebreakers = await getStandingsTiebreakersForLeague('league-3')

    expect(seeding).not.toBeNull()
    expect(seeding?.seeding_rules).toBe('division_winners_first')
    expect(seeding?.bye_rules).toBe('top_two_seeds_bye')
    expect(Array.isArray(seeding?.tiebreaker_rules)).toBe(true)

    expect(tiebreakers).not.toBeNull()
    expect(Array.isArray(tiebreakers?.tiebreakers)).toBe(true)
    expect(tiebreakers?.tiebreakers.length).toBeGreaterThan(0)
  })

  it('resolves bracket config including playoff_start_point alias and postseason toggles', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      sport: 'NCAAF',
      leagueVariant: 'STANDARD',
      settings: {
        playoff_team_count: 6,
        playoff_structure: {
          playoff_weeks: 3,
          playoff_start_week: 13,
          first_round_byes: 2,
          consolation_bracket_enabled: true,
          third_place_game_enabled: true,
          toilet_bowl_enabled: false,
        },
      },
    })

    const { getBracketConfigForLeague } = await import('@/lib/playoff-defaults/PlayoffBracketConfigResolver')
    const config = await getBracketConfigForLeague('league-4')

    expect(config).not.toBeNull()
    expect(config?.playoff_start_week).toBe(13)
    expect(config?.playoff_start_point).toBe(13)
    expect(config?.first_round_byes).toBe(2)
    expect(config?.consolation_bracket_enabled).toBe(true)
    expect(config?.third_place_game_enabled).toBe(true)
    expect(config?.toilet_bowl_enabled).toBe(false)
  })
})
