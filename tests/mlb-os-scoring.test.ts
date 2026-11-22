import { it, expect } from 'vitest'
import { buildLeagueRulesGrounding, RULE_FENCE_END } from '@/lib/chimmy/leagueRulesGrounding'
const settings = {scoring_mode:'roto',category_preset_id:'mlb_5x5',category_record_mode:'roto',sportConfig:{lineupLockType:'first_game_of_week'}}
it('grounds Chimmy in categories inside the league reference fence', () => {
  const prompt=buildLeagueRulesGrounding({leagueType:'redraft',sport:'MLB',settings})!
  expect(prompt).toContain('Evaluate category impact, not summed fantasy points')
  expect(prompt.indexOf('Stored category scoring')).toBeLessThan(prompt.indexOf(RULE_FENCE_END))
})
