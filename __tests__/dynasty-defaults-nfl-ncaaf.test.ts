/**
 * Dynasty league creation defaults — NFL and NCAAF audit tests.
 *
 * Coverage:
 *  - getDynastyDefaultContract shape (teams, bench, IR, taxi, scoring, draft)
 *  - NCAAF dynasty player pool guardrail (no NFL leakage)
 *  - keeper_dynasty_carryover_supported = true for both sports
 *  - Startup draft rounds = starters + bench + taxi
 *  - Rookie draft: 4 rounds, linear
 *  - Future picks enabled
 *  - dynasty_adp ranking source
 *  - All supported dynasty draft types
 *  - No devy/C2C leakage into plain dynasty
 *  - normalizeDynastySettingsSnapshot invariant enforcement
 *  - CONCEPT_PRESET_CATALOG has NFL and NCAAF dynasty entries
 *  - resolveConceptPreset returns canonical dynasty snapshot
 *  - mergeConceptPresetSettings enforces dynasty invariants
 *  - SportDefaultsRegistry: NCAAF.keeper_dynasty_carryover_supported = true
 */
import { describe, expect, it } from 'vitest'
import {
  getDynastyDefaultContract,
  buildDynastySettingsSnapshot,
  normalizeDynastySettingsSnapshot,
  isDynastyEligibleSport,
  DYNASTY_DRAFT_TYPE_IDS,
} from '@/lib/league-concepts/dynastyDefaults'
import { CONCEPT_PRESET_CATALOG } from '@/lib/league-concepts/conceptPresetCatalog'
import {
  resolveConceptPreset,
  mergeConceptPresetSettings,
} from '@/lib/league-concepts/resolveConceptPreset'
import { getDraftDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'

// ── isDynastyEligibleSport ────────────────────────────────────────────────────

describe('isDynastyEligibleSport', () => {
  it('returns true for NFL and NCAAF', () => {
    expect(isDynastyEligibleSport('NFL')).toBe(true)
    expect(isDynastyEligibleSport('NCAAF')).toBe(true)
  })

  it('returns false for non-football sports', () => {
    expect(isDynastyEligibleSport('NBA')).toBe(false)
    expect(isDynastyEligibleSport('MLB')).toBe(false)
    expect(isDynastyEligibleSport('SOCCER')).toBe(false)
  })
})

// ── NFL Dynasty default contract ──────────────────────────────────────────────

describe('NFL dynasty default contract', () => {
  const contract = getDynastyDefaultContract({ sport: 'NFL', draftType: 'snake' })

  it('returns a contract (not null)', () => {
    expect(contract).not.toBeNull()
  })

  it('has correct league_type and teams', () => {
    expect(contract?.league_type).toBe('dynasty')
    expect(contract?.leagueType).toBe('dynasty')
    expect(contract?.teams).toBe(12)
    expect(contract?.roster_mode).toBe('dynasty')
  })

  it('has correct roster: 9 starters, bench 12, IR 3, taxi 4', () => {
    expect(contract?.rosterTemplate.benchSlots).toBe(12)
    expect(contract?.rosterTemplate.irSlots).toBe(3)
    expect(contract?.rosterTemplate.taxiSlots).toBe(4)
    expect(contract?.rosterTemplate.rosterSlots).toBe(9) // starters count
  })

  it('startup draft rounds = starters(9) + bench(12) + taxi(4) = 25', () => {
    expect(contract?.rosterTemplate.startupDraftRounds).toBe(25)
    expect(contract?.rounds).toBe(25)
  })

  it('uses dynasty ADP ranking source', () => {
    expect(contract?.draftSettings.preDraftRankingSource).toBe('dynasty_adp')
  })

  it('has rookie draft: 4 rounds, linear', () => {
    expect(contract?.draftSettings.rookieDraft.rounds).toBe(4)
    expect(contract?.draftSettings.rookieDraft.pickOrder).toBe('linear')
    expect(contract?.draftSettings.rookieDraft.enabled).toBe(true)
  })

  it('has future picks enabled', () => {
    expect(contract?.draftSettings.futurePicks.enabled).toBe(true)
    expect(contract?.draftSettings.futurePicks.yearsOut).toBeGreaterThan(0)
  })

  it('has keeper_dynasty_carryover_supported = true', () => {
    expect(contract?.draftSettings.keeperDynastyCarryoverSupported).toBe(true)
  })

  it('uses NFL-only player pool (no college)', () => {
    expect(contract?.playerPoolRules).toMatchObject({
      sport: 'NFL',
      includeNflPlayers: true,
      includeCollegePlayers: false,
      collegeOnly: false,
    })
  })

  it('uses half-PPR as default scoring', () => {
    expect(contract?.scoring_preset_id).toBe('fb_half_ppr')
    expect(contract?.scoringSettings.dynasty).toBe(true)
  })

  it('has NFL starter slots with DST (not DEF)', () => {
    expect(contract?.rosterTemplate.starterSlots).toHaveProperty('DST')
    expect(contract?.rosterTemplate.starterSlots).not.toHaveProperty('DEF')
    expect(contract?.rosterTemplate.defensePosition).toBe('DST')
  })
})

// ── NCAAF Dynasty default contract ───────────────────────────────────────────

describe('NCAAF dynasty default contract', () => {
  const contract = getDynastyDefaultContract({ sport: 'NCAAF', draftType: 'snake' })

  it('returns a contract (not null)', () => {
    expect(contract).not.toBeNull()
  })

  it('has correct roster: bench 12, IR 2, taxi 4', () => {
    expect(contract?.rosterTemplate.benchSlots).toBe(12)
    expect(contract?.rosterTemplate.irSlots).toBe(2)
    expect(contract?.rosterTemplate.taxiSlots).toBe(4)
  })

  it('startup draft rounds = 8 + 12 + 4 = 24 (no team-defense starter)', () => {
    expect(contract?.rosterTemplate.startupDraftRounds).toBe(24)
  })

  it('uses NCAAF-only player pool (no NFL)', () => {
    expect(contract?.playerPoolRules).toMatchObject({
      sport: 'NCAAF',
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
    })
  })

  it('does not leak NFL player pool keys into NCAAF pool rules', () => {
    const pool = contract?.playerPoolRules as Record<string, unknown>
    expect(pool.includeNflPlayers).toBe(false)
    expect(pool.collegeOnly).toBe(true)
  })

  it('has no team-defense starter — no college team defense exists to draft', () => {
    expect(contract?.rosterTemplate.starterSlots).not.toHaveProperty('DEF')
    expect(contract?.rosterTemplate.starterSlots).not.toHaveProperty('DST')
    expect(contract?.rosterTemplate.defensePosition).toBe('DEF')
  })

  it('uses NCAAF default scoring preset', () => {
    expect(contract?.scoring_preset_id).toBe('ncaaf_half_ppr')
  })

  it('has keeper_dynasty_carryover_supported = true', () => {
    expect(contract?.draftSettings.keeperDynastyCarryoverSupported).toBe(true)
  })

  it('uses dynasty ADP ranking source', () => {
    expect(contract?.draftSettings.preDraftRankingSource).toBe('dynasty_adp')
  })
})

// ── Dynasty draft types ───────────────────────────────────────────────────────

describe('DYNASTY_DRAFT_TYPE_IDS coverage', () => {
  it('includes all create-time dynasty draft types', () => {
    const ids = [...DYNASTY_DRAFT_TYPE_IDS]
    expect(ids).toContain('snake')
    expect(ids).toContain('linear')
    expect(ids).toContain('auction')
    expect(ids).toContain('slow_draft')
    expect(ids).toContain('mock_draft')
    expect(ids).toContain('offline')
    expect(ids).toContain('auto')
    expect(ids).toContain('team')
  })

  it('includes post-create lifecycle draft types', () => {
    const ids = [...DYNASTY_DRAFT_TYPE_IDS]
    expect(ids).toContain('rookie_draft')
    expect(ids).toContain('supplemental_draft')
    expect(ids).toContain('dispersal_draft')
  })

  it('getDynastyDefaultContract accepts all create-time draft types', () => {
    for (const draftType of ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team']) {
      const contract = getDynastyDefaultContract({ sport: 'NFL', draftType })
      expect(contract, `draftType=${draftType}`).not.toBeNull()
    }
  })
})

// ── buildDynastySettingsSnapshot ──────────────────────────────────────────────

describe('buildDynastySettingsSnapshot', () => {
  it('returns a snapshot with dynasty markers', () => {
    const snapshot = buildDynastySettingsSnapshot({ sport: 'NFL', draftType: 'snake' })
    expect(snapshot).not.toBeNull()
    expect(snapshot?.league_type).toBe('dynasty')
    expect(snapshot?.isDynasty).toBe(true)
    expect(snapshot?.isRedraft).toBe(false)
  })

  it('enforces taxi enabled and future picks enabled', () => {
    const snapshot = buildDynastySettingsSnapshot({ sport: 'NFL', draftType: 'snake' })
    expect(snapshot?.taxi).toBe(true)
    expect(snapshot?.taxi_enabled).toBe(true)
    expect(snapshot?.future_picks).toBe(true)
    expect(snapshot?.future_picks_enabled).toBe(true)
  })

  it('disables devy and C2C in plain dynasty snapshot', () => {
    const snapshot = buildDynastySettingsSnapshot({ sport: 'NFL', draftType: 'snake' })
    expect(snapshot?.devy).toBe(false)
    expect(snapshot?.devy_enabled).toBe(false)
    expect(snapshot?.c2c).toBe(false)
    expect(snapshot?.c2c_enabled).toBe(false)
    expect((snapshot?.devyConfig as Record<string, unknown>)?.enabled).toBe(false)
    expect((snapshot?.c2cConfig as Record<string, unknown>)?.enabled).toBe(false)
  })

  it('returns null for non-dynasty eligible sport', () => {
    expect(buildDynastySettingsSnapshot({ sport: 'NBA' })).toBeNull()
    expect(buildDynastySettingsSnapshot({ sport: 'MLB' })).toBeNull()
  })
})

// ── normalizeDynastySettingsSnapshot invariants ───────────────────────────────

describe('normalizeDynastySettingsSnapshot — invariant enforcement', () => {
  it('enforces dynasty league_type even if user tries to override', () => {
    const result = normalizeDynastySettingsSnapshot({
      sport: 'NFL',
      settings: { league_type: 'redraft', leagueType: 'redraft' },
    })
    expect(result.league_type).toBe('dynasty')
    expect(result.leagueType).toBe('dynasty')
  })

  it('enforces taxi even if user sets taxi_slots: 0', () => {
    const result = normalizeDynastySettingsSnapshot({
      sport: 'NFL',
      settings: { taxi_slots: 0, taxi: false },
    })
    expect(result.taxi).toBe(true)
    expect(result.taxi_enabled).toBe(true)
  })

  it('blocks devy/C2C injection into dynasty settings', () => {
    const result = normalizeDynastySettingsSnapshot({
      sport: 'NFL',
      settings: { devy: true, devy_enabled: true, c2c: true, c2c_enabled: true },
    })
    expect(result.devy).toBe(false)
    expect(result.devy_enabled).toBe(false)
    expect(result.c2c).toBe(false)
    expect(result.c2c_enabled).toBe(false)
  })

  it('preserves user-supplied league name, language, and timezone', () => {
    const result = normalizeDynastySettingsSnapshot({
      sport: 'NFL',
      settings: {
        leagueName: 'Dynasty Champions',
        language: 'es',
        timezone: 'America/Chicago',
      },
    })
    expect(result.leagueName).toBe('Dynasty Champions')
    expect(result.language).toBe('es')
    expect(result.timezone).toBe('America/Chicago')
  })
})

// ── Concept preset catalog ────────────────────────────────────────────────────

describe('CONCEPT_PRESET_CATALOG — dynasty entries', () => {
  const nflDynasty = CONCEPT_PRESET_CATALOG.find(
    (p) => p.sport === 'NFL' && p.leagueType === 'dynasty',
  )
  const ncaafDynasty = CONCEPT_PRESET_CATALOG.find(
    (p) => p.sport === 'NCAAF' && p.leagueType === 'dynasty',
  )

  it('has an NFL dynasty preset', () => {
    expect(nflDynasty).toBeDefined()
  })

  it('has an NCAAF dynasty preset', () => {
    expect(ncaafDynasty).toBeDefined()
  })

  it('NFL dynasty: bench 12, IR 3, taxi 4', () => {
    expect(nflDynasty?.benchSlots).toBe(12)
    expect(nflDynasty?.irSlots).toBe(3)
    expect(nflDynasty?.taxiSlots).toBe(4)
  })

  it('NCAAF dynasty: bench 12, IR 2, taxi 4', () => {
    expect(ncaafDynasty?.benchSlots).toBe(12)
    expect(ncaafDynasty?.irSlots).toBe(2)
    expect(ncaafDynasty?.taxiSlots).toBe(4)
  })

  it('NFL dynasty supports all create-time draft types', () => {
    for (const dt of ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team']) {
      expect(nflDynasty?.draftTypesAllowed, `nfl dynasty draftType=${dt}`).toContain(dt)
    }
  })

  it('NCAAF dynasty supports all create-time draft types', () => {
    for (const dt of ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team']) {
      expect(ncaafDynasty?.draftTypesAllowed, `ncaaf dynasty draftType=${dt}`).toContain(dt)
    }
  })

  it('NFL dynasty is launch_ready and public', () => {
    expect(nflDynasty?.readiness).toBe('launch_ready')
    expect(nflDynasty?.visibility).toBe('public')
    expect(nflDynasty?.isLaunchReady).toBe(true)
  })

  it('NCAAF dynasty is launch_ready and public', () => {
    expect(ncaafDynasty?.readiness).toBe('launch_ready')
    expect(ncaafDynasty?.visibility).toBe('public')
    expect(ncaafDynasty?.isLaunchReady).toBe(true)
  })
})

// ── resolveConceptPreset ──────────────────────────────────────────────────────

describe('resolveConceptPreset — dynasty format', () => {
  it('resolves NFL dynasty and returns dynasty snapshot', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'dynasty',
      scoringPreset: 'fb_half_ppr',
      draftType: 'snake',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settingsSnapshot.league_type).toBe('dynasty')
    expect(result.settingsSnapshot.isDynasty).toBe(true)
  })

  it('resolves NCAAF dynasty and returns dynasty snapshot', () => {
    const result = resolveConceptPreset({
      sport: 'NCAAF',
      leagueType: 'dynasty',
      scoringPreset: 'ncaaf_half_ppr',
      draftType: 'snake',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settingsSnapshot.league_type).toBe('dynasty')
    expect(result.settingsSnapshot.isDynasty).toBe(true)
  })

  it('NFL dynasty snapshot does not include NFL-pool-leaking in NCAAF path', () => {
    const nfl = resolveConceptPreset({ sport: 'NFL', leagueType: 'dynasty', scoringPreset: 'fb_half_ppr', draftType: 'snake' })
    const ncaaf = resolveConceptPreset({ sport: 'NCAAF', leagueType: 'dynasty', scoringPreset: 'ncaaf_half_ppr', draftType: 'snake' })
    if (!nfl.ok || !ncaaf.ok) return
    const nflPool = nfl.settingsSnapshot.playerPoolRules as Record<string, unknown>
    const ncaafPool = ncaaf.settingsSnapshot.playerPoolRules as Record<string, unknown>
    expect(nflPool.includeNflPlayers).toBe(true)
    expect(ncaafPool.includeNflPlayers).toBe(false)
    expect(ncaafPool.collegeOnly).toBe(true)
  })
})

