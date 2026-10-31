import { describe, expect, it } from 'vitest'
import { chooseBestValueKeepers, pickSlotForRound, readMissedDeadlineRule, type BestValueCandidate } from '@/lib/keeper/missedDeadline'
import { resolveKeeperRules } from '@/lib/keeper/keeperRules'

const rules = (keeperConflictRule = 'player_chooses') => resolveKeeperRules({ keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperConflictRule })
const c = (playerId: string, costRound: number | null, marketRank: number | null): BestValueCandidate => ({ playerId, name: playerId, costRound, marketRank })
const pick = (candidates: BestValueCandidate[], over: { maxKeepers?: number; rule?: string } = {}) =>
  chooseBestValueKeepers({ candidates, maxKeepers: over.maxKeepers ?? 3, teams: 12, rules: rules(over.rule), totalRounds: 15 }).map((k) => k.playerId)

describe('missed-deadline keepers: AF picks best value', () => {
  it('reads unknown rules as "keeps nobody"', () => {
    expect(readMissedDeadlineRule('auto_best_value')).toBe('auto_best_value')
    expect(readMissedDeadlineRule('auto_something')).toBe('auto_no_keepers')
    expect(readMissedDeadlineRule(null)).toBe('auto_no_keepers')
  })

  it('values a keeper by how far his market rank beats the middle of his cost round', () => {
    expect(pickSlotForRound(1, 12)).toBe(6)
    expect(pickSlotForRound(9, 12)).toBe(102)
    // star costing a 9th (+92), solid costing a 6th (+30), bust costing a 3rd (−50)
    expect(pick([c('solid', 6, 36), c('bust', 3, 80), c('star', 9, 10)])).toEqual(['star', 'solid'])
  })

  it('never keeps a player worth less than his pick, or one it cannot price', () => {
    expect(pick([c('even', 5, 54), c('noPrice', 10, null), c('noRound', null, 5)])).toEqual([])
  })

  it('stops at the keeper limit, best first', () => {
    expect(pick([c('a', 10, 20), c('b', 10, 40), c('c', 12, 50), c('d', 14, 60)], { maxKeepers: 2 })).toEqual(['d', 'a']) // +102, +94 (c is +88)
  })

  it('under a refusing same-round rule it skips the second player in a round rather than forcing him in', () => {
    expect(pick([c('x', 8, 10), c('y', 8, 20), c('z', 11, 70)])).toEqual(['x', 'z'])
  })

  it('under a moving same-round rule both are kept, the second taking the round before', () => {
    const kept = chooseBestValueKeepers({ candidates: [c('x', 8, 10), c('y', 8, 20)], maxKeepers: 3, teams: 12, rules: rules('lose_round_before'), totalRounds: 15 })
    expect(kept.map((k) => [k.playerId, k.pickRound])).toEqual([['x', 8], ['y', 7]])
  })
})

describe('keeper value report: one player against his cost', () => {
  it('is the middle of his cost round minus his market rank; unpriced players have none', async () => {
    const { keeperValue } = await import('@/lib/keeper/missedDeadline')
    expect(keeperValue(9, 10, 12)).toEqual({ marketRank: 10, pickSlot: 102, surplus: 92 })
    expect(keeperValue(3, 80, 12)).toEqual({ marketRank: 80, pickSlot: 30, surplus: -50 })
    expect(keeperValue(null, 10, 12)).toBeNull()
    expect(keeperValue(5, null, 12)).toBeNull()
  })
})
