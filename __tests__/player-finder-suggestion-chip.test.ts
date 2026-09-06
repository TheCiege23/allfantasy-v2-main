import { describe, expect, it } from 'vitest'

import { suggestionChip } from '@/lib/core-app/suggestionChip'

/* One fact per chip: yours beats owned beats free; an unreadable league says nothing. */
describe('suggestionChip', () => {
  it('names the league when there is one, counts them when there are more', () => {
    expect(suggestionChip({ yours: ['Dynasty Dragons'], owned: [], free: [], unchecked: 0 })).toEqual({ text: 'yours in Dynasty Dragons', tone: 'accent' })
    expect(suggestionChip({ yours: ['A', 'B', 'C'], owned: [], free: [], unchecked: 0 })).toEqual({ text: 'yours in 3 leagues', tone: 'accent' })
    expect(suggestionChip({ yours: [], owned: [{ leagueName: 'Gridiron Gang', ownerName: 'tashaR' }], free: ['X'], unchecked: 0 })).toEqual({ text: '@tashaR has him in Gridiron Gang', tone: 'warn' })
    expect(suggestionChip({ yours: [], owned: [{ leagueName: 'Gridiron Gang', ownerName: null }], free: [], unchecked: 0 })).toEqual({ text: 'owned in Gridiron Gang', tone: 'warn' })
    expect(suggestionChip({ yours: [], owned: [{ leagueName: 'A', ownerName: 'x' }, { leagueName: 'B', ownerName: 'y' }], free: [], unchecked: 0 })).toEqual({ text: 'owned in 2 of your leagues', tone: 'warn' })
    expect(suggestionChip({ yours: [], owned: [], free: ['Gridiron Gang'], unchecked: 2 })).toEqual({ text: 'free in Gridiron Gang', tone: 'good' })
    expect(suggestionChip({ yours: [], owned: [], free: ['A', 'B', 'C', 'D'], unchecked: 0 })).toEqual({ text: 'free in 4 leagues', tone: 'good' })
  })

  /* ⚠ "Unchecked" is not a chip. Nothing we could read means nothing to say. */
  it('says nothing when every league was unreadable, or when signed out', () => {
    expect(suggestionChip({ yours: [], owned: [], free: [], unchecked: 3 })).toBeNull()
    expect(suggestionChip(null)).toBeNull()
    expect(suggestionChip(undefined)).toBeNull()
  })
})
