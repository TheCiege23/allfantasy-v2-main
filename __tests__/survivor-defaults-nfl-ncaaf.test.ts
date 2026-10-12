import { describe, it, expect } from 'vitest'
import {
  isSurvivorEligibleSport,
  SURVIVOR_DRAFT_TYPE_IDS,
  getSurvivorDefaultContract,
  buildSurvivorSettingsSnapshot,
  normalizeSurvivorSettingsSnapshot,
  validateSurvivorStructure,
} from '../lib/league-concepts/survivorDefaults'
import { resolveConceptPreset, mergeConceptPresetSettings } from '../lib/league-concepts/resolveConceptPreset'
import { CONCEPT_PRESET_CATALOG } from '../lib/league-concepts/conceptPresetCatalog'

// ── isSurvivorEligibleSport ───────────────────────────────────────────────────

describe('isSurvivorEligibleSport', () => {
  it('returns true for NFL', () => expect(isSurvivorEligibleSport('NFL')).toBe(true))
  it('returns true for NCAAF', () => expect(isSurvivorEligibleSport('NCAAF')).toBe(true))
  it('returns true for lowercase nfl', () => expect(isSurvivorEligibleSport('nfl')).toBe(true))
  it('returns true for NBA', () => expect(isSurvivorEligibleSport('NBA')).toBe(true))
  it('returns false for null', () => expect(isSurvivorEligibleSport(null)).toBe(false))
  it('returns false for empty string', () => expect(isSurvivorEligibleSport('')).toBe(false))
})

// ── SURVIVOR_DRAFT_TYPE_IDS ───────────────────────────────────────────────────

describe('SURVIVOR_DRAFT_TYPE_IDS', () => {
  it('includes snake and auction', () => {
    expect(SURVIVOR_DRAFT_TYPE_IDS).toContain('snake')
    expect(SURVIVOR_DRAFT_TYPE_IDS).toContain('auction')
  })
  it('has the Phase 1 canonical draft types', () => {
    expect(SURVIVOR_DRAFT_TYPE_IDS).toEqual(['snake', 'auction', 'linear', 'real_time', 'by_team', 'offline', 'auto'])
  })
})

// ── getSurvivorDefaultContract — NFL ─────────────────────────────────────────

