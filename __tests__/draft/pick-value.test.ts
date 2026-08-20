import { describe, it, expect } from 'vitest'
import {
  comparePickBundles,
  formatPick,
  overallForPick,
  valueBundle,
  valuePick,
  type PickValueConfig,
  type ScoredBoardRow,
} from '@/lib/draft-pick-value/pickValue'

/**
 * A board with a deliberately CONVEX score distribution — big gaps at the top, flattening out —
 * because that shape is the whole point. If pick value were read off a linear ramp instead of the
 * real board, these tests would still pass on the ordering assertions and fail on the gap ones.
 */
const BOARD: ScoredBoardRow[] = [
  { score: 100 }, // 1.01
  { score: 88 },
  { score: 80 },
  { score: 75 }, // 1.04
  { score: 71 },
  { score: 68 },
  { score: 66 },
  { score: 64 },
  { score: 63 },
  { score: 62 },
  { score: 61 },
  { score: 60 }, // 1.12
  { score: 59 }, // 2.01 (linear) — round two starts here
  { score: 58 },
  { score: 57 },
  { score: 56 },
]

const LINEAR: PickValueConfig = { teamCount: 12, rounds: 4, snake: false }
const SNAKE: PickValueConfig = { teamCount: 12, rounds: 4, snake: true }

describe('pick value — board position', () => {
  it('maps round and slot to an overall pick number', () => {
    expect(overallForPick({ round: 1, slot: 1 }, LINEAR)).toBe(1)
    expect(overallForPick({ round: 1, slot: 4 }, LINEAR)).toBe(4)
    expect(overallForPick({ round: 2, slot: 1 }, LINEAR)).toBe(13)
  })

  it('reverses even rounds in a snake draft', () => {
    // Slot 1 picks FIRST in round one and LAST in round two.
    expect(overallForPick({ round: 1, slot: 1 }, SNAKE)).toBe(1)
    expect(overallForPick({ round: 2, slot: 1 }, SNAKE)).toBe(24)
    expect(overallForPick({ round: 2, slot: 12 }, SNAKE)).toBe(13)
    // Odd rounds are unaffected.
    expect(overallForPick({ round: 3, slot: 1 }, SNAKE)).toBe(25)
  })

  it('refuses picks outside the draft rather than clamping them', () => {
    expect(overallForPick({ round: 0, slot: 1 }, LINEAR)).toBeNull()
    expect(overallForPick({ round: 5, slot: 1 }, LINEAR)).toBeNull()
    expect(overallForPick({ round: 1, slot: 13 }, LINEAR)).toBeNull()
    expect(overallForPick({ round: 1, slot: 0 }, LINEAR)).toBeNull()
  })
})

describe('pick value — reading the curve off the board', () => {
  it('values a pick as SURPLUS over the last drafted player, not the raw score', () => {
    // Board is 16 long, draft is 12x4=48, so replacement is the worst listed player: 56.
    expect(valuePick({ round: 1, slot: 1 }, BOARD, LINEAR)).toBe(100 - 56)
    expect(valuePick({ round: 1, slot: 4 }, BOARD, LINEAR)).toBe(75 - 56)
  })

  it('preserves the board’s convexity instead of a straight line', () => {
    const p1 = valuePick({ round: 1, slot: 1 }, BOARD, LINEAR)!
    const p2 = valuePick({ round: 1, slot: 2 }, BOARD, LINEAR)!
    const p10 = valuePick({ round: 1, slot: 10 }, BOARD, LINEAR)!
    const p11 = valuePick({ round: 1, slot: 11 }, BOARD, LINEAR)!
    // The 1.01 -> 1.02 drop dwarfs the 1.10 -> 1.11 drop. A linear curve would make them equal.
    expect(p1 - p2).toBeGreaterThan((p10 - p11) * 5)
  })

  it('returns null for a pick past the end of the board — unknown, not worthless', () => {
    expect(valuePick({ round: 4, slot: 12 }, BOARD, LINEAR)).toBeNull()
  })
})

describe('pick value — bundles', () => {
  it('sums a side and keeps unvaluable picks visible', () => {
    const b = valueBundle(
      [
        { round: 1, slot: 4 },
        { round: 4, slot: 12 }, // past the board
      ],
      BOARD,
      LINEAR,
    )
    expect(b.total).toBe(75 - 56)
    expect(b.valued).toHaveLength(1)
    expect(b.unvalued).toEqual([{ round: 4, slot: 12 }])
  })

  it('never counts an unvaluable pick as zero', () => {
    const withUnknown = valueBundle([{ round: 4, slot: 12 }], BOARD, LINEAR)
    expect(withUnknown.total).toBe(0)
    // ...but it is reported, so a caller cannot mistake it for a genuinely worthless pick.
    expect(withUnknown.unvalued).toHaveLength(1)
    expect(withUnknown.valued).toHaveLength(0)
  })
})