// ── mergeConceptPresetSettings dynasty guardrails ─────────────────────────────

describe('mergeConceptPresetSettings — dynasty invariants enforced', () => {
  it('blocks devy/C2C injection when merging user settings into dynasty preset', () => {
    const resolved = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'dynasty',
      scoringPreset: 'fb_half_ppr',
      draftType: 'snake',
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const merged = mergeConceptPresetSettings(resolved.settingsSnapshot, {
      leagueName: 'Dynasty Override Test',
      devy: true,
      devy_enabled: true,
      c2c: true,
      c2c_enabled: true,
      devyConfig: { enabled: true, devyRounds: [1, 2] },
      salary_cap: true,
    })

    expect(merged.devy).toBe(false)
    expect(merged.devy_enabled).toBe(false)
    expect(merged.c2c).toBe(false)
    expect(merged.c2c_enabled).toBe(false)
    expect((merged.devyConfig as Record<string, unknown>)?.enabled).toBe(false)
    expect(merged.leagueName).toBe('Dynasty Override Test')
  })
})

// ── SportDefaultsRegistry ─────────────────────────────────────────────────────

describe('SportDefaultsRegistry — dynasty-specific getDraftDefaults', () => {
  it('NCAAF base defaults: keeper_dynasty_carryover_supported = true', () => {
    const defaults = getDraftDefaults('NCAAF')
    expect(defaults.keeper_dynasty_carryover_supported).toBe(true)
  })

  it('NFL dynasty variant: 25 startup rounds, dynasty_adp ranking', () => {
    const defaults = getDraftDefaults('NFL', 'dynasty')
    expect(defaults.rounds_default).toBe(25)
    expect(defaults.pre_draft_ranking_source).toBe('dynasty_adp')
    expect(defaults.keeper_dynasty_carryover_supported).toBe(true)
  })

  it('NCAAF dynasty variant: 25 startup rounds, dynasty_adp ranking', () => {
    const defaults = getDraftDefaults('NCAAF', 'dynasty')
    expect(defaults.rounds_default).toBe(25)
    expect(defaults.pre_draft_ranking_source).toBe('dynasty_adp')
    expect(defaults.keeper_dynasty_carryover_supported).toBe(true)
  })

  it('dynasty variant is distinct from base defaults', () => {
    const base = getDraftDefaults('NFL')
    const dynasty = getDraftDefaults('NFL', 'dynasty')
    expect(dynasty.rounds_default).toBeGreaterThan(base.rounds_default)
    expect(dynasty.pre_draft_ranking_source).toBe('dynasty_adp')
    expect(base.pre_draft_ranking_source).toBe('adp')
  })
})