describe('getSurvivorDefaultContract — NFL', () => {
  const contract = getSurvivorDefaultContract({ sport: 'NFL' })!

  it('returns a contract for NFL', () => expect(contract).not.toBeNull())
  it('league_type is survivor', () => expect(contract.league_type).toBe('survivor'))
  it('survivor_enabled is true', () => expect(contract.survivor_enabled).toBe(true))
  it('survivor_phase is setup', () => expect(contract.survivor_phase).toBe('setup'))
  it('draft_type is snake by default', () => expect(contract.draft_type).toBe('snake'))
  it('roster_mode is survivor', () => expect(contract.roster_mode).toBe('survivor'))
  it('teams = 20 (cast size)', () => expect(contract.teams).toBe(20))

  it('rosterTemplate has 9 starter slots', () => {
    const total = Object.values(contract.rosterTemplate.starterSlots).reduce((a, b) => a + b, 0)
    expect(total).toBe(9)
  })
  it('rosterTemplate bench = 3', () => expect(contract.rosterTemplate.benchSlots).toBe(3))
  it('rosterTemplate IR = 0', () => expect(contract.rosterTemplate.irSlots).toBe(0))
  it('rosterTemplate taxi = 0', () => expect(contract.rosterTemplate.taxiSlots).toBe(0))
  it('rosterTemplate totalRosterSlots = 12', () => expect(contract.rosterTemplate.totalRosterSlots).toBe(12))
  it('NFL uses DST position', () => expect(contract.rosterTemplate.defensePosition).toBe('DST'))

  it('scoringPreset is fb_half_ppr', () => expect(contract.scoring_preset_id).toBe('fb_half_ppr'))

  it('NFL pool: includeNflPlayers true', () => expect(contract.playerPoolRules.includeNflPlayers).toBe(true))
  it('NFL pool: includeCollegePlayers false', () => expect(contract.playerPoolRules.includeCollegePlayers).toBe(false))
  it('NFL pool: collegeOnly false', () => expect(contract.playerPoolRules.collegeOnly).toBe(false))

  // Tribe settings
  it('survivorStructure: castSize = 20', () => expect(contract.survivorStructure.castSize).toBe(20))
  it('survivorStructure: tribeCount = 4', () => expect(contract.survivorStructure.tribeSettings.tribeCount).toBe(4))
  it('survivorStructure: mergeAtCount = 10', () => expect(contract.survivorStructure.tribeSettings.mergeAtCount).toBe(10))
  it('survivorStructure: commissionerPlays = false', () => expect(contract.survivorStructure.tribeSettings.commissionerPlays).toBe(false))
  it('survivorStructure: rocksEnabled = true', () => expect(contract.survivorStructure.tribeSettings.rocksEnabled).toBe(true))
  it('survivorStructure: tribeAssignmentMode = random', () => expect(contract.survivorStructure.tribeSettings.tribeAssignmentMode).toBe('random'))

  // Challenge settings
  it('challengeSettings: weeklyChallengeSEnabled = true', () => expect(contract.survivorStructure.challengeSettings.weeklyChallengeSEnabled).toBe(true))
  it('challengeSettings: automationStatus = pending (Phase 2)', () => {
    expect(contract.survivorStructure.challengeSettings.challengeAutomationStatus).toBe('pending')
  })
  it('challengeSettings: immunityEnabled = true', () => expect(contract.survivorStructure.challengeSettings.immunityEnabled).toBe(true))
  it('challengeSettings: preMergeChallengeType = tribe_score', () => {
    expect(contract.survivorStructure.challengeSettings.preMergeChallengeType).toBe('tribe_score')
  })
  it('challengeSettings: postMergeChallengeType = individual_score', () => {
    expect(contract.survivorStructure.challengeSettings.postMergeChallengeType).toBe('individual_score')
  })

  // Voting settings
  it('votingSettings: tribalCouncilEnabled = true', () => expect(contract.survivorStructure.votingSettings.tribalCouncilEnabled).toBe(true))
  it('votingSettings: automationStatus = pending (Phase 2)', () => {
    expect(contract.survivorStructure.votingSettings.votingAutomationStatus).toBe('pending')
  })
  it('votingSettings: eliminationsPerCycle = 1', () => expect(contract.survivorStructure.votingSettings.eliminationsPerCycle).toBe(1))
  it('votingSettings: voteVisibility = hidden_until_reveal', () => {
    expect(contract.survivorStructure.votingSettings.voteVisibility).toBe('hidden_until_reveal')
  })
  it('votingSettings: tieResolution = rocks_after_revote', () => {
    expect(contract.survivorStructure.votingSettings.tieResolution).toBe('rocks_after_revote')
  })

  // Exile settings
  it('exileSettings: exile is opt-in', () => expect(contract.survivorStructure.exileSettings.exileEnabled).toBe(false))
  it('exileSettings: automationStatus = pending (Phase 2)', () => {
    expect(contract.survivorStructure.exileSettings.exileAutomationStatus).toBe('pending')
  })
  it('exileSettings: exileDurationPeriods = 1', () => expect(contract.survivorStructure.exileSettings.exileDurationPeriods).toBe(1))
  it('exileSettings: effects.cannotVote = true', () => expect(contract.survivorStructure.exileSettings.exileEffects.cannotVote).toBe(true))
  it('exileSettings: effects.stillScoresFantasyPoints = true', () => {
    expect(contract.survivorStructure.exileSettings.exileEffects.stillScoresFantasyPoints).toBe(true)
  })

  // Idol settings
  it('idolSettings: idolsEnabled = true', () => expect(contract.survivorStructure.idolSettings.idolsEnabled).toBe(true))
  it('idolSettings: idolCount = 24', () => expect(contract.survivorStructure.idolSettings.idolCount).toBe(24))
  it('idolSettings: idolPlayWindow = before_vote_reveal', () => {
    expect(contract.survivorStructure.idolSettings.idolPlayWindow).toBe('before_vote_reveal')
  })
  it('idolSettings: searchAutomation = pending (Phase 2)', () => {
    expect(contract.survivorStructure.idolSettings.idolSearchAutomationStatus).toBe('pending')
  })

  // Token settings
  it('tokenSettings: tokensEnabled = true', () => expect(contract.survivorStructure.tokenSettings.tokensEnabled).toBe(true))
  it('tokenSettings: startingTokenBalance = 0', () => expect(contract.survivorStructure.tokenSettings.startingTokenBalance).toBe(0))
  it('tokenSettings: tokenShopStatus = pending (Phase 2)', () => {
    expect(contract.survivorStructure.tokenSettings.tokenShopStatus).toBe('pending')
  })
  it('tokenSettings: tokenLedgerStatus = not_started (Phase 2)', () => {
    expect(contract.survivorStructure.tokenSettings.tokenLedgerStatus).toBe('not_started')
  })

  // Feature flags
  it('enabledFeatures.survivor_enabled = true', () => expect(contract.enabledFeatures.survivor_enabled).toBe(true))
  it('enabledFeatures.challenge_automation = false (Phase 2)', () => {
    expect(contract.enabledFeatures.challenge_automation).toBe(false)
  })
  it('enabledFeatures.voting_automation = false (Phase 2)', () => {
    expect(contract.enabledFeatures.voting_automation).toBe(false)
  })
  it('enabledFeatures.trades = false', () => expect(contract.enabledFeatures.trades).toBe(false))
  it('enabledFeatures.taxi = false', () => expect(contract.enabledFeatures.taxi).toBe(false))
  it('enabledFeatures.devy = false', () => expect(contract.enabledFeatures.devy).toBe(false))
  it('enabledFeatures.c2c = false', () => expect(contract.enabledFeatures.c2c).toBe(false))
  it('enabledFeatures.keeper_carryover = false', () => expect(contract.enabledFeatures.keeper_carryover).toBe(false))
  it('enabledFeatures.isDynasty = false', () => expect(contract.enabledFeatures.isDynasty).toBe(false))
  it('enabledFeatures.isTournament = false', () => expect(contract.enabledFeatures.isTournament).toBe(false))

  // Tabs
  it('tabsEnabled has survivor_hub', () => expect(contract.tabsEnabled.survivor_hub).toBe(true))
  it('tabsEnabled has tribes', () => expect(contract.tabsEnabled.tribes).toBe(true))
  it('tabsEnabled has weekly_challenges', () => expect(contract.tabsEnabled.weekly_challenges).toBe(true))
  it('tabsEnabled has tribal_council', () => expect(contract.tabsEnabled.tribal_council).toBe(true))
  it('tabsEnabled exile_island = pending (Phase 2)', () => expect(contract.tabsEnabled.exile_island).toBe('pending'))
  it('tabsEnabled idols_advantages = pending (Phase 2)', () => expect(contract.tabsEnabled.idols_advantages).toBe('pending'))
  it('tabsEnabled tokens_shop = pending (Phase 2)', () => expect(contract.tabsEnabled.tokens_shop).toBe('pending'))
  it('tabsEnabled settings = commissioner', () => expect(contract.tabsEnabled.settings).toBe('commissioner'))

  // CreationPlan
  it('creationPlan.challengeAutomationStatus = pending', () => {
    expect(contract.creationPlan.challengeAutomationStatus).toBe('pending')
  })
  it('creationPlan.votingAutomationStatus = pending', () => {
    expect(contract.creationPlan.votingAutomationStatus).toBe('pending')
  })
  it('creationPlan.tokenLedgerStatus = not_started', () => {
    expect(contract.creationPlan.tokenLedgerStatus).toBe('not_started')
  })

  it('returns null for unsupported sport', () => {
    expect(getSurvivorDefaultContract({ sport: 'MLB' })).toBeNull()
  })
})

