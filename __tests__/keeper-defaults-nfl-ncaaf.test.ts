import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getKeeperDefaultContract,
  getKeeperDraftSettingsForSurface,
  normalizeKeeperSettingsSnapshot,
} from '@/lib/league-concepts/keeperDefaults'
import {
  mergeConceptPresetSettings,
  resolveConceptPreset,
} from '@/lib/league-concepts/resolveConceptPreset'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { mapKeeperCreationFromWizard } from '@/lib/keeper/mapKeeperCreationFromWizard'
import { getRedraftDefaultContract } from '@/lib/league-concepts/redraftDefaults'

const { leagueFindUniqueMock } = vi.hoisted(() => ({
  leagueFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
    },
  },
}))

describe('NFL/NCAAF keeper creation defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defines the NFL keeper default contract', () => {
    const contract = getKeeperDefaultContract({ sport: 'NFL', draftType: 'snake' })

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      sport: 'NFL',
      league_type: 'keeper',
      teams: 12,
      scoring_preset_id: 'fb_half_ppr',
      roster_mode: 'keeper',
    })
    expect(contract?.rosterTemplate.starterSlots).toEqual({
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      K: 1,
      DST: 1,
    })
    expect(contract?.rosterTemplate.benchSlots).toBe(7)
    expect(contract?.rosterTemplate.irSlots).toBe(2)
    expect(contract?.keeperPolicy).toMatchObject({
      enabled: true,
      maxKeepers: 3,
      maxYears: 3,
      costSystem: 'round_based',
      roundPenalty: 1,
      waiverAllowed: true,
      keptPlayersRemovedFromPool: true,
      draftRoundAdjustmentsEnabled: true,
    })
    expect(contract?.playerPoolRules).toMatchObject({
      sport: 'NFL',
      includeCollegePlayers: false,
      includeNflPlayers: true,
      eligiblePoolExcludesKeepers: true,
    })
    expect(contract?.tabsEnabled).toMatchObject({
      overview: true,
      rosters: true,
      draft: true,
      mock_draft: true,
      keeper_declarations: true,
      trade_center: true,
      commissioner_tools: 'commissioner',
    })
  })

  it('defines the NCAAF keeper default contract without NFL pool leakage', () => {
    const contract = getKeeperDefaultContract({ sport: 'NCAAF', draftType: 'snake' })

    expect(contract).not.toBeNull()
    expect(contract?.scoring_preset_id).toBe('ncaaf_half_ppr')
    expect(contract?.rosterTemplate.starterSlots).toEqual({
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      K: 1,
    })
    // No team-defense starter: none exists to draft, and an unfilled slot fails lineup validation.
    expect(contract?.rosterTemplate.starterSlots).not.toHaveProperty('DEF')
    expect(contract?.rosterTemplate.starterSlots).not.toHaveProperty('SUPERFLEX')
    expect(contract?.rosterTemplate.benchSlots).toBe(8)
    expect(contract?.rosterTemplate.irSlots).toBe(2)
    expect(contract?.draftSettings.queueSizeLimit).toBe(70)
    expect(contract?.playerPoolRules).toMatchObject({
      sport: 'NCAAF',
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
      excludeNflPool: true,
    })
  })

  it('allows every supported plain keeper draft id and rejects devy/c2c variants', () => {
    for (const draftType of ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team']) {
      const result = validateCreatePayload({
        concept: 'keeper',
        sport: 'NFL',
        scoringPreset: 'fb_half_ppr',
        teamCount: 12,
        draftType,
        leagueName: `Keeper ${draftType}`,
      })
      expect(result.ok, draftType).toBe(true)
    }

    for (const draftType of ['devy_snake', 'devy_linear', 'devy_auction', 'c2c_snake', 'c2c_linear', 'c2c_auction']) {
      const result = validateCreatePayload({
        concept: 'keeper',
        sport: 'NFL',
        scoringPreset: 'fb_half_ppr',
        teamCount: 12,
        draftType,
        leagueName: `Keeper ${draftType}`,
      })
      expect(result.ok, draftType).toBe(false)
    }
  })

  it('exposes the keeper draft-type set to create options', () => {
    const ids = getDraftTypeOptions('keeper', 'NFL').map((option) => option.id)

    expect(ids).toEqual(
      expect.arrayContaining(['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team']),
    )
  })

  it('resolves keeper snake, linear, auction, slow, mock, offline, auto, and team behavior', () => {
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'snake' })?.draftSettings).toMatchObject({
      engineCore: 'snake',
      pickOrderRules: 'snake',
      timerSeconds: 90,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'linear' })?.draftSettings).toMatchObject({
      engineCore: 'linear',
      sameOrderEveryRound: true,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'auction' })?.keeperPolicy).toMatchObject({
      costSystem: 'auction_value',
      keptPlayerBudgetDeductionsEnabled: true,
      draftRoundAdjustmentsEnabled: false,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'auction' })?.draftSettings).toMatchObject({
      engineCore: 'auction',
      auctionBudgetPerTeam: 200,
      nominationOrderEnabled: true,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'slow_draft' })?.draftSettings).toMatchObject({
      engineCore: 'snake',
      pickWindowHours: 8,
      overnightPauseEnabled: true,
      remindersEnabled: true,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'mock_draft' })?.draftSettings).toMatchObject({
      mockDraftEnabled: true,
      usesKeeperSettings: true,
      doesNotMutateRealRosters: true,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'offline' })?.draftSettings).toMatchObject({
      offlineModeEnabled: true,
      commissionerPickEntryEnabled: true,
      timerDisabled: true,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'auto' })?.draftSettings).toMatchObject({
      autoDraftEnabled: true,
      eligiblePoolExcludesKeepers: true,
      rosterNeedsAccountForKeepers: true,
    })
    expect(getKeeperDefaultContract({ sport: 'NFL', draftType: 'team' })?.draftSettings).toMatchObject({
      teamDraftModeEnabled: true,
      coManagerControlsEnabled: true,
      keeperDeclarationPermissionsClear: true,
    })
  })

  it('pushes NCAAF keeper settings through preset engine and foundation defaults', () => {
    const engine = runPresetEngine({
      concept: 'keeper',
      sport: 'NCAAF',
      teamCount: 12,
      draftType: 'mock_draft',
      scoringPreset: 'ncaaf_half_ppr',
      leagueName: 'Campus Keepers',
      commissionerId: 'user-1',
    })

    expect(engine.settingsSnapshot).toMatchObject({
      sport_type: 'NCAAF',
      league_type: 'keeper',
      roster_mode: 'keeper',
      draft_type: 'snake',
      requested_draft_type: 'mock_draft',
      keeper_enabled: true,
      keeper_max_keepers: 3,
      taxi_slots: 0,
      devy: false,
      c2c: false,
    })
    expect(engine.settingsSnapshot.playerPoolRules).toMatchObject({
      sport: 'NCAAF',
      includeNflPlayers: false,
      collegeOnly: true,
      keptPlayersRemovedFromPool: true,
    })

    const defaults = getLeagueDefaults({
      sport: 'NCAAF',
      format: 'keeper',
      draftType: 'mock_draft',
      managerCount: 12,
      scoringPreset: 'ncaaf_half_ppr',
    })

    expect(defaults.engineDraftType).toBe('snake')
    expect(defaults.draftSettings).toMatchObject({
      requestedDraftType: 'mock_draft',
      rounds: 16,
      timerSeconds: 90,
      queueSizeLimit: 70,
      mockDraftEnabled: true,
    })
    expect(defaults.keeperPolicy).toMatchObject({
      maxKeepers: 3,
      keptPlayersRemovedFromPool: true,
    })
    expect(defaults.playerPoolRules).toMatchObject({
      sport: 'NCAAF',
      includeNflPlayers: false,
      collegeOnly: true,
    })
  })

  it('normalizes invalid keeper leakage while preserving valid commissioner overrides', () => {
    const resolved = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'keeper',
      scoringPreset: 'fb_half_ppr',
      draftType: 'linear',
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const merged = mergeConceptPresetSettings(resolved.settingsSnapshot, {
      leagueName: 'Keeper Override',
      draft_type: 'linear',
      draft_timer_seconds: 120,
      draft_queue_size_limit: 55,
      keeper_max_keepers: 5,
      keeper_max_years: 4,
      keeper_round_penalty: 2,
      keeper_waiver_allowed: false,
      taxi_slots: 4,
      taxi: true,
      devy: true,
      c2cConfig: { enabled: true, collegeRounds: [1, 2] },
      salary_cap: true,
    })

    expect(merged).toMatchObject({
      leagueName: 'Keeper Override',
      draft_type: 'linear',
      requested_draft_type: 'linear',
      draft_timer_seconds: 120,
      draft_queue_size_limit: 55,
      keeper_max_keepers: 5,
      keeper_max_years: 4,
      keeper_round_penalty: 2,
      keeper_waiver_allowed: false,
      roster_mode: 'keeper',
      taxi_slots: 0,
      taxi: false,
      devy: false,
      salary_cap: false,
    })
    expect(merged.c2cConfig).toMatchObject({ enabled: false })
  })

  it('clamps invalid keeper settings and maps them into DraftSession keeperConfig', () => {
    const settings = normalizeKeeperSettingsSnapshot({
      sport: 'NFL',
      draftType: 'auction',
      scoringPresetId: 'fb_half_ppr',
      settings: {
        keeper_max_keepers: 99,
        keeper_max_years: -5,
        keeper_round_penalty: 99,
        keeper_auction_pct_increase: 'bad-value',
      },
    })

    expect(settings).toMatchObject({
      keeper_max_keepers: 32,
      keeper_max_years: 0,
      keeper_round_penalty: 10,
      keeper_cost_system: 'auction_value',
      keeper_auction_pct_increase: 0.2,
      kept_player_budget_deductions_enabled: true,
      draft_round_adjustments_enabled: false,
    })

    const mapped = mapKeeperCreationFromWizard({
      draftType: 'auction',
      settings,
    })

    expect(mapped.league).toMatchObject({
      keeperCount: 32,
      keeperCostSystem: 'auction_value',
      keeperMaxYears: 0,
      keeperRoundPenalty: 10,
      keeperAuctionPctIncrease: 0.2,
    })
    expect(mapped.draftKeeperConfig).toMatchObject({
      maxKeepers: 32,
      costSystem: 'auction_value',
      keptPlayerBudgetDeductionsEnabled: true,
      keptPlayersRemovedFromPool: true,
      rosterNeedsAccountForKeepers: true,
    })
  })

  it('uses keeper settings for mock/live surfaces and draft room resolution', async () => {
    const contract = getKeeperDefaultContract({ sport: 'NCAAF', draftType: 'mock_draft' })
    expect(contract).not.toBeNull()
    if (!contract) return

    expect(getKeeperDraftSettingsForSurface(contract, 'mock')).toEqual(
      getKeeperDraftSettingsForSurface(contract, 'live'),
    )

    const settings = normalizeKeeperSettingsSnapshot({
      sport: 'NCAAF',
      draftType: 'mock_draft',
      scoringPresetId: 'ncaaf_half_ppr',
      settings: {},
    })
    leagueFindUniqueMock.mockResolvedValueOnce({
      sport: 'NCAAF',
      leagueVariant: null,
      settings,
    })

    const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')
    const config = await getDraftConfigForLeague('league-ncaaf-keeper')

    expect(config).toMatchObject({
      sport: 'NCAAF',
      draft_type: 'snake',
      rounds: 16,
      timer_seconds: 90,
      queue_size_limit: 70,
      autopick_behavior: 'queue-first',
      position_filter_behavior: 'by_eligibility',
    })
  })

  it('does not regress the redraft defaults contract from commit 595959f64', () => {
    const redraft = getRedraftDefaultContract({ sport: 'NCAAF', draftType: 'mock_draft' })

    expect(redraft).not.toBeNull()
    expect(redraft?.league_type).toBe('redraft')
    expect(redraft?.rosterTemplate.benchSlots).toBe(8)
    expect(redraft?.rosterTemplate.irSlots).toBe(1)
    expect(redraft?.draftSettings.queueSizeLimit).toBe(70)
    expect(redraft?.playerPoolRules).toMatchObject({
      includeNflPlayers: false,
      collegeOnly: true,
      rookieOnly: false,
    })
  })
})
