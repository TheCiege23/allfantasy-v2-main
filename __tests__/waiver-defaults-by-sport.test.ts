import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  leagueFindUniqueMock,
  leagueWaiverSettingsFindUniqueMock,
  leagueWaiverSettingsCreateMock,
  leagueWaiverSettingsUpdateMock,
} = vi.hoisted(() => ({
  leagueFindUniqueMock: vi.fn(),
  leagueWaiverSettingsFindUniqueMock: vi.fn(),
  leagueWaiverSettingsCreateMock: vi.fn(),
  leagueWaiverSettingsUpdateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
    },
    leagueWaiverSettings: {
      findUnique: leagueWaiverSettingsFindUniqueMock,
      create: leagueWaiverSettingsCreateMock,
      update: leagueWaiverSettingsUpdateMock,
    },
  },
}))

describe('Prompt 18 waiver defaults by sport and variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fills only missing waiver keys during bootstrap', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-1',
      sport: 'SOCCER',
      leagueVariant: 'STANDARD',
    })
    leagueWaiverSettingsFindUniqueMock.mockResolvedValueOnce({
      leagueId: 'league-1',
      waiverType: 'faab',
      processingDayOfWeek: null,
      processingTimeUtc: null,
      claimLimitPerPeriod: null,
      faabBudget: null,
      tiebreakRule: null,
      lockType: null,
      instantFaAfterClear: null,
    })
    leagueWaiverSettingsUpdateMock.mockResolvedValueOnce({ leagueId: 'league-1' })

    const { bootstrapLeagueWaiverSettings } = await import('@/lib/waiver-defaults/LeagueWaiverBootstrapService')
    const result = await bootstrapLeagueWaiverSettings('league-1')

    expect(result.waiverSettingsApplied).toBe(true)
    expect(leagueWaiverSettingsUpdateMock).toHaveBeenCalledTimes(1)

    const patch = leagueWaiverSettingsUpdateMock.mock.calls[0]?.[0]?.data
    expect(patch.waiverType).toBeUndefined()
    expect(patch.processingDayOfWeek).toBeNull()
    expect(patch.processingTimeUtc).toBeNull()
    expect(patch.faabBudget).toBeNull()
    expect(patch.tiebreakRule).toBe('earliest_claim')
    expect(patch.lockType).toBe('slate_lock')
    expect(patch.instantFaAfterClear).toBe(true)
  })

  it('is idempotent when all waiver bootstrap keys already exist', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-2',
      sport: 'NFL',
      leagueVariant: 'IDP',
    })
    leagueWaiverSettingsFindUniqueMock.mockResolvedValueOnce({
      leagueId: 'league-2',
      waiverType: 'faab',
      processingDayOfWeek: 3,
      processingTimeUtc: '10:00',
      claimLimitPerPeriod: 5,
      faabBudget: 200,
      tiebreakRule: 'faab_highest',
      lockType: 'game_time',
      instantFaAfterClear: false,
    })

    const { bootstrapLeagueWaiverSettings } = await import('@/lib/waiver-defaults/LeagueWaiverBootstrapService')
    const result = await bootstrapLeagueWaiverSettings('league-2')

    expect(result.waiverSettingsApplied).toBe(false)
    expect(leagueWaiverSettingsUpdateMock).not.toHaveBeenCalled()
    expect(leagueWaiverSettingsCreateMock).not.toHaveBeenCalled()
  })

  it('uses per-key fallback in waiver processing resolver for partial settings', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      sport: 'NFL',
      leagueVariant: 'SUPERFLEX',
    })
    leagueWaiverSettingsFindUniqueMock.mockResolvedValueOnce({
      waiverType: 'rolling',
      processingDayOfWeek: null,
      processingTimeUtc: null,
      claimLimitPerPeriod: 6,
      tiebreakRule: null,
      lockType: null,
      instantFaAfterClear: null,
      faabBudget: null,
    })

    const { getWaiverProcessingConfigForLeague } = await import('@/lib/waiver-defaults/WaiverProcessingConfigResolver')
    const config = await getWaiverProcessingConfigForLeague('league-3')

    expect(config).not.toBeNull()
    expect(config?.sport).toBe('NFL')
    expect(config?.variant).toBe('SUPERFLEX')
    expect(config?.waiver_type).toBe('rolling')
    expect(config?.processing_days).toEqual([2])
    expect(config?.claim_limit_per_period).toBe(6)
    // Unset keys fall back to the SUPERFLEX defaults, which are the redraft FAAB $100 row since
    // 2026-10-25; the stored waiver type still wins, so FAAB stays off for this rolling league.
    expect(config?.claim_priority_behavior).toBe('faab_highest')
    expect(config?.game_lock_behavior).toBe('game_time')
    expect(config?.free_agent_unlock_behavior).toBe('after_waiver_run')
    expect(config?.faab_enabled).toBe(false)
    expect(config?.faab_budget).toBe(100)
  })

  it('resolves FAAB config with per-key fallback for missing budget', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      sport: 'NFL',
      leagueVariant: 'IDP',
    })
    leagueWaiverSettingsFindUniqueMock.mockResolvedValueOnce({
      waiverType: 'faab',
      faabBudget: null,
      faabResetDate: null,
    })

    const { getFAABConfigForLeague } = await import('@/lib/waiver-defaults/FAABConfigResolver')
    const config = await getFAABConfigForLeague('league-4')

    expect(config).not.toBeNull()
    expect(config?.faab_enabled).toBe(true)
    expect(config?.faab_budget).toBe(100)
    expect(config?.faab_reset_rules).toBe('never')
  })
})
