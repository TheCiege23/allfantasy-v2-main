/**
 * 1.7e (shape-aware scarcity) and 1.7f (soft knee).
 *
 * The two are tested together because they only work together: the shape finally lets the engine
 * SAY that a 4QB league wants more quarterbacks than a 2QB league, and the soft knee is what lets
 * that statement survive as far as a trade grade instead of being flattened by the clamp.
 */

import { describe, expect, it } from 'vitest'
import {
  POSITION_SCARCITY,
  SOFT_KNEE,
  SUPERFLEX_QB_MULTIPLIER,
  TWO_QB_MULTIPLIER,
  VALUE_CEILING,
  normalizedPlayerValue,
  scoringScarcityMultiplier,
  softCap,
} from '@/lib/trade-value/valueEngine'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'

const STANDARD_12 = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const FOUR_HORSEMEN = [
  ...Array(4).fill('QB'), ...Array(4).fill('RB'), ...Array(6).fill('WR'),
  ...Array(4).fill('TE'), ...Array(10).fill('FLEX'),
]
const KBFL = ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DE', 'DL', 'DL', 'LB', 'LB', 'LB', 'CB', 'DB']

const shapeOf = (teams: number, slots: string[]) => buildLeagueShape({ teams, starterSlots: slots })!

describe('1.7f — softCap', () => {
  it('is the identity below the knee, to the last decimal', () => {
    for (const v of [0, 1, 100, 5000, 8000, SOFT_KNEE]) {
      expect(softCap(v)).toBe(v)
    }
  })

  it('is smooth at the knee — no visible jump', () => {
    const below = softCap(SOFT_KNEE - 0.001)
    const at = softCap(SOFT_KNEE)
    const above = softCap(SOFT_KNEE + 0.001)
    expect(Math.abs(at - below)).toBeLessThan(0.01)
    expect(Math.abs(above - at)).toBeLessThan(0.01)
  })

  it('is strictly increasing forever, so ordering can never be lost', () => {
    let prev = -1
    for (const raw of [8500, 9000, 10000, 12000, 16266, 50000, 1e6]) {
      const v = softCap(raw)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })

  it('approaches the ceiling but never reaches or exceeds it', () => {
    expect(softCap(16266)).toBeLessThan(VALUE_CEILING)
    expect(softCap(1e6)).toBeLessThan(VALUE_CEILING)
    expect(softCap(1e9)).toBeLessThan(VALUE_CEILING)
  })

  /**
   * REGRESSION GUARD. The first implementation used `1 − e^(−x/h)`, which is correct on paper and
   * underflows to exactly 1.0 in float64 — returning exactly 10000 and destroying the ordering
   * this function exists to preserve. Worse, after rounding it saturated at a raw value of only
   * ~20,500, and a 6-QB league reaches ~24,900. Both cases are pinned here.
   */
  it('keeps DISTINCT ROUNDED values far past anything the formula can produce', () => {
    const reachable = [16266, 20509, 24877, 40000, 100000]
    const rounded = reachable.map((r) => Math.round(softCap(r)))
    expect(new Set(rounded).size).toBe(reachable.length)
    for (const v of rounded) expect(v).toBeLessThan(VALUE_CEILING)
  })

  it('a 6-QB league\'s elite QBs stay distinct — the exponential form collapsed them', () => {
    const values = [340, 380, 420, 460].map((pts) =>
      Math.round(softCap(pts * 26 * 0.85 * 2.449)), // 6QB demand multiplier
    )
    expect(new Set(values).size).toBe(4)
  })

  it('handles degenerate inputs without producing a number', () => {
    expect(softCap(0)).toBe(0)
    expect(softCap(-100)).toBe(0)
    expect(softCap(NaN)).toBe(0)
    // Non-finite input returns 0, matching this module's existing convention for NaN/Infinity.
    // Infinity is not a large projection, it is an upstream bug, and 0 makes it visible.
    expect(softCap(Infinity)).toBe(0)
  })
})

describe('1.7f — the superflex QB collapse is fixed', () => {
  /**
   * BEFORE this change these four inputs all produced exactly 10000. That is the bug, and the
   * assertion below is the whole reason the soft knee exists.
   */
  it('four elite superflex QBs get four distinct values', () => {
    const sf = { isSuperflex: true } as const
    const values = [340, 380, 420, 460].map((p) =>
      normalizedPlayerValue({ projection: p, position: 'QB', scoring: sf }),
    )
    expect(new Set(values).size).toBe(4)
    // Monotonic, and all still inside the published range.
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1])
    expect(Math.max(...values)).toBeLessThanOrEqual(VALUE_CEILING)
  })

  it('a better player is never worth less, at any projection', () => {
    for (const scoring of [null, { isSuperflex: true }, { is2QB: true }]) {
      let prev = -1
      for (let pts = 0; pts <= 600; pts += 20) {
        const v = normalizedPlayerValue({ projection: pts, position: 'QB', scoring })
        expect(v).toBeGreaterThanOrEqual(prev)
        prev = v
      }
    }
  })

  it('leaves ordinary values untouched — a mid-tier WR is unchanged', () => {
    // 200 pts × 26 × 1.05 = 5460, comfortably below the knee.
    expect(normalizedPlayerValue({ projection: 200, position: 'WR' })).toBe(5460)
  })
})

