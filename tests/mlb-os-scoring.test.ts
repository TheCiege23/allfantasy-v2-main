import { it, expect } from 'vitest'
import { nativeMlbScoringContext } from '@/lib/category-scoring/nativeMlbScoringContext'
import { buildLeagueRulesGrounding, RULE_FENCE_END } from '@/lib/chimmy/leagueRulesGrounding'
const settings = {scoring_mode:'roto',category_preset_id:'mlb_5x5',category_record_mode:'roto',sportConfig:{lineupLockType:'first_game_of_week'}}
it('exposes stored category rules and rate components to OS consumers', () => {
  const context=nativeMlbScoringContext(settings)!
  expect(context).toMatchObject({mode:'roto',recordMode:'roto',lineupLockType:'first_game_of_week'})
  expect(context.categories).toHaveLength(10)
  expect(context.categories.find(c=>c.id==='era')).toMatchObject({direction:'lower',computation:{denominatorStatKey:'outs',multiplier:27}})
})
it('grounds Chimmy in categories inside the league reference fence', () => {
  const prompt=buildLeagueRulesGrounding({leagueType:'redraft',sport:'MLB',settings})!
  expect(prompt).toContain('Evaluate category impact, not summed fantasy points')
  expect(prompt.indexOf('Stored category scoring')).toBeLessThan(prompt.indexOf(RULE_FENCE_END))
})
it('does not infer category rules from points, missing, or inconsistent settings', () => {
  expect(nativeMlbScoringContext({})).toBeNull()
  expect(nativeMlbScoringContext({...settings,scoring_mode:'points'})).toBeNull()
  expect(nativeMlbScoringContext({...settings,category_record_mode:'most'})).toBeNull()
})
