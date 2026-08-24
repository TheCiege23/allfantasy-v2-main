import { describe, expect, it } from 'vitest'
import {
  DEVY_CREATE_DRAFT_TYPE_IDS,
  buildDevySettingsSnapshot,
  getDevyDefaultContract,
  isFootballDevyDefaultsSport,
  normalizeDevySettingsSnapshot,
} from '@/lib/league-concepts/devyDefaults'
import { CONCEPT_PRESET_CATALOG } from '@/lib/league-concepts/conceptPresetCatalog'
import {
  mergeConceptPresetSettings,
  resolveConceptPreset,
} from '@/lib/league-concepts/resolveConceptPreset'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { mapDraftTypeToSportRulesBase } from '@/lib/draft-types/draftTypeRegistry'
import { getDraftDefaults, getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'

describe('NFL/NCAAF devy creation defaults', () => {
  it('scopes the canonical devy contract to football launch sports', () => {
    expect(isFootballDevyDefaultsSport('NFL')).toBe(true)
    expect(isFootballDevyDefaultsSport('NCAAF')).toBe(true)
    expect(isFootballDevyDefaultsSport('NBA')).toBe(false)
    expect(isFootballDevyDefaultsSport('NCAAB')).toBe(false)
  })

  it('defines the NFL devy default contract with separate pro, rookie, and devy pools', () => {
    const contract = getDevyDefaultContract({ sport: 'NFL', draftType: 'devy_snake' })

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      sport: 'NFL',
      league_type: 'devy',
      teams: 12,
      roster_mode: 'dynasty',
      scoring_preset_id: 'fb_half_ppr',
    })
    expect(contract?.rosterTemplate).toMatchObject({
      benchSlots: 12,
      irSlots: 3,
      taxiSlots: 6,
      devySlots: 6,
      startupDraftRounds: 21,
    })
    expect(contract?.rosterTemplate.starterSlots).toEqual({
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 2,
      SUPER_FLEX: 1,
    })
    expect(contract?.draftSettings).toMatchObject({
      engineCore: 'snake',
      rounds: 21,
      timerSeconds: 90,
      queueSizeLimit: 80,
    })
    expect(contract?.devySettings).toMatchObject({
      collegeSports: ['NCAAF'],
      devySlotCount: 6,
      taxiSize: 6,
      rookieDraftRounds: 4,
      devyDraftRounds: 4,
      rookiePickOrderMethod: 'reverse_standings',
      devyPickOrderMethod: 'reverse_standings',
    })
    expect(contract?.proPlayerPoolRules).toMatchObject({
      sport: 'NFL',
      poolKey: 'nfl_active_fantasy_players',
      includeNflPlayers: true,
      includeCollegePlayers: false,
    })
    expect(contract?.devyPlayerPoolRules).toMatchObject({
      sport: 'NCAAF',
      source: 'devy_player',
      includeNflPlayers: false,
      collegeOnly: true,
      devyEligibleOnly: true,
      excludeGraduatedToNFL: true,
    })
    expect(contract?.rookiePlayerPoolRules).toMatchObject({
      sport: 'NFL',
      rookieOnly: true,
      excludeDevyHeldPromotedPlayers: true,
    })
  })

  it('defines NCAAF devy as college dynasty with future college assets and no NFL pool leakage', () => {
    const contract = getDevyDefaultContract({ sport: 'NCAAF', draftType: 'devy_snake' })

    expect(contract).not.toBeNull()
    expect(contract?.scoring_preset_id).toBe('ncaaf_half_ppr')
    expect(contract?.rosterTemplate).toMatchObject({
      benchSlots: 12,
      irSlots: 2,
      taxiSlots: 6,
      devySlots: 6,
      startupDraftRounds: 21,
      defensePosition: 'DEF',
    })
    expect(contract?.proPlayerPoolRules).toMatchObject({
      sport: 'NCAAF',
      poolKey: 'ncaaf_active_college_fantasy_players',
      includeNflPlayers: false,
      includeCollegePlayers: true,
      collegeOnly: true,
      excludeNflPool: true,
    })
    expect(contract?.devyPlayerPoolRules).toMatchObject({
      parentFantasySport: 'NCAAF',
      poolKey: 'ncaaf_future_college_prospects',
      source: 'devy_player',
      includeNflPlayers: false,
      collegeOnly: true,
    })
    expect(contract?.playerPoolRules).toMatchObject({
      ncaafDevyMeaning: 'college_dynasty_with_future_college_assets',
      usesNflProPool: false,
      activeCollegePoolSeparated: true,
    })
  })

  it('supports every devy create draft type with explicit engine behavior', () => {
    expect([...DEVY_CREATE_DRAFT_TYPE_IDS]).toEqual(
      expect.arrayContaining(['devy_snake', 'devy_linear', 'devy_auction', 'snake', 'linear', 'auction', 'mock_draft', 'offline', 'auto']),
    )
    expect(getDevyDefaultContract({ sport: 'NFL', draftType: 'devy_snake' })?.draftSettings).toMatchObject({
      engineCore: 'snake',
      pickOrderRules: 'snake',
    })
    expect(getDevyDefaultContract({ sport: 'NFL', draftType: 'linear' })?.draftSettings).toMatchObject({
      requestedDraftType: 'devy_linear',
      engineCore: 'linear',
      sameOrderEveryRound: true,
    })
    expect(getDevyDefaultContract({ sport: 'NFL', draftType: 'auction' })?.draftSettings).toMatchObject({
      requestedDraftType: 'devy_auction',
      engineCore: 'auction',
      auctionBudgetPerTeam: 200,
      nominationOrderEnabled: true,
    })
    expect(getDevyDefaultContract({ sport: 'NFL', draftType: 'mock_draft' })?.draftSettings).toMatchObject({
      mockDraftEnabled: true,
      doesNotMutateRealRosters: true,
    })
    expect(getDevyDefaultContract({ sport: 'NFL', draftType: 'offline' })?.draftSettings).toMatchObject({
      offlineModeEnabled: true,
      commissionerPickEntryEnabled: true,
      timerDisabled: true,
    })
    expect(getDevyDefaultContract({ sport: 'NFL', draftType: 'auto' })?.draftSettings).toMatchObject({
      autoDraftEnabled: true,
      eligiblePoolExcludesHeldDevy: true,
    })
  })

  it('validates devy create draft ids without allowing arbitrary draft strings', () => {
    const base = {
      concept: 'devy',
      sport: 'NFL' as const,
      scoringPreset: 'fb_half_ppr',
      teamCount: 12,
      leagueName: 'Devy Draft Types',
    }

    // Option B: devy creation is closed. Valid draft ids must clear the
    // draft-type checks and be stopped only by the college-formats gate;
    // invalid ids must still fail on draftType itself.
    for (const draftType of ['snake', 'linear', 'auction', 'devy_snake', 'devy_linear', 'devy_auction', 'mock_draft', 'offline', 'auto']) {
      const r = validateCreatePayload({ ...base, draftType })
      expect(r.ok, draftType).toBe(false)
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === 'COLLEGE_FORMATS_NOT_OPEN'), draftType).toBe(true)
        expect(r.errors.some((e) => e.path === 'draftType'), draftType).toBe(false)
      }
    }

    for (const draftType of ['slow_draft', 'team', 'rookie_draft', 'best_ball', 'devy_unknown']) {
      const r = validateCreatePayload({ ...base, draftType })
      expect(r.ok, draftType).toBe(false)
      if (!r.ok) {
        expect(r.errors.some((e) => e.path === 'draftType'), draftType).toBe(true)
      }
    }

    expect(
      validateCreatePayload({
        ...base,
        concept: 'dynasty',
        draftType: 'devy_snake',
      }).ok,
    ).toBe(false)
  })

  it('normalizes devy snapshots and blocks C2C/keeper/best-ball leakage', () => {
    const snapshot = normalizeDevySettingsSnapshot({
      sport: 'NFL',
      draftType: 'auction',
      settings: {
        league_type: 'dynasty',
        c2c: true,
        keeper_enabled: true,
        best_ball: true,
        salary_cap: true,
        taxi_slots: 0,
        devy_slots: 0,
      },
    })

    expect(snapshot).toMatchObject({
      league_type: 'devy',
      roster_mode: 'dynasty',
      isDynasty: true,
      isDevy: true,
      devy: true,
      c2c: false,
      keeper_enabled: false,
      best_ball: false,
      salary_cap: false,
      taxi_slots: 6,
      devy_slots: 6,
      requested_draft_type: 'devy_auction',
    })
    expect(snapshot.devyConfig).toMatchObject({
      enabled: true,
      devySlotCount: 6,
      collegeSports: ['NCAAF'],
    })
  })

  it('resolves and merges launch-ready devy concept presets', () => {
    const resolved = resolveConceptPreset({
      sport: 'NCAAF',
      leagueType: 'devy',
      scoringPreset: 'ncaaf_half_ppr',
      draftType: 'linear',
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.preset).toMatchObject({
      sport: 'NCAAF',
      leagueType: 'devy',
      readiness: 'launch_ready',
      visibility: 'public',
    })
    expect(resolved.settingsSnapshot).toMatchObject({
      sport_type: 'NCAAF',
      league_type: 'devy',
      requested_draft_type: 'devy_linear',
      devy: true,
      c2c: false,
    })

    const merged = mergeConceptPresetSettings(resolved.settingsSnapshot, {
      leagueName: 'Campus Devy',
      c2c: true,
      keeper_enabled: true,
      best_ball: true,
    })
    expect(merged).toMatchObject({
      leagueName: 'Campus Devy',
      league_type: 'devy',
      devy: true,
      c2c: false,
      keeper_enabled: false,
      best_ball: false,
    })
  })

  it('pushes devy settings through preset engine and foundation defaults', () => {
    const engine = runPresetEngine({
      concept: 'devy',
      sport: 'NCAAF',
      teamCount: 12,
      draftType: 'linear',
      scoringPreset: 'ncaaf_half_ppr',
      leagueName: 'Campus Devy',
      commissionerId: 'user-1',
    })

    expect(engine.settingsSnapshot).toMatchObject({
      sport_type: 'NCAAF',
      league_type: 'devy',
      roster_mode: 'dynasty',
      requested_draft_type: 'devy_linear',
      devy: true,
      c2c: false,
    })
    expect(engine.settingsSnapshot.playerPoolRules).toMatchObject({
      usesNflProPool: false,
      activeCollegePoolSeparated: true,
    })

    const defaults = getLeagueDefaults({
      sport: 'NCAAF',
      format: 'devy',
      draftType: 'linear',
      managerCount: 12,
      scoringPreset: 'ncaaf_half_ppr',
    })

    expect(defaults.engineDraftType).toBe('linear')
    expect(defaults.devyContract).not.toBeNull()
    expect(defaults.draftSettings).toMatchObject({
      requestedDraftType: 'devy_linear',
      rounds: 21,
      timerSeconds: 90,
      queueSizeLimit: 80,
    })
    expect(defaults.devyConfig).toMatchObject({
      enabled: true,
      devySlotCount: 6,
      taxiSize: 6,
      collegeSports: ['NCAAF'],
    })
    expect(defaults.playerPoolRules).toMatchObject({
      usesNflProPool: false,
      activeCollegePoolSeparated: true,
    })
  })

  it('registers launch-ready NFL/NCAAF devy presets and UI draft options', () => {
    const nfl = CONCEPT_PRESET_CATALOG.find(
      (preset) => preset.sport === 'NFL' && preset.leagueType === 'devy' && preset.scoringPreset === 'fb_half_ppr',
    )
    const ncaaf = CONCEPT_PRESET_CATALOG.find(
      (preset) => preset.sport === 'NCAAF' && preset.leagueType === 'devy' && preset.scoringPreset === 'ncaaf_half_ppr',
    )

    expect(nfl).toMatchObject({
      isLaunchReady: true,
      visibility: 'public',
      taxiSlots: 6,
      collegeRosterSlots: 6,
    })
    expect(ncaaf).toMatchObject({
      isLaunchReady: true,
      visibility: 'public',
      taxiSlots: 6,
      collegeRosterSlots: 6,
    })
    for (const draftType of ['devy_snake', 'devy_linear', 'devy_auction', 'offline', 'auto', 'mock_draft']) {
      expect(nfl?.draftTypesAllowed, draftType).toContain(draftType)
      expect(ncaaf?.draftTypesAllowed, draftType).toContain(draftType)
    }

    const options = getDraftTypeOptions('devy', 'NFL').map((option) => option.id)
    expect(options).toEqual(expect.arrayContaining(['devy_snake', 'devy_linear', 'devy_auction', 'offline', 'auto']))
  })

  it('registers NCAAF devy sport defaults and linear mapping', () => {
    const roster = getRosterDefaults('NCAAF', 'devy_dynasty')
    const draft = getDraftDefaults('NCAAF', 'devy_dynasty')
    const snapshot = buildDevySettingsSnapshot({ sport: 'NCAAF', draftType: 'devy_snake' })

    expect(roster).toMatchObject({
      sport_type: 'NCAAF',
      bench_slots: 12,
      IR_slots: 2,
      taxi_slots: 6,
      devy_slots: 6,
    })
    expect(draft).toMatchObject({
      queue_size_limit: 80,
      pre_draft_ranking_source: 'adp_projection_rank_fallback',
      position_filter_behavior: 'by_eligibility',
    })
    expect(draft.rounds_default).toBeGreaterThan(21)
    expect(mapDraftTypeToSportRulesBase('devy_linear')).toBe('linear')
    expect(snapshot?.devyPlayerPoolRules).toMatchObject({
      source: 'devy_player',
      excludeGraduatedToNFL: true,
    })
  })
})
