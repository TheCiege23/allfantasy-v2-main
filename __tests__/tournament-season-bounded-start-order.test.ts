import { describe, expect, it } from 'vitest'
import { assessSeasonBoundedStartOrder } from '@/lib/tournament/seasonBoundedStartOrder'

describe('bounded game-start ordering for NBA caps', () => {
  it('orders only disjoint possible-start windows, including touching bounds', () => {
    expect(assessSeasonBoundedStartOrder([
      { gameId: 'b', startAfter: '2026-10-21T00:10:00Z', startedBy: '2026-10-21T00:15:00Z' },
      { gameId: 'a', startAfter: '2026-10-21T00:00:00Z', startedBy: '2026-10-21T00:10:00Z' },
    ])).toEqual({ canOrder: true, orderedGameIds: ['a', 'b'], ambiguousPairs: [] })
  })
  it('blocks overlapping windows rather than inventing NBA cap order', () => {
    expect(assessSeasonBoundedStartOrder([
      { gameId: 'a', startAfter: '2026-10-21T00:00:00Z', startedBy: '2026-10-21T00:05:00Z' },
      { gameId: 'b', startAfter: '2026-10-21T00:03:00Z', startedBy: '2026-10-21T00:08:00Z' },
    ])).toEqual({ canOrder: false, orderedGameIds: null, ambiguousPairs: [['a', 'b']] })
  })
  it('rejects duplicate games or inverted windows', () => {
    const game = { gameId: 'a', startAfter: '2026-10-21T00:05:00Z', startedBy: '2026-10-21T00:00:00Z' }
    expect(() => assessSeasonBoundedStartOrder([game])).toThrow('valid observed start window')
    expect(() => assessSeasonBoundedStartOrder([{ ...game, startedBy: '2026-10-21T00:06:00Z' }, { ...game, startedBy: '2026-10-21T00:07:00Z' }])).toThrow('unique')
  })
})
