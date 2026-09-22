import { describe, expect, it } from 'vitest'

import { extractPickMentions, pickLabel } from '@/lib/chimmy/tradePickMentions'

describe('extractPickMentions', () => {
  it.each([
    ['my 2027 1st', [{ season: 2027, round: 1 }]],
    ['Puka Nacua and a 2026 second', [{ season: 2026, round: 2 }]],
    ['a 2028 first-round pick', [{ season: 2028, round: 1 }]],
    ['my 2027 2nd rounder and Bijan', [{ season: 2027, round: 2 }]],
    ['two 2027 1sts', [{ season: 2027, round: 1 }, { season: 2027, round: 1 }]],
    ['a 2027 1st and a 2028 3rd', [{ season: 2027, round: 1 }, { season: 2028, round: 3 }]],
  ])('reads %s', (text, expected) => {
    const r = extractPickMentions(text)
    expect(r.unclear).toBe(false)
    expect(r.picks.map(({ season, round }) => ({ season, round }))).toEqual(expected)
  })

  it('reports a pick with no year as season null, never a guessed year', () => {
    const r = extractPickMentions('Puka Nacua and a 1st')
    expect(r.picks).toEqual([expect.objectContaining({ season: null, round: 1 })])
  })

  it.each(['Puka Nacua and picks', 'Puka Nacua and 1sts', 'Puka Nacua plus draft capital', 'Puka Nacua and two future firsts'])(
    'is unclear about %s rather than dropping it',
    (text) => {
      expect(extractPickMentions(text).unclear).toBe(true)
    },
  )

  it.each(['Puka Nacua first, or wait?', "Puka Nacua? I'm in 1st place", 'on 3rd down', 'my 2nd string RB'])(
    'finds no pick in %s',
    (text) => {
      const r = extractPickMentions(text)
      expect(r.picks).toEqual([])
      expect(r.unclear).toBe(false)
    },
  )

  it('labels picks the way the scenario card shows them', () => {
    expect(pickLabel({ season: 2027, round: 1 })).toBe('2027 1st-round pick')
    expect(pickLabel({ season: 2026, round: 3 })).toBe('2026 3rd-round pick')
  })
})
