// @vitest-environment node
/**
 * Guards the bubble rule this tournament actually runs.
 *
 * 🛑 NEITHER IMPLEMENTATION MATCHED THE COMMISSIONER'S OWN SHEET, which says
 * *"Rankings 59-64 + Top 6 Scorers from Rankings 65-120"*. Both the engine and
 * the standings board treated the bubble as a window of the next N managers
 * BELOW the cut, so:
 *
 *   - seeds 59-64 were already through, when the rule has them defending; and
 *   - the challengers were the next few by RANK, when the rule names the top
 *     SCORERS — and rank is wins-first, so those are different people.
 *
 * Twelve compete for six places. The old rule had six of those twelve already
 * safe and a different six fighting for a different set of spots.
 */
import { describe, it, expect } from 'vitest'
import { bubbleWinnerCount, composeBubble } from '@/lib/tournament/bubbleComposition'

type Row = { name: string; wins: number; points: number }

/** Standings order: wins first, then points — the order the engine ranks on. */
function ranked(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => b.wins - a.wins || b.points - a.points)
}

const opts = (over: Partial<Parameters<typeof composeBubble<Row>>[1]> = {}) => ({
  cut: 4,
  bubbleSize: 2,
  enabled: true,
  pointsOf: (r: Row) => r.points,
  ...over,
})

describe('who defends and who attacks', () => {
  const field = ranked([
    { name: 'a', wins: 9, points: 1000 },
    { name: 'b', wins: 8, points: 990 },
    { name: 'c', wins: 7, points: 980 },
    { name: 'd', wins: 6, points: 970 },
    { name: 'e', wins: 5, points: 960 },
    { name: 'f', wins: 4, points: 950 },
  ])

  /** 🛑 The bottom of the cut is at risk, not through. */
  it('puts the last of the qualifiers into the bubble', () => {
    const out = composeBubble(field, opts())
    expect(out.safe.map((r) => r.name)).toEqual(['a', 'b'])
    expect(out.atRisk.map((r) => r.name)).toEqual(['c', 'd'])
  })

  it('takes the same number from each side, for that many places', () => {
    const out = composeBubble(field, opts())
    expect(out.atRisk).toHaveLength(2)
    expect(out.challengers).toHaveLength(2)
    expect(bubbleWinnerCount(2)).toBe(2)
  })

  it('eliminates everyone below the cut who is not a challenger', () => {
    const out = composeBubble(field, opts({ bubbleSize: 1 }))
    expect(out.challengers.map((r) => r.name)).toEqual(['e'])
    expect(out.eliminated.map((r) => r.name)).toEqual(['f'])
  })
})

/**
 * 🛑 THE HALF A RANK-WINDOW GETS WRONG. Rank is wins-first, so the highest
 * scorer below the line is frequently not the next name in the standings — and
 * "top scorers from 65-120" means exactly that person.
 */
describe('challengers are chosen on points, not rank', () => {
  const field = ranked([
    { name: 'winner1', wins: 9, points: 900 },
    { name: 'winner2', wins: 8, points: 880 },
    /* Next by RANK below the cut, but scored least of anyone. */
    { name: 'grinder', wins: 5, points: 300 },
    /* Worst record in the field, outscored everybody. */
    { name: 'slugger', wins: 0, points: 2000 },
  ])

  it('picks the top scorer below the line over the next by rank', () => {
    const out = composeBubble(field, opts({ cut: 2, bubbleSize: 1 }))
    expect(out.challengers.map((r) => r.name)).toEqual(['slugger'])
    expect(out.eliminated.map((r) => r.name)).toEqual(['grinder'])
  })

  /** ⚠ And the same field under a rank window would have picked the other one. */
  it('differs from a rank window on the same field', () => {
    const below = field.slice(2)
    const rankWindow = below.slice(0, 1).map((r) => r.name)
    const out = composeBubble(field, opts({ cut: 2, bubbleSize: 1 }))
    expect(rankWindow).toEqual(['grinder'])
    expect(out.challengers.map((r) => r.name)).not.toEqual(rankWindow)
  })
})

describe('degenerate settings', () => {
  const field = ranked([
    { name: 'a', wins: 3, points: 30 },
    { name: 'b', wins: 2, points: 20 },
    { name: 'c', wins: 1, points: 10 },
  ])

  it('puts nobody at risk when the bubble is off', () => {
    const out = composeBubble(field, opts({ cut: 2, enabled: false }))
    expect(out.safe.map((r) => r.name)).toEqual(['a', 'b'])
    expect(out.atRisk).toEqual([])
    expect(out.challengers).toEqual([])
    expect(out.eliminated.map((r) => r.name)).toEqual(['c'])
  })

  it('treats a zero bubble the same as off', () => {
    const out = composeBubble(field, opts({ cut: 2, bubbleSize: 0 }))
    expect(out.atRisk).toEqual([])
    expect(out.eliminated.map((r) => r.name)).toEqual(['c'])
  })

  /**
   * ⚠ A bubble bigger than the cut it defends must not leave nobody through —
   * that is a misconfiguration, not a rule, and it should degrade rather than
   * produce a tournament with no qualifiers.
   */
  it('never puts the entire cut at risk beyond its size', () => {
    const out = composeBubble(field, opts({ cut: 1, bubbleSize: 5 }))
    expect(out.safe).toEqual([])
    expect(out.atRisk.map((r) => r.name)).toEqual(['a'])
    expect(out.challengers.map((r) => r.name)).toEqual(['b', 'c'])
  })

  it('handles a cut larger than the field', () => {
    const out = composeBubble(field, opts({ cut: 99, bubbleSize: 1 }))
    expect(out.eliminated).toEqual([])
    expect(out.atRisk.map((r) => r.name)).toEqual(['c'])
  })

  it('handles an empty field', () => {
    const out = composeBubble([] as Row[], opts())
    expect(out).toEqual({ safe: [], atRisk: [], challengers: [], eliminated: [] })
  })
})
