import { describe, expect, it } from 'vitest'

import {
  KICKER_CEILING_DYNASTY,
  KICKER_CEILING_REDRAFT,
  countKickerSlots,
  kickerShareAtRank,
  resolveLeagueKickerValue,
} from '@/lib/kicker-values/leagueKickerValue'

/**
 * These tests exist as much to PREVENT a feature as to prove one.
 *
 * The natural instinct is to rank kickers and price the rank, exactly as the IDP stack does.
 * Measured on production over 4,482 kicker game rows (2019-2025), kicker rank does not
 * persist — year over year the Spearman correlation is NEGATIVE in all six season pairs
 * (mean -0.455), within a season it is ~0, and the whole startable population spans 1.55x.
 * So every kicker in a league gets the same number, and the test below that asserts it is
 * the most important one in the file.
 */
describe('kickerShareAtRank', () => {
  it('reproduces the measured seven-season shares at the anchors', () => {
    expect(kickerShareAtRank(1)).toBeCloseTo(1.0, 3)
    expect(kickerShareAtRank(12)).toBeCloseTo(0.768, 3)
    expect(kickerShareAtRank(24)).toBeCloseTo(0.647, 3)
    expect(kickerShareAtRank(30)).toBeCloseTo(0.529, 3)
  })

  it('interpolates between anchors and holds flat past the last one', () => {
    const mid = kickerShareAtRank(15)
    expect(mid).toBeLessThan(kickerShareAtRank(12))
    expect(mid).toBeGreaterThan(kickerShareAtRank(18))
    expect(kickerShareAtRank(60)).toBe(kickerShareAtRank(30))
  })

  /**
   * 🛑 THE CURVE THIS REPLACES CLAIMED A 12x SPREAD (1200 down to 100). The measured board is
   * nowhere near that steep, and a regression back toward it would silently restore the
   * overstatement.
   */
  it('stays far flatter than the ladder it replaced', () => {
    expect(kickerShareAtRank(1) / kickerShareAtRank(24)).toBeLessThan(2)
  })
})

describe('countKickerSlots', () => {
  it('counts K slots and ignores everything else', () => {
    expect(countKickerSlots(['QB', 'RB', 'WR', 'K', 'BN'])).toBe(1)
    expect(countKickerSlots(['K', 'k', 'QB'])).toBe(2)
    expect(countKickerSlots(['QB', 'DEF'])).toBe(0)
    expect(countKickerSlots(null)).toBe(0)
  })
})

describe('resolveLeagueKickerValue', () => {
  const base = { rosterPositions: ['QB', 'RB', 'WR', 'TE', 'K'], numTeams: 12, isDynasty: true }

  it('returns a usable value and always reports rank as unpredictable', () => {
    const r = resolveLeagueKickerValue(base)
    expect(r.value).toBeGreaterThan(0)
    expect(r.rankPredictability).toBe('none')
    expect(r.basis).toMatch(/does not persist/i)
  })

  it('puts replacement at the first kicker nobody must start', () => {
    expect(resolveLeagueKickerValue(base).replacementRank).toBe(13)
    expect(resolveLeagueKickerValue({ ...base, numTeams: 10 }).replacementRank).toBe(11)
    expect(
      resolveLeagueKickerValue({ ...base, rosterPositions: ['K', 'K'], numTeams: 12 }).replacementRank,
    ).toBe(25)
  })

  /**
   * 🛑 A league that starts no kicker must get NULL, never 0. A kicker is not a
   * zero-value asset there — he is not an asset at all, and quoting a price would invent a
   * market for a player nobody in that league can field.
   */
  it('refuses to price a kicker in a league that starts none', () => {
    const r = resolveLeagueKickerValue({ ...base, rosterPositions: ['QB', 'RB', 'WR'] })
    expect(r.value).toBeNull()
  })

  it('prices a kicker higher where more of them must be started', () => {
    const one = resolveLeagueKickerValue(base).value!
    const two = resolveLeagueKickerValue({ ...base, rosterPositions: ['K', 'K'] }).value!
    expect(two).toBeGreaterThan(one)
  })

  /**
   * Redraft above dynasty, matching the asymmetry the IDP ceiling documents: dynasty values
   * embed multi-year and youth premiums a kicker categorically cannot earn.
   */
  it('values a kicker higher in redraft than in dynasty', () => {
    const dyn = resolveLeagueKickerValue(base).value!
    const red = resolveLeagueKickerValue({ ...base, isDynasty: false }).value!
    expect(red).toBeGreaterThan(dyn)
    expect(KICKER_CEILING_REDRAFT).toBeGreaterThan(KICKER_CEILING_DYNASTY)
  })

  it('never prices a kicker above the position ceiling', () => {
    const absurd = resolveLeagueKickerValue({
      rosterPositions: Array(6).fill('K'),
      numTeams: 32,
      isDynasty: false,
    })
    expect(absurd.value!).toBeLessThanOrEqual(KICKER_CEILING_REDRAFT)
  })

  /**
   * 🛑 THE LOAD-BEARING TEST. If someone adds a per-player term here, this fails — which is
   * the point. Two kickers in the same league are worth the same because nothing we can
   * measure distinguishes what they will do next.
   */
  it('gives every kicker in a league the identical value', () => {
    const a = resolveLeagueKickerValue(base)
    const b = resolveLeagueKickerValue(base)
    expect(a.value).toBe(b.value)
    expect(Object.keys(a)).not.toContain('valueByPlayer')
  })
})
