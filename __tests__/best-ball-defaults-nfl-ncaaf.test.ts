/**
 * Best-ball defaults — NFL and NCAAF canonical creation pipeline tests.
 * Covers: isBestBallEligibleSport, getBestBallDefaultContract, buildBestBallSettingsSnapshot,
 * normalizeBestBallSettingsSnapshot, catalog entries, resolveConceptPreset, mergeConceptPresetSettings.
 */

import { describe, it, expect } from 'vitest'
import {
  isBestBallEligibleSport,
  getBestBallDefaultContract,
  buildBestBallSettingsSnapshot,
  normalizeBestBallSettingsSnapshot,
  BEST_BALL_CANONICAL_DRAFT_TYPE_IDS,
} from '@/lib/league-concepts/bestBallDefaults'
import { CONCEPT_PRESET_CATALOG } from '@/lib/league-concepts/conceptPresetCatalog'
import { resolveConceptPreset, mergeConceptPresetSettings } from '@/lib/league-concepts/resolveConceptPreset'

// ── isBestBallEligibleSport ───────────────────────────────────────────────────

describe('isBestBallEligibleSport', () => {
  it('returns true for NFL', () => expect(isBestBallEligibleSport('NFL')).toBe(true))
  it('returns true for NCAAF', () => expect(isBestBallEligibleSport('NCAAF')).toBe(true))
  it('returns true for lowercase nfl', () => expect(isBestBallEligibleSport('nfl')).toBe(true))
  it('returns false for NBA', () => expect(isBestBallEligibleSport('NBA')).toBe(false))
  it('returns false for null', () => expect(isBestBallEligibleSport(null)).toBe(false))
  it('returns false for empty string', () => expect(isBestBallEligibleSport('')).toBe(false))
})

// ── BEST_BALL_CANONICAL_DRAFT_TYPE_IDS ────────────────────────────────────────

describe('BEST_BALL_CANONICAL_DRAFT_TYPE_IDS', () => {
  it('includes all five modes', () => {
    expect(BEST_BALL_CANONICAL_DRAFT_TYPE_IDS).toContain('snake')
    expect(BEST_BALL_CANONICAL_DRAFT_TYPE_IDS).toContain('auction')
    expect(BEST_BALL_CANONICAL_DRAFT_TYPE_IDS).toContain('linear')
    expect(BEST_BALL_CANONICAL_DRAFT_TYPE_IDS).toContain('offline')
    expect(BEST_BALL_CANONICAL_DRAFT_TYPE_IDS).toContain('auto')
  })
})

// ── NFL best-ball contract ────────────────────────────────────────────────────