describe('pick value — the verdict', () => {
  /*
   * 8b draws this scenario: give 2.04, get 3.01 + 3.05, verdict unfavorable. Two later picks that
   * LOOK like more because there are two of them. Quantity is the trap the verdict exists to catch.
   *
   * ⚠ THE ANSWER DEPENDS ON THE BOARD, AND THAT IS THE POINT. On a steep board the single earlier
   * pick wins; on a flat one the pair does, and that is genuinely correct — if every player from
   * 16th to 30th is interchangeable, two bites beat one. A fixed pick-value chart cannot express
   * that. These two tests pin the model's RESPONSIVENESS rather than reproducing the handoff's
   * illustrative number as if it were a universal truth.
   */
  const cfg: PickValueConfig = { teamCount: 12, rounds: 4, snake: false }
  const give = [{ round: 2, slot: 4 }]
  const get = [
    { round: 3, slot: 1 },
    { round: 3, slot: 5 },
  ]

  it('is unfavorable on a STEEP board — the early pick buys real separation', () => {
    const steep = Array.from({ length: 48 }, (_, i) => ({ score: 1000 * Math.exp(-i / 6) }))
    const r = comparePickBundles(give, get, steep, cfg)
    expect(r.verdict).toBe('unfavorable')
    expect(r.delta).toBeLessThan(0)
  })

  it('is favorable on a FLAT board — two bites genuinely beat one', () => {
    const flat = Array.from({ length: 48 }, (_, i) => ({ score: 100 - i * 0.1 }))
    const r = comparePickBundles(give, get, flat, cfg)
    expect(r.verdict).toBe('favorable')
  })

  it('never lets raw quantity win by itself — surplus is what is summed', () => {
    /*
     * The regression this whole design exists for. With raw scores, replacement floor and all,
     * two late picks beat one early pick on essentially any board. Two picks at the very END of a
     * steep draft are worth almost nothing, and must not out-total a premium pick.
     */
    const steep = Array.from({ length: 48 }, (_, i) => ({ score: 1000 * Math.exp(-i / 6) }))
    const r = comparePickBundles(
      [{ round: 1, slot: 1 }],
      [
        { round: 4, slot: 10 },
        { round: 4, slot: 11 },
      ],
      steep,
      cfg,
    )
    expect(r.verdict).toBe('unfavorable')
  })

  it('reports even when the sides are genuinely close, rather than inventing an edge', () => {
    /*
     * Adjacent picks off a board that barely separates them. Note these expectations are stated in
     * SURPLUS: on BOARD, 1.05 and 1.06 are 71 and 68 raw, which looks like a 4% gap but is 15 vs 12
     * once the shared replacement floor is removed — a 20% difference, and correctly NOT even. The
     * floor was hiding the real distance, which is the whole reason value is measured as surplus.
     */
    const close: ScoredBoardRow[] = [{ score: 100 }, { score: 99.5 }, { score: 50 }]
    const r = comparePickBundles(
      [{ round: 1, slot: 1 }],
      [{ round: 1, slot: 2 }],
      close,
      { teamCount: 3, rounds: 1, snake: false },
    )
    expect(r.verdict).toBe('even')
  })

  it('scales the even band to the size of the deal', () => {
    // Half a point between two picks worth ~50 each is rounding.
    const big: ScoredBoardRow[] = [{ score: 100 }, { score: 99.5 }, { score: 50 }]
    expect(
      comparePickBundles(
        [{ round: 1, slot: 1 }],
        [{ round: 1, slot: 2 }],
        big,
        { teamCount: 3, rounds: 1, snake: false },
      ).verdict,
    ).toBe('even')

    // The SAME half-point gap between two picks worth ~1 each is the whole deal.
    const small: ScoredBoardRow[] = [{ score: 51 }, { score: 50.5 }, { score: 50 }]
    expect(
      comparePickBundles(
        [{ round: 1, slot: 1 }],
        [{ round: 1, slot: 2 }],
        small,
        { teamCount: 3, rounds: 1, snake: false },
      ).verdict,
    ).toBe('unfavorable')
  })

  it('calls it favorable when the incoming side is genuinely better', () => {
    const r = comparePickBundles([{ round: 1, slot: 8 }], [{ round: 1, slot: 1 }], BOARD, LINEAR)
    expect(r.verdict).toBe('favorable')
    expect(r.delta).toBeGreaterThan(0)
  })

  it('flags a verdict computed over a pick it could not value', () => {
    const r = comparePickBundles(
      [{ round: 1, slot: 1 }],
      [{ round: 4, slot: 12 }],
      BOARD,
      LINEAR,
    )
    expect(r.incomplete).toBe(true)
  })

  it('is not incomplete when every pick valued', () => {
    const r = comparePickBundles([{ round: 1, slot: 1 }], [{ round: 1, slot: 2 }], BOARD, LINEAR)
    expect(r.incomplete).toBe(false)
  })

  it('respects snake ordering when valuing — a 2.01 is not an early pick', () => {
    const linear = valuePick({ round: 2, slot: 1 }, BOARD, LINEAR)
    const snake = valuePick({ round: 2, slot: 1 }, BOARD, SNAKE)
    // Linear puts 2.01 at overall 13; snake puts it at 24, which is off this board entirely.
    expect(linear).toBe(59 - 56)
    expect(snake).toBeNull()
  })
})

describe('formatPick', () => {
  it('reads the way a manager says it', () => {
    expect(formatPick({ round: 1, slot: 4 })).toBe('1.04')
    expect(formatPick({ round: 3, slot: 12 })).toBe('3.12')
  })
})