// ── getSurvivorDefaultContract — NCAAF ────────────────────────────────────────

describe('getSurvivorDefaultContract — NCAAF', () => {
  const contract = getSurvivorDefaultContract({ sport: 'NCAAF' })!

  it('returns a contract for NCAAF', () => expect(contract).not.toBeNull())
  it('sport is NCAAF', () => expect(contract.sport).toBe('NCAAF'))
  it('teams = 20 (cast size)', () => expect(contract.teams).toBe(20))
  it('NCAAF uses DEF position', () => expect(contract.rosterTemplate.defensePosition).toBe('DEF'))
  it('DEF in draftablePlayerPositions', () => {
    expect(contract.rosterTemplate.draftablePlayerPositions).toContain('DEF')
  })
  it('DST not in NCAAF positions', () => {
    expect(contract.rosterTemplate.draftablePlayerPositions).not.toContain('DST')
  })
  it('NCAAF pool: includeCollegePlayers true', () => expect(contract.playerPoolRules.includeCollegePlayers).toBe(true))
  it('NCAAF pool: includeNflPlayers false', () => expect(contract.playerPoolRules.includeNflPlayers).toBe(false))
  it('NCAAF pool: collegeOnly true', () => expect(contract.playerPoolRules.collegeOnly).toBe(true))
  it('NCAAF pool: excludeNflPool true', () => expect(contract.playerPoolRules.excludeNflPool).toBe(true))
  it('scoringPreset = ncaaf_half_ppr', () => expect(contract.scoring_preset_id).toBe('ncaaf_half_ppr'))
  it('survivorStructure: castSize = 20', () => expect(contract.survivorStructure.castSize).toBe(20))
  it('survivorStructure: mergeAtCount = 10', () => expect(contract.survivorStructure.tribeSettings.mergeAtCount).toBe(10))
})