describe('getBestBallDefaultContract — NFL', () => {
  const contract = getBestBallDefaultContract({ sport: 'NFL', draftType: 'snake', scoringPresetId: 'fb_ppr' })!

  it('returns non-null for NFL', () => expect(contract).not.toBeNull())
  it('league_type is best_ball', () => expect(contract.league_type).toBe('best_ball'))
  it('leagueType is best_ball', () => expect(contract.leagueType).toBe('best_ball'))
  it('roster_mode is best_ball', () => expect(contract.roster_mode).toBe('best_ball'))
  it('teams defaults to 12', () => expect(contract.teams).toBe(12))
  it('rosterTemplate.totalRosterSlots is 18', () => expect(contract.rosterTemplate.totalRosterSlots).toBe(18))
  it('rosterTemplate.benchSlots is 0', () => expect(contract.rosterTemplate.benchSlots).toBe(0))
  it('rosterTemplate.irSlots is 0', () => expect(contract.rosterTemplate.irSlots).toBe(0))
  it('rosterTemplate.taxiSlots is 0', () => expect(contract.rosterTemplate.taxiSlots).toBe(0))
  it('rosterTemplate.draftRounds is 18', () => expect(contract.rosterTemplate.draftRounds).toBe(18))
  it('NFL has QB:1, RB:2, WR:3, TE:1, FLEX:2 starters', () => {
    expect(contract.rosterTemplate.starterSlots).toMatchObject({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 })
  })
  it('scoring_preset_id is fb_ppr', () => expect(contract.scoring_preset_id).toBe('fb_ppr'))
  it('seasonSettings.regularSeasonLength is 14', () => expect(contract.seasonSettings.regularSeasonLength).toBe(14))
  it('seasonSettings.playoffTeams is 6', () => expect(contract.seasonSettings.playoffTeams).toBe(6))
  it('seasonSettings.waiversEnabled is false', () => expect(contract.seasonSettings.waiversEnabled).toBe(false))
  it('seasonSettings.tradesEnabled is false', () => expect(contract.seasonSettings.tradesEnabled).toBe(false))
  it('draftSettings.thirdRoundReversal is true for snake/NFL', () => expect(contract.draftSettings.thirdRoundReversal).toBe(true))
  it('draftSettings.preDraftRankingSource is adp', () => expect(contract.draftSettings.preDraftRankingSource).toBe('adp'))
  it('enabledFeatures.isBestBall is true', () => expect(contract.enabledFeatures.isBestBall).toBe(true))
  it('enabledFeatures.isDynasty is false', () => expect(contract.enabledFeatures.isDynasty).toBe(false))
  it('enabledFeatures.devy is false', () => expect(contract.enabledFeatures.devy).toBe(false))
  it('enabledFeatures.taxi is false', () => expect(contract.enabledFeatures.taxi).toBe(false))
  it('playerPoolRules.includeNflPlayers is true', () => expect(contract.playerPoolRules.includeNflPlayers).toBe(true))
  it('playerPoolRules.includeCollegePlayers is false', () => expect(contract.playerPoolRules.includeCollegePlayers).toBe(false))
  it('optimizerSettings.enabled is true', () => expect(contract.optimizerSettings.enabled).toBe(true))
  it('optimizerSettings.lineupTemplateId is best_ball_nfl_default', () => expect(contract.optimizerSettings.lineupTemplateId).toBe('best_ball_nfl_default'))
})

// ── NFL auction draft mode ────────────────────────────────────────────────────

describe('getBestBallDefaultContract — NFL auction', () => {
  const contract = getBestBallDefaultContract({ sport: 'NFL', draftType: 'auction' })!

  it('draft_type is auction', () => expect(contract.draft_type).toBe('auction'))
  it('auctionBudgetPerTeam is 200', () => expect(contract.draftSettings.auctionBudgetPerTeam).toBe(200))
  it('thirdRoundReversal is false for auction', () => expect(contract.draftSettings.thirdRoundReversal).toBe(false))
  it('draftExecutionMode is live', () => expect(contract.draftSettings.draftExecutionMode).toBe('live'))
})

// ── NFL offline/auto modes ────────────────────────────────────────────────────

describe('getBestBallDefaultContract — NFL offline', () => {
  const contract = getBestBallDefaultContract({ sport: 'NFL', draftType: 'offline' })!
  it('draftExecutionMode is offline', () => expect(contract.draftSettings.draftExecutionMode).toBe('offline'))
  it('offlineEntryTracking is true', () => expect(contract.draftSettings.offlineEntryTracking).toBe(true))
  it('requested_draft_type is offline', () => expect(contract.requested_draft_type).toBe('offline'))
})

describe('getBestBallDefaultContract — NFL auto', () => {
  const contract = getBestBallDefaultContract({ sport: 'NFL', draftType: 'auto' })!
  it('draftExecutionMode is auto', () => expect(contract.draftSettings.draftExecutionMode).toBe('auto'))
  it('requested_draft_type is auto', () => expect(contract.requested_draft_type).toBe('auto'))
})

// ── NCAAF best-ball contract ──────────────────────────────────────────────────

