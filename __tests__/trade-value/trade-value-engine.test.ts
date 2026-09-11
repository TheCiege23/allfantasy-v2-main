import { describe, it, expect } from 'vitest'
import {
  normalizedPlayerValue,
  normalizedPickValue,
  normalizedFaabValue,
  scarcityFor,
  FAAB_VALUE_PER_DOLLAR,
  FAAB_FULL_BUDGET_VALUE,
} from '@/lib/trade-value/valueEngine'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'
import { gradeTrade } from '@/lib/trade-value/grader'
import { buildTradeValueSnapshot } from '@/lib/trade-value/snapshot'
import type { SideTotals } from '@/lib/trade-value/types'

describe('valueEngine', () => {
  it('is deterministic and monotonic in projection', () => {
    const lo = normalizedPlayerValue({ projection: 100, position: 'WR' })
    const hi = normalizedPlayerValue({ projection: 250, position: 'WR' })
    expect(hi).toBeGreaterThan(lo)
    expect(normalizedPlayerValue({ projection: 250, position: 'WR' })).toBe(hi) // stable
  })

  it('applies positional scarcity (RB premium over QB at equal projection)', () => {
    expect(scarcityFor('RB')).toBeGreaterThan(scarcityFor('QB'))
    const rb = normalizedPlayerValue({ projection: 200, position: 'RB' })
    const qb = normalizedPlayerValue({ projection: 200, position: 'QB' })
    expect(rb).toBeGreaterThan(qb)
  })

  /**
   * ⚠ UPDATED BY 1.7f. This previously asserted `toBe(10000)` for an absurd 9,999-point
   * projection, which pinned the HARD CLAMP — the behaviour that made four different elite
   * superflex quarterbacks all price at exactly 10000. The stated requirement, in this test's own
   * name, is that values stay inside 0..10000, and the soft knee still satisfies it (9992).
   *
   * So the bound is kept and STRENGTHENED: two absurd projections must now remain ORDERED, which
   * the hard clamp could not do at all. This test is harder to pass than it was, not easier.
   */
  it('gives a small premium for lower ADP and stays within 0..10000', () => {
    const early = normalizedPlayerValue({ projection: 150, adp: 5, position: 'WR' })
    const late = normalizedPlayerValue({ projection: 150, adp: 200, position: 'WR' })
    expect(early).toBeGreaterThan(late)

    const huge = normalizedPlayerValue({ projection: 9999, position: 'RB' })
    expect(huge).toBeLessThanOrEqual(10000)
    expect(huge).toBeGreaterThan(9900)

    // The property the hard clamp destroyed: bigger is still bigger, even above the ceiling.
    expect(normalizedPlayerValue({ projection: 19999, position: 'RB' })).toBeGreaterThan(huge)

    expect(normalizedPlayerValue({ projection: 0, position: 'WR' })).toBeGreaterThanOrEqual(0)
  })

  it('values picks by round with future-season discount', () => {
    expect(normalizedPickValue({ round: 1 })).toBeGreaterThan(normalizedPickValue({ round: 3 }))
    const now = normalizedPickValue({ round: 1, pickSeason: 2026, currentSeason: 2026 })
    const future = normalizedPickValue({ round: 1, pickSeason: 2028, currentSeason: 2026 })
    expect(future).toBeLessThan(now)
  })

  /*
   * ⚠ THE ASSERTION HERE USED TO BE `normalizedFaabValue(10) === 10 * FAAB_VALUE_PER_DOLLAR`,
   * and once both sides came from the same module it could not fail — it would have stayed green
   * with the constant set to anything at all. These pin NUMBERS, so changing the conversion has
   * to be a deliberate edit to this file.
   */
  it('prices FAAB against the budget it comes out of', () => {
    // The $100 budget is the pre-2026-09-11 canonical calibration, preserved byte-for-byte.
    expect(normalizedFaabValue(10, 100)).toBe(180)
    expect(normalizedFaabValue(25, 100)).toBe(450)
    expect(normalizedFaabValue(10)).toBe(180) // unknown budget ⇒ FAAB_DEFAULT_BUDGET
    expect(FAAB_VALUE_PER_DOLLAR).toBe(18) // the per-dollar rate AT that default budget

    // The whole point: the same $10 is a smaller slice of a bigger budget.
    expect(normalizedFaabValue(10, 1000)).toBe(18)
    expect(normalizedFaabValue(10, 50)).toBe(360)

    // A full budget is a full budget whatever its face value, and caps there.
    expect(normalizedFaabValue(100, 100)).toBe(FAAB_FULL_BUDGET_VALUE)
    expect(normalizedFaabValue(1000, 1000)).toBe(FAAB_FULL_BUDGET_VALUE)
    expect(normalizedFaabValue(600, 100)).toBe(FAAB_FULL_BUDGET_VALUE)
  })

  it('refuses to invent value from a missing or nonsense input', () => {
    expect(normalizedFaabValue(0, 100)).toBe(0)
    expect(normalizedFaabValue(null, 100)).toBe(0)
    expect(normalizedFaabValue(undefined, 100)).toBe(0)
    expect(normalizedFaabValue(-5, 100)).toBe(0)
    // A non-positive or non-finite budget falls back rather than dividing by it.
    expect(normalizedFaabValue(10, 0)).toBe(180)
    expect(normalizedFaabValue(10, Number.NaN)).toBe(180)
  })
})