describe('1.7e — shape supersedes the booleans', () => {
  it('a standard 12-team shape leaves scarcity at exactly 1.0', () => {
    const shape = shapeOf(12, STANDARD_12)
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      expect(scoringScarcityMultiplier(pos, { shape })).toBeCloseTo(1.0, 10)
    }
  })

  it('supplying a standard shape does not change a single value', () => {
    const shape = shapeOf(12, STANDARD_12)
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      for (const pts of [80, 150, 240, 300]) {
        expect(normalizedPlayerValue({ projection: pts, position: pos, scoring: { shape } }))
          .toBe(normalizedPlayerValue({ projection: pts, position: pos }))
      }
    }
  })

  it('shape replaces the booleans rather than multiplying with them', () => {
    const shape = shapeOf(12, STANDARD_12)
    // Both a boolean AND a shape supplied: the shape must win, so the 1.6x must NOT appear.
    const withBoth = scoringScarcityMultiplier('QB', { shape, isSuperflex: true })
    expect(withBoth).toBeCloseTo(1.0, 10)
    expect(withBoth).toBeLessThan(SUPERFLEX_QB_MULTIPLIER)
  })

  it('falls back to the booleans when no shape is supplied', () => {
    expect(scoringScarcityMultiplier('QB', { isSuperflex: true })).toBeCloseTo(SUPERFLEX_QB_MULTIPLIER, 10)
    expect(scoringScarcityMultiplier('QB', { is2QB: true })).toBeCloseTo(TWO_QB_MULTIPLIER, 10)
  })

  it('scoring facts still apply on top of a shape — they are not roster facts', () => {
    const shape = shapeOf(12, STANDARD_12)
    const plain = scoringScarcityMultiplier('TE', { shape })
    const premium = scoringScarcityMultiplier('TE', { shape, tePremium: 1 })
    expect(premium).toBeGreaterThan(plain)

    const wrStd = scoringScarcityMultiplier('WR', { shape, scoringFormat: 'standard' })
    const wrPpr = scoringScarcityMultiplier('WR', { shape, scoringFormat: 'ppr' })
    expect(wrPpr).toBeGreaterThan(wrStd)
  })
})

describe('1.7e — the N-QB collapse is fixed end to end', () => {
  const base = ['RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
  const qbValue = (qbs: number, teams = 12) =>
    normalizedPlayerValue({
      projection: 300,
      position: 'QB',
      scoring: { shape: shapeOf(teams, [...Array(qbs).fill('QB'), ...base]) },
    })

  it('1QB, 2QB, 4QB and 6QB produce four distinct prices', () => {
    const values = [1, 2, 4, 6].map((n) => qbValue(n))
    expect(new Set(values).size).toBe(4)
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1])
  })

  it('Four Horsemen values a QB above a standard league — 4 teams and still more demand', () => {
    const horsemen = normalizedPlayerValue({
      projection: 300, position: 'QB', scoring: { shape: shapeOf(4, FOUR_HORSEMEN) },
    })
    const standard = normalizedPlayerValue({
      projection: 300, position: 'QB', scoring: { shape: shapeOf(12, STANDARD_12) },
    })
    expect(horsemen).toBeGreaterThan(standard)
  })

  it("prices Four Horsemen's 6 WR + 10 FLEX above a standard league's receivers", () => {
    const horsemen = normalizedPlayerValue({
      projection: 240, position: 'WR', scoring: { shape: shapeOf(4, FOUR_HORSEMEN) },
    })
    const standard = normalizedPlayerValue({
      projection: 240, position: 'WR', scoring: { shape: shapeOf(12, STANDARD_12) },
    })
    // The booleans had no way to express receiver demand at all.
    expect(horsemen).toBeGreaterThan(standard)
  })

  it('KBFL 32-team raises QB demand well above a 12-team league', () => {
    const kbfl = normalizedPlayerValue({
      projection: 300, position: 'QB', scoring: { shape: shapeOf(32, KBFL) },
    })
    const standard = normalizedPlayerValue({
      projection: 300, position: 'QB', scoring: { shape: shapeOf(12, STANDARD_12) },
    })
    expect(kbfl).toBeGreaterThan(standard)
  })

  it('leaves IDP positions to idpValue rather than inventing a demand multiplier', () => {
    const shape = shapeOf(32, KBFL)
    // The reference league starts no LB, so there is no baseline — scarcity stays 1.0.
    expect(scoringScarcityMultiplier('LB', { shape })).toBe(1.0)
    // And idpValue still short-circuits everything, unchanged.
    expect(normalizedPlayerValue({ projection: 0.3, position: 'LB', idpValue: 2500, scoring: { shape } }))
      .toBe(2500)
  })
})

describe('additive guarantee — no shape, no change', () => {
  it('every no-shape call is identical to a bare call', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K']) {
      for (const pts of [50, 120, 200, 280]) {
        const bare = normalizedPlayerValue({ projection: pts, position: pos })
        expect(normalizedPlayerValue({ projection: pts, position: pos, scoring: null })).toBe(bare)
        expect(normalizedPlayerValue({ projection: pts, position: pos, scoring: { shape: null } })).toBe(bare)
      }
    }
  })

  it('POSITION_SCARCITY is still the base table, unmodified', () => {
    expect(POSITION_SCARCITY.RB).toBe(1.15)
    expect(POSITION_SCARCITY.QB).toBe(0.85)
  })
})
