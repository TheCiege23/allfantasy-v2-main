import { describe, expect, it } from 'vitest'
import { idolTimingRuleLines } from '@/lib/survivor/survivorSettings'

describe('idol timing rules shown to managers', () => {
  it('names the expiry week when set, and always the remaining-players cutoff that every play enforces', () => {
    expect(idolTimingRuleLines({ expiryWeek: 9, invalidRemainingPlayers: 4 })).toEqual(['Idols expire after Week 9', 'Idols stop working once 4 players remain'])
    expect(idolTimingRuleLines({ expiryWeek: null, invalidRemainingPlayers: 5 })).toEqual(['No week limit on idols (some expire at the merge)', 'Idols stop working once 5 players remain'])
  })
})