// ── Auction draft type ────────────────────────────────────────────────────────

describe('getSurvivorDefaultContract — auction draft', () => {
  const contract = getSurvivorDefaultContract({ sport: 'NFL', draftType: 'auction' })!

  it('draft_type is auction', () => expect(contract.draft_type).toBe('auction'))
  it('draftSettings.draftType is auction', () => expect(contract.draftSettings.draftType).toBe('auction'))
  it('auctionBudgetPerTeam is 200', () => expect(contract.draftSettings.auctionBudgetPerTeam).toBe(200))
})

// ── buildSurvivorSettingsSnapshot ─────────────────────────────────────────────

describe('buildSurvivorSettingsSnapshot — NFL', () => {
  const snap = buildSurvivorSettingsSnapshot({ sport: 'NFL' })!

  it('returns non-null for NFL', () => expect(snap).not.toBeNull())
  it('league_type = survivor', () => expect(snap.league_type).toBe('survivor'))
  it('isSurvivor = true', () => expect(snap.isSurvivor).toBe(true))
  it('isDynasty = false', () => expect(snap.isDynasty).toBe(false))
  it('isTournament = false', () => expect(snap.isTournament).toBe(false))
  it('isGuillotine = false', () => expect(snap.isGuillotine).toBe(false))
  it('isKeeper = false', () => expect(snap.isKeeper).toBe(false))
  it('ir_slots = 0', () => expect(snap.ir_slots).toBe(0))
  it('taxi_slots = 0', () => expect(snap.taxi_slots).toBe(0))
  it('taxi_enabled = false', () => expect(snap.taxi_enabled).toBe(false))
  it('devy_enabled = false', () => expect(snap.devy_enabled).toBe(false))
  it('c2c_enabled = false', () => expect(snap.c2c_enabled).toBe(false))
  it('has survivorStructure block', () => expect(snap.survivorStructure).toBeDefined())
  it('has survivor_structure block', () => expect(snap.survivor_structure).toBeDefined())
  it('cast_size = 20', () => expect(snap.cast_size).toBe(20))
  it('tribe_count = 4', () => expect(snap.tribe_count).toBe(4))
  it('merge_at_count = 10', () => expect(snap.merge_at_count).toBe(10))
  it('weekly_challenges_enabled = true', () => expect(snap.weekly_challenges_enabled).toBe(true))
  it('challenge_automation_status = pending', () => expect(snap.challenge_automation_status).toBe('pending'))
  it('tribal_council_enabled = true', () => expect(snap.tribal_council_enabled).toBe(true))
  it('voting_automation_status = pending', () => expect(snap.voting_automation_status).toBe('pending'))
  it('exile_enabled is opt-in', () => expect(snap.exile_enabled).toBe(false))
  it('exile_automation_status = pending', () => expect(snap.exile_automation_status).toBe('pending'))
  it('idols_enabled = true', () => expect(snap.idols_enabled).toBe(true))
  it('idol_count = 24', () => expect(snap.idol_count).toBe(24))
  it('idol_search_automation_status = pending', () => expect(snap.idol_search_automation_status).toBe('pending'))
  it('tokens_enabled = true', () => expect(snap.tokens_enabled).toBe(true))
  it('token_ledger_status = not_started', () => expect(snap.token_ledger_status).toBe('not_started'))
  it('token_shop_status = pending', () => expect(snap.token_shop_status).toBe('pending'))
  it('has creationPlan block', () => expect(snap.creationPlan).toBeDefined())

  it('returns null for unsupported sport', () => {
    expect(buildSurvivorSettingsSnapshot({ sport: 'MLB' })).toBeNull()
  })
})