describe('teamProfile', () => {
  it('classifies a winning top-seed team as contender', () => {
    const p = buildTeamProfile({ rosterId: 'r1', wins: 8, losses: 2, pointsFor: 1200, playoffSeed: 1, leagueSize: 12, positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'] })
    expect(p.stance).toBe('contender')
  })
  it('classifies a losing team as rebuilder and flags depth issues', () => {
    const p = buildTeamProfile({ rosterId: 'r2', wins: 2, losses: 8, pointsFor: 800, playoffSeed: 11, leagueSize: 12, positions: ['QB', 'WR'] })
    expect(p.stance).toBe('rebuilder')
    expect(p.weakPositions).toContain('RB')
    expect(p.depthIssues).toBe(true)
  })
})

const side = (rosterId: string, vals: number[]): SideTotals => ({
  rosterId,
  total: vals.reduce((s, v) => s + v, 0),
  assets: vals.map((v, i) => ({
    kind: 'player', fromRosterId: rosterId, toRosterId: 'other', playerId: `p${i}`, position: 'WR',
    sources: { projectionValue: 100, rankingValue: null, adpValue: null, fantasyCalcValue: null },
    internalValue: v,
  })),
})

describe('grader', () => {
  it('grades an even trade high with a within-market bullet', () => {
    const { grade } = gradeTrade(side('a', [5000]), side('b', [4900]))
    expect(grade.fairnessScore).toBeGreaterThanOrEqual(95)
    expect(['A+', 'A']).toContain(grade.grade)
    expect(grade.bullets.join(' ')).toMatch(/normal market range/i)
  })

  it('grades a lopsided trade low and flags commissioner review', () => {
    const { grade, commissionerReview } = gradeTrade(side('a', [9000]), side('b', [1000]))
    expect(grade.fairnessScore).toBeLessThan(40)
    expect(grade.grade).toBe('F')
    expect(commissionerReview.lopsided).toBe(true)
    expect(commissionerReview.reviewRecommended).toBe(true)
    expect(grade.bullets.join(' ')).toMatch(/significantly uneven/i)
  })
})

describe('snapshot', () => {
  it('builds a two-sided snapshot with totals + grade and is deterministic', () => {
    const snap = buildTradeValueSnapshot({
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      currentSeason: 2026,
      context: { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: '2026-06-21T00:00:00Z' },
      assets: [
        { kind: 'player', fromRosterId: 'A', toRosterId: 'B', playerId: 'x', position: 'RB', sources: { projectionValue: 220, rankingValue: null, adpValue: 12, fantasyCalcValue: null } },
        { kind: 'faab', fromRosterId: 'B', toRosterId: 'A', faabAmount: 20, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null } },
      ],
    })
    expect(snap.sides).toHaveLength(2)
    expect(snap.sides[0]!.rosterId).toBe('A')
    expect(snap.sides[0]!.total).toBeGreaterThan(0)
    expect(snap.sides[1]!.total).toBe(20 * FAAB_VALUE_PER_DOLLAR)
    expect(typeof snap.grade.grade).toBe('string')
    // determinism
    const again = buildTradeValueSnapshot({
      proposerRosterId: 'A', receiverRosterId: 'B', currentSeason: 2026,
      context: { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: '2026-06-21T00:00:00Z' },
      assets: [
        { kind: 'player', fromRosterId: 'A', toRosterId: 'B', playerId: 'x', position: 'RB', sources: { projectionValue: 220, rankingValue: null, adpValue: 12, fantasyCalcValue: null } },
        { kind: 'faab', fromRosterId: 'B', toRosterId: 'A', faabAmount: 20, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null } },
      ],
    })
    expect(again.sides[0]!.total).toBe(snap.sides[0]!.total)
  })
})
