import { describe, it, expect } from 'vitest'
import { buildPositionalNeedView, SOLVED_GOOD_MIN, SOLVED_WARN_MIN } from '@/lib/draft-helper/positionalNeedView'

/**
 * The engine and the card measure opposite things.
 *
 *   computeNeeds:  count < starter -> 88+   (a HOLE)
 *                  stocked         -> 10    (SOLVED)
 *   the card:      low = hole, high = solved
 *
 * Read one as the other and a fully-stocked TE paints red. These pin the flip, and pin
 * that a position the engine never assessed stays unknown instead of becoming a green bar.
 */
describe('positional need: the engine scale is inverted for display', () => {
  it('a stocked position (engine 10) renders as solved 90', () => {
    const v = buildPositionalNeedView({ needs: { TE: 10 }, positions: ['TE'] })
    expect(v.rows[0].solved).toBe(90)
    expect(v.rows[0].band).toBe('good')
  })

  it('a hole (engine 88) renders as solved 12', () => {
    const v = buildPositionalNeedView({ needs: { RB: 88 }, positions: ['RB'] })
    expect(v.rows[0].solved).toBe(12)
    expect(v.rows[0].band).toBe('bad')
  })

  it('reproduces the three bands from the design', () => {
    // RB 41 bad, WR 63 warn, TE 88 good — expressed as engine values.
    const v = buildPositionalNeedView({
      needs: { RB: 59, WR: 37, TE: 12 },
      positions: ['RB', 'WR', 'TE'],
    })
    expect(v.rows.map((r) => [r.solved, r.band])).toEqual([
      [41, 'bad'],
      [63, 'warn'],
      [88, 'good'],
    ])
  })

  it('holds the band boundaries', () => {
    const at = (solved: number) =>
      buildPositionalNeedView({ needs: { X: 100 - solved }, positions: ['X'] }).rows[0].band
    expect(at(SOLVED_GOOD_MIN)).toBe('good')
    expect(at(SOLVED_GOOD_MIN - 1)).toBe('warn')
    expect(at(SOLVED_WARN_MIN)).toBe('warn')
    expect(at(SOLVED_WARN_MIN - 1)).toBe('bad')
  })
})

describe('positional need: an unassessed position is not a solved one', () => {
  it('renders a missing key as unknown, not as 100', () => {
    const v = buildPositionalNeedView({ needs: { RB: 20 }, positions: ['RB', 'WR'] })
    const wr = v.rows.find((r) => r.position === 'WR')!
    expect(wr.solved).toBeNull()
    expect(wr.band).toBe('unknown')
    expect(wr.label).toBe('—')
  })

  it('treats a null needs map as nothing assessed, not as everything solved', () => {
    const v = buildPositionalNeedView({ needs: null, positions: ['RB', 'WR', 'TE'] })
    expect(v.empty).toBe(true)
    expect(v.rows.every((r) => r.label === '—')).toBe(true)
  })

  it('ignores a non-finite score rather than plotting it', () => {
    const v = buildPositionalNeedView({ needs: { RB: Number.NaN }, positions: ['RB'] })
    expect(v.rows[0].solved).toBeNull()
  })

  it('is not empty when at least one position scored', () => {
    const v = buildPositionalNeedView({ needs: { RB: 20 }, positions: ['RB', 'WR'] })
    expect(v.empty).toBe(false)
  })

  it('only renders positions this league actually starts', () => {
    // The engine may return keys for positions the league does not use.
    const v = buildPositionalNeedView({ needs: { RB: 20, K: 90, DEF: 90 }, positions: ['RB'] })
    expect(v.rows.map((r) => r.position)).toEqual(['RB'])
  })
})

describe('positional need: board-level thinness is stated, not folded in', () => {
  it('surfaces the first caveat verbatim', () => {
    const v = buildPositionalNeedView({
      needs: { RB: 20 },
      positions: ['RB'],
      caveats: ['Limited ADP coverage in this pool; confidence is reduced.'],
    })
    expect(v.caveat).toContain('Limited ADP coverage')
  })

  it('has no caveat when the engine raised none', () => {
    const v = buildPositionalNeedView({ needs: { RB: 20 }, positions: ['RB'] })
    expect(v.caveat).toBeNull()
  })
})