describe('getBestBallDefaultContract — NCAAF', () => {
  const contract = getBestBallDefaultContract({ sport: 'NCAAF', draftType: 'snake', scoringPresetId: 'ncaaf_half_ppr' })!

  it('returns non-null for NCAAF', () => expect(contract).not.toBeNull())
  it('rosterTemplate.totalRosterSlots is 16', () => expect(contract.rosterTemplate.totalRosterSlots).toBe(16))
  it('NCAAF has no TE starter slot', () => expect(contract.rosterTemplate.starterSlots).not.toHaveProperty('TE'))
  it('NCAAF has QB:1, RB:2, WR:3, FLEX:2', () => {
    expect(contract.rosterTemplate.starterSlots).toMatchObject({ QB: 1, RB: 2, WR: 3, FLEX: 2 })
  })
  // 11 since 2026-09-28: a 4-team bracket plays weeks 12-13, ending on the last full college slate.
  it('seasonSettings.regularSeasonLength is 11', () => expect(contract.seasonSettings.regularSeasonLength).toBe(11))
  it('seasonSettings.playoffTeams is 4', () => expect(contract.seasonSettings.playoffTeams).toBe(4))
  it('playerPoolRules.includeNflPlayers is false', () => expect(contract.playerPoolRules.includeNflPlayers).toBe(false))
  it('playerPoolRules.includeCollegePlayers is true', () => expect(contract.playerPoolRules.includeCollegePlayers).toBe(true))
  it('playerPoolRules.collegeOnly is true', () => expect(contract.playerPoolRules.collegeOnly).toBe(true))
  it('playerPoolRules.excludeNflPool is true', () => expect(contract.playerPoolRules.excludeNflPool).toBe(true))
  it('scoring_preset_id is ncaaf_half_ppr', () => expect(contract.scoring_preset_id).toBe('ncaaf_half_ppr'))
  it('thirdRoundReversal is false for NCAAF', () => expect(contract.draftSettings.thirdRoundReversal).toBe(false))
  it('rosterTemplate.lineupTemplateId is best_ball_ncaaf_default', () => expect(contract.rosterTemplate.lineupTemplateId).toBe('best_ball_ncaaf_default'))
})

// ── buildBestBallSettingsSnapshot ─────────────────────────────────────────────

describe('buildBestBallSettingsSnapshot', () => {
  it('returns null for ineligible sport', () => {
    expect(buildBestBallSettingsSnapshot({ sport: 'NBA' })).toBeNull()
  })

  it('sets bestBallDefaultsVersion marker', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect(snap.bestBallDefaultsVersion).toBe(1)
  })

  it('sets isBestBall: true', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect(snap.isBestBall).toBe(true)
  })

  it('bench_slots is 0', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect(snap.bench_slots).toBe(0)
  })

  it('ir_slots is 0', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect(snap.ir_slots).toBe(0)
  })

  it('taxi_slots is 0', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect(snap.taxi_slots).toBe(0)
  })

  it('devyConfig.enabled is false', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect((snap.devyConfig as { enabled: boolean }).enabled).toBe(false)
  })

  it('c2cConfig.enabled is false', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect((snap.c2cConfig as { enabled: boolean }).enabled).toBe(false)
  })

  it('keeperSettings.enabled is false', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect((snap.keeperSettings as { enabled: boolean }).enabled).toBe(false)
  })

  it('rookieDraftConfig.enabled is false', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect((snap.rookieDraftConfig as { enabled: boolean }).enabled).toBe(false)
  })

  it('futurePicksConfig.enabled is false', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect((snap.futurePicksConfig as { enabled: boolean }).enabled).toBe(false)
  })

  it('NCAAF pool has excludeNflPool flag', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NCAAF' })!
    expect((snap.playerPoolRules as Record<string, unknown>).excludeNflPool).toBe(true)
  })

  it('optimizerSettings present and enabled', () => {
    const snap = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    expect((snap.optimizerSettings as { enabled: boolean }).enabled).toBe(true)
  })
})