// ── normalizeSurvivorSettingsSnapshot ─────────────────────────────────────────

describe('normalizeSurvivorSettingsSnapshot', () => {
  it('enforces league_type = survivor', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { league_type: 'dynasty' },
    })
    expect(result.league_type).toBe('survivor')
  })

  it('enforces isSurvivor = true', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { isSurvivor: false },
    })
    expect(result.isSurvivor).toBe(true)
  })

  it('blocks taxi', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { taxi_enabled: true, taxi_slots: 3 },
    })
    expect(result.taxi_enabled).toBe(false)
    expect(result.taxi_slots).toBe(0)
  })

  it('blocks devy', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { devy: true, devy_enabled: true },
    })
    expect(result.devy).toBe(false)
    expect(result.devy_enabled).toBe(false)
  })

  it('blocks c2c', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { c2c: true, c2c_enabled: true },
    })
    expect(result.c2c).toBe(false)
    expect(result.c2c_enabled).toBe(false)
  })

  it('blocks keeper_carryover', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { keeper_carryover: true },
    })
    expect(result.keeper_carryover).toBe(false)
  })

  it('blocks future picks', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { future_picks_enabled: true },
    })
    expect(result.future_picks_enabled).toBe(false)
  })

  it('downgrade active challenge automation to pending (Phase 2)', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { challenge_automation_status: 'active' },
    })
    expect(result.challenge_automation_status).toBe('pending')
  })

  it('downgrade active voting automation to pending (Phase 2)', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { voting_automation_status: 'active' },
    })
    expect(result.voting_automation_status).toBe('pending')
  })

  it('downgrade active exile automation to pending (Phase 2)', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { exile_automation_status: 'active' },
    })
    expect(result.exile_automation_status).toBe('pending')
  })

  it('preserves leagueName from incoming settings', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { leagueName: 'Survivor Season 1' },
    })
    expect(result.leagueName).toBe('Survivor Season 1')
  })

  it('preserves timezone from incoming settings', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { timezone: 'America/Los_Angeles' },
    })
    expect(result.timezone).toBe('America/Los_Angeles')
  })

  it('re-applies canonical draftSettings after merge', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      draftType: 'auction',
      settings: { draft_type: 'snake' },
    })
    expect(result.draft_type).toBe('auction')
    const ds = result.draftSettings as Record<string, unknown>
    expect(ds.draftType).toBe('auction')
  })

  it('mock draft sets game-event guards to false', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { draft_type: 'mock_draft', mock_draft_mode: true },
    })
    expect(result.mock_triggers_challenges).toBe(false)
    expect(result.mock_triggers_votes).toBe(false)
    expect(result.mock_triggers_exile).toBe(false)
    expect(result.mock_triggers_idols).toBe(false)
    expect(result.mock_triggers_tokens).toBe(false)
  })

  it('isDynasty stays false after merge', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { isDynasty: true },
    })
    expect(result.isDynasty).toBe(false)
  })

  it('isTournament stays false after merge', () => {
    const result = normalizeSurvivorSettingsSnapshot({
      sport: 'NFL',
      settings: { isTournament: true },
    })
    expect(result.isTournament).toBe(false)
  })
})

