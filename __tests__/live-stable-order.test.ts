import { describe, expect, it } from 'vitest'

import { applyStableOrder, orderOf } from '@/lib/live/stableOrder'

/*
 * Holding the slate still.
 *
 * What this prevents is NOT a score moving a card — it is the CLOCK doing it. The
 * server breaks ties on closeness, closeness comes from win probability, and win
 * probability reads the game clock. Two evenly matched games therefore swap places
 * every twenty seconds while nobody scores, and the card under the reader's thumb
 * moves for a reason they cannot perceive.
 */

type Row = { id: string }
const key = (r: Row) => r.id
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }))

describe('applyStableOrder', () => {
  it('uses the server order when nothing is remembered', () => {
    expect(applyStableOrder(null, rows('a', 'b', 'c'), key).map(key)).toEqual(['a', 'b', 'c'])
  })

  it('treats an empty remembered order as nothing remembered', () => {
    expect(applyStableOrder([], rows('a', 'b'), key).map(key)).toEqual(['a', 'b'])
  })

  it('keeps the remembered order when the server reshuffles', () => {
    expect(applyStableOrder(['a', 'b', 'c'], rows('c', 'a', 'b'), key).map(key)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('appends a new game at the end rather than inserting it under the reader', () => {
    expect(applyStableOrder(['a', 'b'], rows('b', 'new', 'a'), key).map(key)).toEqual([
      'a',
      'b',
      'new',
    ])
  })

  it('keeps several new games in the server order behind the remembered ones', () => {
    expect(applyStableOrder(['a'], rows('x', 'a', 'y'), key).map(key)).toEqual(['a', 'x', 'y'])
  })

  it('drops a game that is gone without disturbing the rest', () => {
    expect(applyStableOrder(['a', 'b', 'c'], rows('c', 'a'), key).map(key)).toEqual(['a', 'c'])
  })

  it('never loses or duplicates a row', () => {
    const next = rows('d', 'b', 'a', 'c')
    const out = applyStableOrder(['a', 'b'], next, key)
    expect(out).toHaveLength(next.length)
    expect(new Set(out.map(key))).toEqual(new Set(next.map(key)))
  })

  it('survives a duplicated key in the remembered order', () => {
    expect(applyStableOrder(['a', 'a', 'b'], rows('b', 'a'), key).map(key)).toEqual(['a', 'b'])
  })

  it('is a no-op when the server agrees with what we remember', () => {
    expect(applyStableOrder(['a', 'b'], rows('a', 'b'), key).map(key)).toEqual(['a', 'b'])
  })
})

describe('orderOf', () => {
  it('captures the order to remember', () => {
    expect(orderOf(rows('a', 'b'), key)).toEqual(['a', 'b'])
  })
})