// ── normalizeBestBallSettingsSnapshot ─────────────────────────────────────────

describe('normalizeBestBallSettingsSnapshot', () => {
  it('enforces league_type = best_ball even if user sets dynasty', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { league_type: 'dynasty', leagueType: 'dynasty' },
    })
    expect(result.league_type).toBe('best_ball')
    expect(result.leagueType).toBe('best_ball')
  })

  it('enforces roster_mode = best_ball', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { roster_mode: 'redraft' },
    })
    expect(result.roster_mode).toBe('best_ball')
  })

  it('blocks waivers injection', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { waivers: true, waivers_enabled: true },
    })
    expect(result.waivers).toBe(false)
    expect(result.waivers_enabled).toBe(false)
  })

  it('blocks trades injection', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { trades: true, trades_enabled: true },
    })
    expect(result.trades).toBe(false)
    expect(result.trades_enabled).toBe(false)
  })

  it('blocks taxi injection', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { taxi: true, taxi_enabled: true, taxi_slots: 5 },
    })
    expect(result.taxi).toBe(false)
    expect(result.taxi_slots).toBe(0)
  })

  it('blocks devy injection', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { devy: true, devy_enabled: true, devyConfig: { enabled: true } },
    })
    expect(result.devy).toBe(false)
    expect(result.devy_enabled).toBe(false)
    expect((result.devyConfig as { enabled: boolean }).enabled).toBe(false)
  })

  it('blocks C2C injection', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { c2c: true, c2c_enabled: true, c2cConfig: { enabled: true } },
    })
    expect(result.c2c).toBe(false)
    expect(result.c2c_enabled).toBe(false)
    expect((result.c2cConfig as { enabled: boolean }).enabled).toBe(false)
  })

  it('blocks keeper carryover injection', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { keeper_dynasty_carryover_supported: true },
    })
    expect(result.keeper_dynasty_carryover_supported).toBe(false)
    expect(result.keeperDynastyCarryoverSupported).toBe(false)
  })

  it('preserves leagueName', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { leagueName: 'My Best Ball' },
    })
    expect(result.leagueName).toBe('My Best Ball')
  })

  it('preserves language', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { language: 'es' },
    })
    expect(result.language).toBe('es')
  })

  it('preserves timezone', () => {
    const result = normalizeBestBallSettingsSnapshot({
      sport: 'NFL',
      settings: { timezone: 'America/Chicago' },
    })
    expect(result.timezone).toBe('America/Chicago')
  })
})

// ── Concept preset catalog ────────────────────────────────────────────────────