// ── validateSurvivorStructure ─────────────────────────────────────────────────

describe('validateSurvivorStructure', () => {
  const valid = { castSize: 20, tribeCount: 4, mergeAtCount: 10 }

  it('passes for canonical NFL structure', () => {
    const result = validateSurvivorStructure(valid)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('passes for canonical NCAAF structure', () => {
    const result = validateSurvivorStructure({ castSize: 20, tribeCount: 4, mergeAtCount: 10 })
    expect(result.valid).toBe(true)
  })

  it('fails when castSize < 4', () => {
    const result = validateSurvivorStructure({ ...valid, castSize: 3 })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('castSize'))).toBe(true)
  })

  it('fails when tribeCount < 2', () => {
    const result = validateSurvivorStructure({ ...valid, tribeCount: 1 })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('tribeCount'))).toBe(true)
  })

  it('fails when mergeAtCount >= castSize', () => {
    const result = validateSurvivorStructure({ ...valid, mergeAtCount: 20 })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('mergeAtCount'))).toBe(true)
  })

  it('fails when mergeAtCount < 2', () => {
    const result = validateSurvivorStructure({ ...valid, mergeAtCount: 1 })
    expect(result.valid).toBe(false)
  })

  it('warns when cast not evenly divisible by tribeCount', () => {
    const result = validateSurvivorStructure({ castSize: 15, tribeCount: 2, mergeAtCount: 7 })
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

// ── Catalog entries ───────────────────────────────────────────────────────────

describe('conceptPresetCatalog — survivor entries', () => {
  const nfl = CONCEPT_PRESET_CATALOG.find(p => p.sport === 'NFL' && p.leagueType === 'survivor')
  const ncaaf = CONCEPT_PRESET_CATALOG.find(p => p.sport === 'NCAAF' && p.leagueType === 'survivor')

  it('NFL survivor catalog entry exists', () => expect(nfl).toBeDefined())
  it('NCAAF survivor catalog entry exists', () => expect(ncaaf).toBeDefined())

  it('NFL defaultTeamCount = 20', () => expect(nfl?.defaultTeamCount).toBe(20))
  it('NCAAF defaultTeamCount = 20', () => expect(ncaaf?.defaultTeamCount).toBe(20))

  it('NFL draftTypesAllowed includes snake and auction', () => {
    expect(nfl?.draftTypesAllowed).toContain('snake')
    expect(nfl?.draftTypesAllowed).toContain('auction')
  })
  it('NCAAF draftTypesAllowed includes snake and auction', () => {
    expect(ncaaf?.draftTypesAllowed).toContain('snake')
    expect(ncaaf?.draftTypesAllowed).toContain('auction')
  })

  it('NFL benchSlots = 3', () => expect(nfl?.benchSlots).toBe(3))
  it('NCAAF benchSlots = 3', () => expect(ncaaf?.benchSlots).toBe(3))
  it('NFL rosterSlots = 9', () => expect(nfl?.rosterSlots).toBe(9))
  it('NFL irSlots = 0', () => expect(nfl?.irSlots).toBe(0))
  it('NFL modifiers include survivor', () => expect(nfl?.metadata.modifiers).toContain('survivor'))
  it('NCAAF scoringPreset = ncaaf_half_ppr', () => expect(ncaaf?.scoringPreset).toBe('ncaaf_half_ppr'))
})

// ── resolveConceptPreset integration ─────────────────────────────────────────

describe('resolveConceptPreset — survivor', () => {
  it('NFL snake resolves ok', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'survivor',
      scoringPreset: 'fb_half_ppr',
      draftType: 'snake',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settingsSnapshot.league_type).toBe('survivor')
    expect(result.settingsSnapshot.isSurvivor).toBe(true)
  })

  it('NFL auction resolves ok and draftType is auction', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'survivor',
      scoringPreset: 'fb_half_ppr',
      draftType: 'auction',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ds = result.settingsSnapshot.draftSettings as Record<string, unknown>
    expect(ds.draftType).toBe('auction')
  })

  it('NCAAF snake resolves ok', () => {
    const result = resolveConceptPreset({
      sport: 'NCAAF',
      leagueType: 'survivor',
      scoringPreset: 'ncaaf_half_ppr',
      draftType: 'snake',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settingsSnapshot.sport).toBe('NCAAF')
    expect(result.settingsSnapshot.league_type).toBe('survivor')
  })

  it('NCAAF has college-only pool', () => {
    const result = resolveConceptPreset({
      sport: 'NCAAF',
      leagueType: 'survivor',
      scoringPreset: 'ncaaf_half_ppr',
      draftType: 'snake',
    })
    if (!result.ok) return
    const pool = result.settingsSnapshot.playerPoolRules as Record<string, unknown>
    expect(pool.includeCollegePlayers).toBe(true)
    expect(pool.includeNflPlayers).toBe(false)
  })

  it('snapshot has survivorStructure', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'survivor',
      scoringPreset: 'fb_half_ppr',
      draftType: 'snake',
    })
    if (!result.ok) return
    expect(result.settingsSnapshot.survivorStructure).toBeDefined()
  })

  it('challenge_automation_status = pending in resolved snapshot', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'survivor',
      scoringPreset: 'fb_half_ppr',
      draftType: 'snake',
    })
    if (!result.ok) return
    expect(result.settingsSnapshot.challenge_automation_status).toBe('pending')
  })

  it('devy_enabled is blocked', () => {
    const result = resolveConceptPreset({
      sport: 'NFL',
      leagueType: 'survivor',
      scoringPreset: 'fb_half_ppr',
      draftType: 'snake',
    })
    if (!result.ok) return
    expect(result.settingsSnapshot.devy_enabled).toBe(false)
  })

  it('NFL pool does not bleed into NCAAF', () => {
    const nfl = resolveConceptPreset({ sport: 'NFL', leagueType: 'survivor', scoringPreset: 'fb_half_ppr', draftType: 'snake' })
    const ncaaf = resolveConceptPreset({ sport: 'NCAAF', leagueType: 'survivor', scoringPreset: 'ncaaf_half_ppr', draftType: 'snake' })
    if (!nfl.ok || !ncaaf.ok) return
    const nflPool = nfl.settingsSnapshot.playerPoolRules as Record<string, unknown>
    const ncaafPool = ncaaf.settingsSnapshot.playerPoolRules as Record<string, unknown>
    expect(nflPool.includeNflPlayers).toBe(true)
    expect(nflPool.includeCollegePlayers).toBe(false)
    expect(ncaafPool.includeNflPlayers).toBe(false)
    expect(ncaafPool.includeCollegePlayers).toBe(true)
  })
})

