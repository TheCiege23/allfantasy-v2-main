import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  getCanonicalRedraftRosterSlotOrder,
  getRedraftDefaultContract,
  getRedraftDraftSettingsForSurface,
  normalizeRedraftSettingsSnapshot,
  resolveRedraftScoringPreset,
} from '@/lib/league-concepts/redraftDefaults'
import {
  mergeConceptPresetSettings,
  resolveConceptPreset,
} from '@/lib/league-concepts/resolveConceptPreset'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import {
  listScoringPresetOptions,
  resolveScoringPresetId,
} from '@/lib/league-creation-preset/scoring-presets'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'

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

const LOCKED_FOOTBALL_REDRAFT_STARTERS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLX: 1,
  K: 1,
  DEF: 1,
}

const LOCKED_FOOTBALL_REDRAFT_COMPACT_ORDER = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DEF', 'BN']

/**
 * NCAAF has no team-defense starter: no college team defense exists to draft (the pool holds none),
 * and an unfilled starter slot fails lineup validation, so a default DEF made every lineup save fail.
 */
const { DEF: _ncaafHasNoDefense, ...LOCKED_NCAAF_REDRAFT_STARTERS } = LOCKED_FOOTBALL_REDRAFT_STARTERS
const LOCKED_NCAAF_REDRAFT_COMPACT_ORDER = LOCKED_FOOTBALL_REDRAFT_COMPACT_ORDER.filter((slot) => slot !== 'DEF')
const NCAAF_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K']

