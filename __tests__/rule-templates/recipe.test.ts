import { describe, expect, it } from 'vitest'
import { describeRecipe, readShare, recipeFromLeague, recipeFromLegacyPayload, recordUse, stateFromRecipe, type RecipeSource } from '@/lib/rule-templates/recipe'
import { TEMPLATE_SETTINGS_BLACKLIST } from '@/lib/league-templates/buildTemplatePayloadFromLeague'

const dynastySource: RecipeSource = {
  sport: 'NFL',
  leagueType: 'dynasty',
  leagueVariant: null,
  leagueSize: 12,
  scoringPresetId: null,
  medianGame: true,
  draftType: 'snake',
  dynastyConfig: { regularSeasonWeeks: 14, rookiePickOrderMethod: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear', taxiSlots: 5, taxiEligibilityYears: 2, futurePicksYearsOut: 3 },
  waiver: { waiverType: 'faab', faabBudget: 250 },
  keeper: null,
}

describe('recipeFromLeague', () => {
  it('captures the rules, and nothing about the league itself', () => {
    const r = recipeFromLeague(dynastySource)
    expect(r).toMatchObject({ v: 2, sport: 'NFL', leagueType: 'dynasty', teamCount: 12, medianGame: true })
    expect(r.dynasty).toEqual({ regularSeasonLength: 14, rookieDraftOrderMethod: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear', taxiSlotCount: 5, taxiEligibilityYears: 2, futurePickTradeYears: 3, waiverType: 'faab', faabBudget: 250 })
    expect(Object.keys(r).sort()).toEqual(['draftType', 'dynasty', 'keeper', 'leagueType', 'leagueVariant', 'medianGame', 'scoringPresetId', 'sport', 'teamCount', 'v'])
  })
  it('preserves and labels a weighted rookie lottery in a league template', () => {
    const recipe = recipeFromLeague({ ...dynastySource, dynastyConfig: { ...dynastySource.dynastyConfig!, rookiePickOrderMethod: 'weighted_lottery' } })
    expect(recipe.dynasty?.rookieDraftOrderMethod).toBe('weighted_lottery')
    expect(stateFromRecipe(recipe).dynasty.rookieDraftOrderMethod).toBe('weighted_lottery')
    expect(describeRecipe(recipe)).toContain('Rookie order: weighted lottery')
  })
  it('preserves a rookie auction when a dynasty league is used as a template', () => {
    const recipe = recipeFromLeague({ ...dynastySource, dynastyConfig: { ...dynastySource.dynastyConfig!, rookieDraftType: 'auction' } })
    expect(stateFromRecipe(recipe).dynasty.rookieDraftType).toBe('auction')
  })
  it('drops values the wizard could not take rather than forcing them', () => {
    const r = recipeFromLeague({ ...dynastySource, dynastyConfig: { ...dynastySource.dynastyConfig!, rookiePickOrderMethod: 'vibes', taxiSlots: 99 }, waiver: { waiverType: 'standard', faabBudget: null } })
    expect(r.dynasty).not.toHaveProperty('rookieDraftOrderMethod')
    expect(r.dynasty).not.toHaveProperty('taxiSlotCount')
    expect(r.dynasty).not.toHaveProperty('waiverType')
  })
  it('keeper rules only for a keeper league', () => {
    const keeper = { keeperCount: 3, keeperMaxYears: 2, keeperRoundPenalty: 1, keeperWaiverAllowed: false, keeperEligibilityRule: 'drafted_only' }
    expect(recipeFromLeague({ ...dynastySource, leagueType: 'keeper', dynastyConfig: null, keeper }).keeper).toEqual({ keeperMaxKeepers: 3, keeperMaxYears: 2, keeperRoundPenalty: 1, keeperWaiverAllowed: false, keeperEligibilityRule: 'drafted_only' })
    expect(recipeFromLeague({ ...dynastySource, keeper }).keeper).toBeNull()
  })
})

describe('stateFromRecipe — goes through the import path\'s validation', () => {
  it('fills the wizard with the rules and a blank name and draft date', () => {
    const s = stateFromRecipe(recipeFromLeague(dynastySource))
    expect(s).toMatchObject({ sport: 'NFL', leagueType: 'dynasty', teamCount: 12, medianGame: true, name: '', nameTouched: false, draftDate: '', draftTime: '' })
    expect(s.dynasty).toMatchObject({ rookieDraftOrderMethod: 'max_pf', taxiSlotCount: 5, faabBudget: 250, waiverType: 'faab' })
  })
  it('an unsupported format or team count falls back to a valid one', () => {
    const s = stateFromRecipe({ ...recipeFromLeague(dynastySource), leagueType: 'not_a_format', teamCount: 99 })
    expect(s.leagueType).toBe('redraft')
    expect(s.teamCount).not.toBe(99)
  })
  it('dynasty rules are not laid onto a redraft league', () => {
    const base = stateFromRecipe({ ...recipeFromLeague(dynastySource), leagueType: 'redraft', dynasty: null })
    const withRules = stateFromRecipe({ ...recipeFromLeague(dynastySource), leagueType: 'redraft' })
    expect(withRules.dynasty).toEqual(base.dynasty)
  })
  it('a pre-recipe template still starts a league from its core choices', () => {
    const r = recipeFromLegacyPayload({ sport: 'NBA', leagueType: 'redraft', teamCount: 10, draftType: 'snake', scoringPreset: null })
    expect(r).toMatchObject({ sport: 'NBA', teamCount: 10, dynasty: null })
    expect(stateFromRecipe(r!).sport).toBe('NBA')
    expect(recipeFromLegacyPayload({})).toBeNull()
  })
})

describe('describeRecipe', () => {
  it('reads like the spec\'s example', () => {
    const tags = describeRecipe({ ...recipeFromLeague(dynastySource), scoringPresetId: 'nfl_superflex_te_premium_ppr' })
    expect(tags).toEqual(expect.arrayContaining(['NFL', 'Dynasty', '12 teams', 'Superflex', 'TE premium', 'Median game', 'Rookie order: reverse max PF', 'FAAB $250', '5 taxi']))
  })
})

describe('sharing', () => {
  it('counts one start per person and never the owner', () => {
    const s0 = readShare({})
    expect(s0).toEqual({ public: false, uses: 0, usedBy: [] })
    const s1 = recordUse(s0, 'u1', 'owner')!
    expect(s1.uses).toBe(1)
    expect(recordUse(s1, 'u1', 'owner')).toBeNull()
    expect(recordUse(s1, 'owner', 'owner')).toBeNull()
  })
})

describe('legacy settings copy', () => {
  it('strips one league\'s own state: dues, ratings, orphans, lottery result, invites, season phase', () => {
    for (const k of ['dues_tracker', 'commissioner_ratings', 'orphan_adoption_requests', 'draft_lottery_last_result', 'inviteCode', 'dynastySeasonPhase', 'draftDateUtc', 'audit']) {
      expect(TEMPLATE_SETTINGS_BLACKLIST.has(k), k).toBe(true)
    }
    for (const k of ['draft_lottery_config', 'concept_rules_overlay', 'draft_order_mode']) {
      expect(TEMPLATE_SETTINGS_BLACKLIST.has(k), k).toBe(false)
    }
  })
})