// ── mergeConceptPresetSettings integration ────────────────────────────────────

describe('mergeConceptPresetSettings — survivor', () => {
  const baseSnap = buildSurvivorSettingsSnapshot({ sport: 'NFL' }) ?? {}

  it('devy blocked after merge', () => {
    const result = mergeConceptPresetSettings(baseSnap, { devy: true })
    expect(result.devy).toBe(false)
  })

  it('keeper blocked after merge', () => {
    const result = mergeConceptPresetSettings(baseSnap, { keeper_carryover: true })
    expect(result.keeper_carryover).toBe(false)
  })

  it('league_type stays survivor after merge', () => {
    const result = mergeConceptPresetSettings(baseSnap, { league_type: 'dynasty' })
    expect(result.league_type).toBe('survivor')
  })

  it('leagueName preserved from league settings', () => {
    const result = mergeConceptPresetSettings(baseSnap, { leagueName: 'Island Chaos 2026' })
    expect(result.leagueName).toBe('Island Chaos 2026')
  })

  it('challenge_automation_status cannot be forced active', () => {
    const result = mergeConceptPresetSettings(
      baseSnap,
      { challenge_automation_status: 'active' },
    )
    expect(result.challenge_automation_status).toBe('pending')
  })

  it('isTournament stays false', () => {
    const result = mergeConceptPresetSettings(baseSnap, { isTournament: true })
    expect(result.isTournament).toBe(false)
  })
})
