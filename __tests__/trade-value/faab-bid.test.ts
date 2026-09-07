import { describe, expect, it } from 'vitest'

import { allocateFaabAcrossPool, type FaabCandidate } from '@/lib/trade-intel/faabBid'
import { survivorHorizon, SURVIVOR_ALL_STARS_2026 } from '@/lib/trade-intel/survivorSchedule'

const S = SURVIVOR_ALL_STARS_2026

/*
 * The real week-11 pool, measured against the live league: Quintavius "Q" Burdette is the lowest
 * rostered value, so under the league's own rule his roster hits waivers. `replacedValue` is
 * BDog256's weakest starter at each slot — QB 1340, RB 1710, WR 1203, TE 2933.
 */
const POOL: FaabCandidate[] = [
  { id: 'london', name: 'Drake London', position: 'WR', playerValue: 5205, replacedValue: 1203 },
  { id: 'kyren', name: 'Kyren Williams', position: 'RB', playerValue: 4798, replacedValue: 1710 },
  { id: 'maye', name: 'Drake Maye', position: 'QB', playerValue: 3213, replacedValue: 1340 },
  { id: 'kincaid', name: 'Dalton Kincaid', position: 'TE', playerValue: 728, replacedValue: 2933 },
  { id: 'ajones', name: 'Aaron Jones', position: 'RB', playerValue: 536, replacedValue: 1710 },
  { id: 'kallen', name: 'Keenan Allen', position: 'WR', playerValue: 155, replacedValue: 1203 },
]

const bidFor = (a: { bids: Array<{ id: string; ceiling: number }> }, id: string) =>
  a.bids.find((b) => b.id === id)!.ceiling

describe('allocateFaabAcrossPool — the question this league actually asks', () => {
  it('🛑 A NON-UPGRADE IS ZERO, whatever the name on the shirt', () => {
    const a = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    // Kincaid is a name people bid on. Against a 2,933-point tight end already starting, he is nothing.
    expect(bidFor(a, 'kincaid')).toBe(0)
    expect(bidFor(a, 'ajones')).toBe(0)
    expect(bidFor(a, 'kallen')).toBe(0)
    expect(a.bids.find((b) => b.id === 'kincaid')!.reason).toMatch(/does not improve your starting lineup/)
  })

  it('🛑 THE WHOLE POINT: no upgrade costs the entire budget any more', () => {
    /*
     * The fixed-anchor version priced all three of these at $1000 — at $1000, $400 and $120 of
     * remaining budget alike. That is what this replaced, so it is asserted rather than described.
     */
    const a = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    for (const id of ['london', 'kyren', 'maye']) {
      expect(bidFor(a, id), id).toBeGreaterThan(0)
      expect(bidFor(a, id), id).toBeLessThan(1000)
    }
    expect(bidFor(a, 'london')).toBe(112)
    expect(bidFor(a, 'kyren')).toBe(86)
    expect(bidFor(a, 'maye')).toBe(52)
  })

  it('the whole pool sums to exactly one week of budget — the constraint falls out, not imposed', () => {
    const a = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    const total = a.bids.reduce((s, b) => s + b.ceiling, 0)
    expect(a.weekBudget).toBe(250) // $1000 across 4.0 expected weeks
    expect(total).toBeGreaterThan(a.weekBudget - 3)
    expect(total).toBeLessThanOrEqual(a.weekBudget)
  })

  it('ranks by how much each man actually improves YOU, not by chart value', () => {
    const a = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    expect(bidFor(a, 'london')).toBeGreaterThan(bidFor(a, 'kyren'))
    expect(bidFor(a, 'kyren')).toBeGreaterThan(bidFor(a, 'maye'))
  })

  it('⚠ the same player is worth different money to a different team — margin, not value', () => {
    /* A team already strong at receiver should not pay for London at all. */
    const deep = POOL.map((c) => (c.id === 'london' ? { ...c, replacedValue: 5205 } : c))
    const a = allocateFaabAcrossPool({ pool: deep, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    expect(bidFor(a, 'london')).toBe(0)
    // And the money it frees goes to the men who DO improve them.
    const before = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    expect(bidFor(a, 'kyren')).toBeGreaterThan(bidFor(before, 'kyren'))
  })

  it('⚠ scales with the money you actually have', () => {
    const rich = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    const poor = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 120, horizon: survivorHorizon(S, 11) })!
    expect(bidFor(poor, 'london')).toBeLessThan(bidFor(rich, 'london'))
    expect(bidFor(poor, 'london')).toBeGreaterThan(0)
    expect(poor.bids.reduce((s, b) => s + b.ceiling, 0)).toBeLessThanOrEqual(120)
  })

  it('🛑 the endgame: on the last week the pool gets EVERYTHING, because unspent FAAB scores nothing', () => {
    const wk11 = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 11) })!
    const wk17 = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, 17) })!
    expect(wk17.weeksAssumed).toBe(1)
    expect(wk17.weekBudget).toBe(1000)
    expect(bidFor(wk17, 'london')).toBe(447)
    expect(bidFor(wk17, 'london')).toBeGreaterThan(bidFor(wk11, 'london'))
    // Still never on a man who makes you worse.
    expect(bidFor(wk17, 'kincaid')).toBe(0)
  })

  it('rises monotonically as the season shortens — the pacing is the only thing moving', () => {
    let prev = -1
    for (const w of [1, 5, 9, 11, 14, 17]) {
      const a = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: survivorHorizon(S, w) })!
      expect(bidFor(a, 'london'), `week ${w}`).toBeGreaterThan(prev)
      prev = bidFor(a, 'london')
    }
  })

  it('⚠ [control] a pool with no upgrades allocates nothing at all', () => {
    /* The budget is not "use it or lose it" on rubbish — the endgame argument must not become
     * "spend it on anything". */
    const junk = POOL.filter((c) => ['kincaid', 'ajones', 'kallen'].includes(c.id))
    const a = allocateFaabAcrossPool({ pool: junk, budgetRemaining: 1000, horizon: survivorHorizon(S, 17) })!
    expect(a.supplyValue).toBe(0)
    expect(a.bids.every((b) => b.ceiling === 0)).toBe(true)
  })

  it('with no schedule, prices against the whole budget and SAYS SO', () => {
    const a = allocateFaabAcrossPool({ pool: POOL, budgetRemaining: 1000, horizon: null })!
    expect(a.paced).toBe(false)
    expect(a.weeksAssumed).toBe(1)
    expect(a.reason).toMatch(/no schedule to pace against/)
    expect(bidFor(a, 'london')).toBe(447)
  })

  it('🛑 returns NULL, not zeros, when it cannot tell — and does not price a player it cannot read', () => {
    expect(allocateFaabAcrossPool({ pool: POOL, budgetRemaining: Number.NaN, horizon: null })).toBeNull()
    expect(allocateFaabAcrossPool({ pool: POOL, budgetRemaining: -1, horizon: null })).toBeNull()

    const broken = [...POOL, { id: 'x', name: 'Unknown', position: 'WR', playerValue: Number.NaN, replacedValue: 0 }]
    const a = allocateFaabAcrossPool({ pool: broken, budgetRemaining: 1000, horizon: null })!
    const x = a.bids.find((b) => b.id === 'x')!
    expect(x.ceiling).toBe(0)
    expect(x.reason).toMatch(/not priced, rather than priced at zero/)
    // And an unreadable man must not dilute everyone else's share.
    expect(bidFor(a, 'london')).toBe(447)
  })
})
