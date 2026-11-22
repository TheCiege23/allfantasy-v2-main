import { describe, expect, it } from 'vitest'

import { MAX_MARKET_EVIDENCE, marketEvidenceOf } from '@/lib/chimmy/marketEvidence'

describe('marketEvidenceOf', () => {
  it('keeps measured reasons (trade market, learned tables, lineup factors), drops the rest, dedupes, caps', () => {
    const moves = [
      { name: 'A', reasons: ['Lineup +9%: in leagues that start more tight ends than usual (this one: 2 TE), tight ends trade 9% higher — measured across 260 trades in 31 leagues'] },
      { name: 'A', reasons: ['Lineup +9%: in leagues that start more tight ends than usual (this one: 2 TE), tight ends trade 9% higher — measured across 260 trades in 31 leagues.'] },
      { name: 'B', reasons: ['Half-PPR scoring', 'you cannot fill 1 TE slot and there is no TE available on waivers'] },
    ]
    expect(marketEvidenceOf({ moves })).toEqual([`A: ${moves[0]!.reasons[0]}`])
    // The trade market names the book between "completed" and "trades".
    const market = 'AllFantasy trade market +6%: what managers actually paid for him across 41 completed Dynasty · 1QB trades in AllFantasy-connected leagues'
    expect(marketEvidenceOf({ moves: [{ name: 'C', reasons: [market] }] })).toEqual([`C: ${market}`])
    // A reason that merely mentions trades is not measured evidence.
    expect(marketEvidenceOf({ moves: [{ name: 'D', reasons: ['trades well in superflex'] }] })).toEqual([])
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, reasons: ['x across 5 completed trades'] }))
    expect(marketEvidenceOf({ moves: many })).toHaveLength(MAX_MARKET_EVIDENCE)
    expect(marketEvidenceOf({})).toEqual([])
  })
})
