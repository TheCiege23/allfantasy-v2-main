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

describe('Prompt 20 schedule defaults by sport and variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fills only missing schedule keys during bootstrap', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-1',
      sport: 'MLB',
      leagueVariant: 'STANDARD',
      settings: {
        schedule_cadence: 'weekly',
        schedule_lock_window_behavior: 'manual_override',
        schedule_scoring_period_behavior: null,
        schedule_reschedule_handling: null,
      },
    })
    leagueUpdateMock.mockResolvedValueOnce({ id: 'league-1' })

    const { bootstrapLeagueScheduleConfig } = await import('@/lib/schedule-defaults/LeagueScheduleBootstrapService')
    const result = await bootstrapLeagueScheduleConfig('league-1')

    expect(result.scheduleConfigApplied).toBe(true)
    expect(leagueUpdateMock).toHaveBeenCalledTimes(1)

    const nextSettings = leagueUpdateMock.mock.calls[0]?.[0]?.data?.settings
    expect(nextSettings.schedule_cadence).toBe('weekly')
    expect(nextSettings.schedule_lock_window_behavior).toBe('manual_override')
    expect(nextSettings.schedule_scoring_period_behavior).toBe('slate_based')
    expect(nextSettings.schedule_reschedule_handling).toBe('use_final_time')
    expect(nextSettings.schedule_doubleheader_handling).toBe('all_games_count')
    expect(nextSettings.schedule_generation_strategy).toBe('round_robin')
  })

  it('is idempotent when all schedule keys already exist', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-2',
      sport: 'NFL',
      leagueVariant: 'STANDARD',
      settings: {
        schedule_unit: 'week',
        matchup_frequency: 'weekly',
        regular_season_length: 18,
        schedule_cadence: 'weekly',
        schedule_head_to_head_behavior: 'head_to_head',
        schedule_lock_window_behavior: 'first_game_of_week',
        schedule_scoring_period_behavior: 'full_period',
        schedule_reschedule_handling: 'use_final_time',
        schedule_doubleheader_handling: 'all_games_count',
        schedule_playoff_transition_point: 15,
        schedule_generation_strategy: 'round_robin',
      },
    })

    const { bootstrapLeagueScheduleConfig } = await import('@/lib/schedule-defaults/LeagueScheduleBootstrapService')
    const result = await bootstrapLeagueScheduleConfig('league-2')

    expect(result.scheduleConfigApplied).toBe(false)
    expect(leagueUpdateMock).not.toHaveBeenCalled()
  })

  it('resolves matchup cadence context with per-key fallback and no sport leakage', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      sport: 'SOCCER',
      leagueVariant: 'STANDARD',
      settings: {
        schedule_unit: 'week',
        matchup_frequency: null,
        schedule_cadence: null,
        regular_season_length: null,
        schedule_generation_strategy: null,
      },
    })

    const { getMatchupCadenceForLeague } = await import('@/lib/schedule-defaults/MatchupCadenceResolver')
    const config = await getMatchupCadenceForLeague('league-3')

    expect(config).not.toBeNull()
    expect(config?.sport).toBe('SOCCER')
    expect(config?.matchup_cadence).toBe('weekly')
    expect(config?.regular_season_length).toBe(24)
    expect(config?.schedule_generation_strategy).toBe('round_robin')
  })

  it('resolves scoring windows and generation context with per-key fallback', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      sport: 'NCAAB',
      leagueVariant: 'STANDARD',
      settings: {
        lock_time_behavior: null,
        schedule_lock_window_behavior: null,
        schedule_scoring_period_behavior: null,
        schedule_reschedule_handling: null,
        schedule_doubleheader_handling: null,
        schedule_playoff_transition_point: null,
        schedule_generation_strategy: null,
      },
    })

    const { getScoringWindowConfigForLeague } = await import('@/lib/schedule-defaults/ScoringWindowResolver')
    const { getLeagueScheduleGenerationContext } = await import('@/lib/schedule-defaults/LeagueScheduleGenerationService')
    const { getScheduleConfigForLeague } = await import('@/lib/schedule-defaults/ScheduleConfigResolver')

    const scoring = await getScoringWindowConfigForLeague('league-4')
    const generation = await getLeagueScheduleGenerationContext('league-4')
    const schedule = await getScheduleConfigForLeague('league-4')

    expect(scoring?.lock_window_behavior).toBe('first_game_of_slate')
    expect(scoring?.scoring_period_behavior).toBe('full_period')
    expect(generation?.playoff_transition_point).toBe(16)
    expect(generation?.schedule_generation_strategy).toBe('round_robin')
    expect(schedule?.head_to_head_behavior).toBe('head_to_head')
    expect(schedule?.schedule_cadence).toBe('weekly')
  })
})