describe('CONCEPT_PRESET_CATALOG — best-ball entries', () => {
  const nflEntry = CONCEPT_PRESET_CATALOG.find(
    (p) => p.sport === 'NFL' && p.leagueType === 'best_ball',
  )
  const ncaafEntry = CONCEPT_PRESET_CATALOG.find(
    (p) => p.sport === 'NCAAF' && p.leagueType === 'best_ball',
  )

  it('NFL best-ball entry exists', () => expect(nflEntry).toBeDefined())
  it('NCAAF best-ball entry exists', () => expect(ncaafEntry).toBeDefined())

  it('NFL allows snake', () => expect(nflEntry?.draftTypesAllowed).toContain('snake'))
  it('NFL allows auction', () => expect(nflEntry?.draftTypesAllowed).toContain('auction'))
  it('NFL allows linear', () => expect(nflEntry?.draftTypesAllowed).toContain('linear'))
  it('NFL allows offline', () => expect(nflEntry?.draftTypesAllowed).toContain('offline'))
  it('NFL allows auto', () => expect(nflEntry?.draftTypesAllowed).toContain('auto'))

  it('NCAAF allows snake', () => expect(ncaafEntry?.draftTypesAllowed).toContain('snake'))
  it('NCAAF allows auction', () => expect(ncaafEntry?.draftTypesAllowed).toContain('auction'))
  it('NCAAF allows linear', () => expect(ncaafEntry?.draftTypesAllowed).toContain('linear'))
  it('NCAAF allows offline', () => expect(ncaafEntry?.draftTypesAllowed).toContain('offline'))
  it('NCAAF allows auto', () => expect(ncaafEntry?.draftTypesAllowed).toContain('auto'))

  it('NFL rosterSlots is 18', () => expect(nflEntry?.rosterSlots).toBe(18))
  it('NCAAF rosterSlots is 16', () => expect(ncaafEntry?.rosterSlots).toBe(16))
  it('both have bench_slots 0', () => {
    expect(nflEntry?.benchSlots).toBe(0)
    expect(ncaafEntry?.benchSlots).toBe(0)
  })
  it('both are launch_ready', () => {
    expect(nflEntry?.readiness).toBe('launch_ready')
    expect(ncaafEntry?.readiness).toBe('launch_ready')
  })
  it('both have best_ball modifier', () => {
    expect(nflEntry?.metadata.modifiers).toContain('best_ball')
    expect(ncaafEntry?.metadata.modifiers).toContain('best_ball')
  })
  it('both include best_ball_optimizer AI feature', () => {
    expect(nflEntry?.aiEnabledFeatures).toContain('best_ball_optimizer')
    expect(ncaafEntry?.aiEnabledFeatures).toContain('best_ball_optimizer')
  })
})

// ── resolveConceptPreset ──────────────────────────────────────────────────────

describe('resolveConceptPreset — best-ball', () => {
  it('NFL best-ball resolves and returns best-ball snapshot', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'best_ball',
      scoringPreset: 'fb_ppr',
      draftType: 'snake',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settingsSnapshot.league_type).toBe('best_ball')
    expect(result.settingsSnapshot.isBestBall).toBe(true)
  })

  it('NCAAF best-ball resolves and returns NCAAF pool isolation', () => {
    const result = resolveConceptPreset({
      sport: 'NCAAF',
      leagueType: 'best_ball',
      scoringPreset: 'ncaaf_half_ppr',
      draftType: 'snake',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settingsSnapshot.league_type).toBe('best_ball')
    const pool = result.settingsSnapshot.playerPoolRules as Record<string, unknown>
    expect(pool.includeNflPlayers).toBe(false)
    expect(pool.collegeOnly).toBe(true)
  })

  it('NFL best-ball auction resolves correctly', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'best_ball',
      scoringPreset: 'fb_ppr',
      draftType: 'auction',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const draft = result.settingsSnapshot.draftSettings as Record<string, unknown>
    expect(draft.draftType).toBe('auction')
    expect(draft.auctionBudgetPerTeam).toBe(200)
  })
})

// ── mergeConceptPresetSettings ────────────────────────────────────────────────

describe('mergeConceptPresetSettings — best-ball guardrails', () => {
  it('blocks devy injection on merge', () => {
    const preset = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    const merged = mergeConceptPresetSettings(preset, {
      devy: true,
      devy_enabled: true,
      league_type: 'best_ball',
      leagueType: 'best_ball',
    })
    expect(merged.devy).toBe(false)
    expect(merged.devy_enabled).toBe(false)
  })

  it('blocks keeper carryover injection on merge', () => {
    const preset = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    const merged = mergeConceptPresetSettings(preset, {
      keeper_dynasty_carryover_supported: true,
      league_type: 'best_ball',
      leagueType: 'best_ball',
    })
    expect(merged.keeper_dynasty_carryover_supported).toBe(false)
  })

  it('preserves leagueName through merge', () => {
    const preset = buildBestBallSettingsSnapshot({ sport: 'NFL' })!
    const merged = mergeConceptPresetSettings(preset, {
      leagueName: 'Champs League BB',
      league_type: 'best_ball',
      leagueType: 'best_ball',
    })
    expect(merged.leagueName).toBe('Champs League BB')
  })
})