describe('NFL/NCAAF redraft creation defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defines the NFL redraft default contract', () => {
    const contract = getRedraftDefaultContract({ sport: 'NFL', draftType: 'snake' })

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      sport: 'NFL',
      league_type: 'redraft',
      teams: 12,
      scoring_preset_id: 'fb_half_ppr',
      roster_mode: 'redraft',
    })
    expect(contract?.rosterTemplate.starterSlots).toEqual(LOCKED_FOOTBALL_REDRAFT_STARTERS)
    expect(contract?.rosterTemplate.compactRosterSlotOrder).toEqual(LOCKED_FOOTBALL_REDRAFT_COMPACT_ORDER)
    expect(contract?.rosterTemplate.positionAliases).toMatchObject({
      DEF: ['DST', 'D/ST', 'DEFENSE'],
      FLX: ['FLEX'],
      K: ['PK', 'KICKER'],
    })
    expect(contract?.rosterTemplate.draftablePlayerPositions).toEqual(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
    expect(contract?.rosterTemplate.benchSlots).toBe(6)
    expect(contract?.rosterTemplate.irSlots).toBe(1)
    expect(contract?.rosterTemplate.draftableRosterSlots).toBe(15)
    expect(contract?.draftSettings.rounds).toBe(15)
    expect(contract?.draftSettings.fallbackRounds).toBe(15)
    expect(contract?.draftSettings.queueSizeLimit).toBe(50)
    expect(contract?.scoringSettings).toMatchObject({
      kickerEnabled: true,
      defenseEnabled: true,
    })
    expect(contract?.playerPoolRules).toMatchObject({
      sport: 'NFL',
      includeCollegePlayers: false,
      includeNflPlayers: true,
      rookieOnly: false,
      positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
    })
    expect(contract?.tabsEnabled).toMatchObject({
      overview: true,
      roster: true,
      draft: true,
      mock_draft: true,
      live_draft: true,
      settings: 'commissioner',
    })
    expect(contract?.tabsEnabled).not.toHaveProperty('keeper_declarations')
  })

  it('defines the NCAAF redraft default contract without superflex or pro-pool leakage', () => {
    const contract = getRedraftDefaultContract({ sport: 'NCAAF', draftType: 'snake' })

    expect(contract).not.toBeNull()
    expect(contract?.scoring_preset_id).toBe('ncaaf_half_ppr')
    expect(contract?.rosterTemplate.starterSlots).toEqual(LOCKED_NCAAF_REDRAFT_STARTERS)
    expect(contract?.rosterTemplate.compactRosterSlotOrder).toEqual(LOCKED_NCAAF_REDRAFT_COMPACT_ORDER)
    expect(contract?.rosterTemplate.starterSlots).not.toHaveProperty('SF')
    expect(contract?.rosterTemplate.benchSlots).toBe(8)
    expect(contract?.rosterTemplate.irSlots).toBe(1)
    expect(contract?.rosterTemplate.draftableRosterSlots).toBe(16)
    expect(contract?.draftSettings.rounds).toBe(16)
    expect(contract?.draftSettings.rounds).toBe(contract?.rosterTemplate.draftableRosterSlots)
    expect(contract?.draftSettings.fallbackRounds).toBe(16)
    expect(contract?.draftSettings.queueSizeLimit).toBe(70)
    expect(contract?.scoringSettings).toMatchObject({
      kickerEnabled: true,
      defenseEnabled: true,
    })
    expect(contract?.playerPoolRules).toMatchObject({
      sport: 'NCAAF',
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
      rookieOnly: false,
      positions: NCAAF_POSITIONS,
    })
    expect(contract?.tabsEnabled).not.toHaveProperty('keeper_declarations')
  })

  it('uses NCAAF scoring presets as first-class scoring options', () => {
    const ctx = { leagueType: 'redraft' as const, sport: 'NCAAF' as const, idpSelected: false }

    expect(resolveScoringPresetId('', ctx)).toBe('ncaaf_half_ppr')
    expect(resolveScoringPresetId('ncaaf_ppr', ctx)).toBe('ncaaf_ppr')
    expect(listScoringPresetOptions(ctx).map((option) => option.id)).toEqual(
      expect.arrayContaining(['ncaaf_standard', 'ncaaf_half_ppr', 'ncaaf_ppr']),
    )
  })

  it('orders default, superflex, and IDP slots in the canonical redraft order', () => {
    expect(getCanonicalRedraftRosterSlotOrder()).toEqual(LOCKED_FOOTBALL_REDRAFT_COMPACT_ORDER)
    expect(getCanonicalRedraftRosterSlotOrder({ defenseEnabled: false })).toEqual(LOCKED_NCAAF_REDRAFT_COMPACT_ORDER)

    expect(getCanonicalRedraftRosterSlotOrder({ flexEnabled: true })).toEqual(LOCKED_FOOTBALL_REDRAFT_COMPACT_ORDER)

    expect(getCanonicalRedraftRosterSlotOrder({ superflexEnabled: true })).toEqual([
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLX',
      'K',
      'SF',
      'DEF',
      'BN',
    ])

    expect(
      getCanonicalRedraftRosterSlotOrder({
        superflexEnabled: true,
        idpEnabled: true,
        explicitIdpPositions: true,
      }),
    ).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'SF', 'DEF', 'DL', 'LB', 'DB', 'IDP', 'BN'])
  })

  it('resolves standard, half PPR, full PPR, and legacy aliases', () => {
    expect(resolveRedraftScoringPreset({ sport: 'NFL', presetId: 'standard' })).toMatchObject({
      presetId: 'fb_standard',
      ppr: 0,
    })
    expect(resolveRedraftScoringPreset({ sport: 'NFL', presetId: 'fb_ppr' })).toMatchObject({
      presetId: 'fb_full_ppr',
      ppr: 1,
    })
    expect(resolveRedraftScoringPreset({ sport: 'NCAAF', presetId: 'half_ppr_college' })).toMatchObject({
      presetId: 'ncaaf_half_ppr',
      ppr: 0.5,
    })
  })

  it('allows only pickable redraft draft ids through canonical validation', () => {
    for (const draftType of ['snake', 'linear', 'auction', 'mock_draft', 'offline', 'auto']) {
      const result = validateCreatePayload({
        concept: 'redraft',
        sport: 'NFL',
        scoringPreset: 'fb_half_ppr',
        teamCount: 12,
        draftType,
        leagueName: `Redraft ${draftType}`,
      })
      expect(result.ok, draftType).toBe(true)
    }

    const slowDraftResult = validateCreatePayload({
      concept: 'redraft',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr',
      teamCount: 12,
      draftType: 'slow_draft',
      leagueName: 'Slow Draft Should Be Clock Based',
    })

    expect(slowDraftResult.ok).toBe(false)
  })

  it('exposes the locked redraft draft-type set to create options', () => {
    const ids = getDraftTypeOptions('redraft', 'NFL').map((option) => option.id)

    expect(ids).toEqual(expect.arrayContaining(['snake', 'linear', 'auction', 'mock_draft', 'offline', 'auto']))
    expect(ids).not.toContain('slow_draft')
  })

  it('pushes the same NCAAF redraft settings through preset engine and foundation defaults', () => {
    const engine = runPresetEngine({
      concept: 'redraft',
      sport: 'NCAAF',
      teamCount: 12,
      draftType: 'snake',
      scoringPreset: 'ncaaf_half_ppr',
      leagueName: 'Campus Redraft',
      commissionerId: 'user-1',
    })

    expect(engine.settingsSnapshot).toMatchObject({
      sport_type: 'NCAAF',
      league_type: 'redraft',
      draft_type: 'snake',
      requested_draft_type: 'snake',
      draft_queue_size_limit: 70,
      draft_rounds: 16,
      roster_mode: 'redraft',
      taxi_slots: 0,
      devy: false,
      c2c: false,
    })
    expect(engine.settingsSnapshot.rosterSettings).toMatchObject({
      starterSlots: LOCKED_NCAAF_REDRAFT_STARTERS,
      benchSlots: 8,
      irSlots: 1,
      rosterSize: 16,
      draftablePlayerPositions: NCAAF_POSITIONS,
    })
    expect(engine.settingsSnapshot.rosterSettings).not.toMatchObject({
      starterSlots: expect.objectContaining({ SUPERFLEX: expect.any(Number) }),
    })
    expect(engine.settingsSnapshot.tabsEnabled).not.toHaveProperty('keeper_declarations')

    const defaults = getLeagueDefaults({
      sport: 'NCAAF',
      format: 'redraft',
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
    })
    expect(defaults.playerPoolRules).toMatchObject({
      sport: 'NCAAF',
      includeNflPlayers: false,
      collegeOnly: true,
      positions: NCAAF_POSITIONS,
    })
  })

  it('normalizes invalid redraft leakage while preserving valid draft overrides', () => {
    const resolved = resolveConceptPreset({
      sport: 'NCAAF',
      leagueType: 'redraft',
      scoringPreset: 'ncaaf_half_ppr',
      draftType: 'linear',
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const merged = mergeConceptPresetSettings(resolved.settingsSnapshot, {
      leagueName: 'Campus Override',
      draft_type: 'linear',
      draft_timer_seconds: 120,
      draft_queue_size_limit: 65,
      taxi_slots: 4,
      taxi: true,
      devy: true,
      c2cConfig: { enabled: true, collegeRounds: [1, 2] },
      salary_cap: true,
    })

    expect(merged).toMatchObject({
      leagueName: 'Campus Override',
      draft_type: 'linear',
      requested_draft_type: 'linear',
      draft_timer_seconds: 120,
      draft_queue_size_limit: 65,
      roster_mode: 'redraft',
      taxi_slots: 0,
      taxi: false,
      devy: false,
      salary_cap: false,
    })
    expect(merged.c2cConfig).toMatchObject({ enabled: false })
  })

  it('uses the same resolved draft config for mock and live surfaces', async () => {
    const contract = getRedraftDefaultContract({ sport: 'NCAAF', draftType: 'mock_draft' })
    expect(contract).not.toBeNull()
    if (!contract) return

    expect(getRedraftDraftSettingsForSurface(contract, 'mock')).toEqual(
      getRedraftDraftSettingsForSurface(contract, 'live'),
    )

    const settings = normalizeRedraftSettingsSnapshot({
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
    const config = await getDraftConfigForLeague('league-ncaaf')

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
})