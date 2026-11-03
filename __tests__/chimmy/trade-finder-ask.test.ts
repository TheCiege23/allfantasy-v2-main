import { describe, expect, it } from 'vitest'
import { mentionsDraftPicks, readTradeFinderGoal } from '@/lib/chimmy/tradeFinderAsk'

describe('readTradeFinderGoal', () => {
  it.each([
    'find me 3 win now trades using my draft picks and a lesser player in versuz',
    'I want to win-now',
    'trades to help me contend',
    'who can help me this season?',
    'need a playoff push trade',
    'I am going all in',
  ])('reads win now from %s', (q) => expect(readTradeFinderGoal(q)).toBe('win_now'))
  it.each(['find me a trade', 'who should I trade with for a RB', 'trade ideas for my dynasty rebuild', 42])(
    'does not guess a goal from %s',
    (q) => expect(readTradeFinderGoal(q)).toBeNull(),
  )
})

describe('mentionsDraftPicks', () => {
  it.each([
    'using my draft picks',
    'add a pick',
    'a 2nd round pick',
    'my 1st',
    'u didnt consider a 2 or 3 for my 1st round pick',
    'throw in a first-rounder',
  ])('hears picks offered in %s', (q) => expect(mentionsDraftPicks(q)).toBe(true))
  it.each(['who should I pick up?', 'find me a trade for a WR', null])('does not hear picks in %s', (q) => expect(mentionsDraftPicks(q)).toBe(false))
})
