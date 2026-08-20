import { describe, it, expect } from 'vitest'
import { runWeightedDraw, seededRandom } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'

/**
 * The lottery PUBLISHES odds. Draft HQ prints "28.6%" next to a team name, and the whole
 * premise — "removing the reason to tank" — rests on those numbers being the real ones.
 *
 * Determinism and auditability are already covered by the seed. This covers the thing a
 * seed cannot: whether the generator actually produces the distribution it advertises. A
 * lottery whose true odds differ from its published odds is the single bug that would
 * permanently destroy trust in a commissioner tool, and it is invisible in any single run.
 *
 * The generator is `Math.sin(x) * 10000`, fractional part — a known-questionable uniform
 * source. These measure it rather than assume either way.
 */

// The design's own ladder: 6/5/4/3/2/1 balls over 21 total.
const TEAMS = [
  { rosterId: 'sack', displayName: 'Sack Exchange', weight: 6, expected: 6 / 21 },
  { rosterId: 'chain', displayName: 'Chain Movers', weight: 5, expected: 5 / 21 },
  { rosterId: 'dre', displayName: '@dre', weight: 4, expected: 4 / 21 },
  { rosterId: 'redz', displayName: 'Red Zone Rebels', weight: 3, expected: 3 / 21 },
  { rosterId: 'ghosts', displayName: 'Gridiron Ghosts', weight: 2, expected: 2 / 21 },
  { rosterId: 'jay', displayName: '@jaythe3rd', weight: 1, expected: 1 / 21 },
] as const

const N = 40000

function firstPickFrequencies(seedPrefix: string) {
  const wins: Record<string, number> = {}
  for (const t of TEAMS) wins[t.rosterId] = 0
  for (let i = 0; i < N; i++) {
    const draws = runWeightedDraw(TEAMS as never, 4, `${seedPrefix}-${i}`)
    const first = draws[0]
    if (first) wins[first.rosterId] = (wins[first.rosterId] ?? 0) + 1
  }
  return wins
}

describe('draft lottery: published odds must be the real odds', () => {
  it('every team wins pick 1 at close to its stated rate', () => {
    const wins = firstPickFrequencies('fairness')
    const drift: Array<[string, number]> = []
    for (const t of TEAMS) {
      const observed = wins[t.rosterId] / N
      drift.push([t.displayName, (observed - t.expected) * 100])
    }
    // Two points of slack at n=40k. Sampling noise on the smallest bucket (1 ball, 4.8%)
    // is well under half a point, so anything beyond 2 is the generator, not variance.
    for (const [name, d] of drift) {
      expect(Math.abs(d), `${name} drifted ${d.toFixed(2)} points from its published odds`).toBeLessThan(2)
    }
  })

  it('preserves the ordering — more balls never wins less often', () => {
    const wins = firstPickFrequencies('ordering')
    const counts = TEAMS.map((t) => wins[t.rosterId])
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i - 1], `team ${i} with more balls won less often than team ${i + 1}`).toBeGreaterThan(counts[i])
    }
  })

  it('never returns the same team twice — the draw is without replacement', () => {
    for (let i = 0; i < 500; i++) {
      const draws = runWeightedDraw(TEAMS as never, 4, `norepeat-${i}`)
      const ids = draws.map((d) => d.rosterId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('is reproducible from the seed — the audit claim', () => {
    const a = runWeightedDraw(TEAMS as never, 4, 'audit-me')
    const b = runWeightedDraw(TEAMS as never, 4, 'audit-me')
    expect(a).toEqual(b)
  })

  it('different seeds give different orders — it is not a fixed sequence', () => {
    const orders = new Set(
      Array.from({ length: 200 }, (_, i) => runWeightedDraw(TEAMS as never, 4, `vary-${i}`).map((d) => d.rosterId).join('>')),
    )
    expect(orders.size).toBeGreaterThan(5)
  })
})

describe('draft lottery: the underlying generator', () => {
  it('is uniform across ten buckets', () => {
    const rng = seededRandom('uniformity')
    const M = 120000
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < M; i++) buckets[Math.min(9, Math.floor(rng() * 10))] += 1
    const expected = M / 10
    const chi = buckets.reduce((s, b) => s + (b - expected) ** 2 / expected, 0)
    // 9 degrees of freedom: 21.67 is p=0.01. A generator failing this is not uniform.
    expect(chi, `chi-square ${chi.toFixed(1)} over buckets ${buckets.join(',')}`).toBeLessThan(21.67)
  })

  it('stays inside [0,1)', () => {
    const rng = seededRandom('bounds')
    for (let i = 0; i < 50000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
