import { describe, expect, it } from 'vitest'
import { buildPickOwnerResolver, resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'

/* Scale (2026-11-24): the board resolves every cell through an index built once; the answers must not change. */
describe('buildPickOwnerResolver', () => {
  it('gives exactly resolvePickOwner’s answer for every cell, latest trade winning', () => {
    const teams = 40
    const slotOrder = Array.from({ length: teams }, (_, i) => ({ slot: i + 1, rosterId: `r${i + 1}`, displayName: `Team ${i + 1}` }))
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const tradedPicks = Array.from({ length: 300 }, () => {
      const from = rnd(teams) + 1
      const to = rnd(teams) + 1
      return { round: rnd(12) + 1, originalRosterId: `r${from}`, previousOwnerName: `Team ${from}`, newRosterId: `r${to}`, newOwnerName: `Team ${to}` }
    })
    const fast = buildPickOwnerResolver(slotOrder, tradedPicks as never)
    for (let round = 1; round <= 12; round++) {
      for (let slot = 0; slot <= teams + 1; slot++) {
        expect(fast(round, slot)).toEqual(resolvePickOwner(round, slot, slotOrder, tradedPicks as never))
      }
    }
  })
})
