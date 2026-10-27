import { describe, expect, it } from 'vitest'

import { AF_ADP_WEIGHTS, computeAfAdp } from '@/lib/adp/afAdp'

/**
 * AF ADP = market + imported real-league drafts + AllFantasy drafts. These pin the behaviour the
 * owner asked for: all three count, thin draft evidence defers to the market, deep evidence takes
 * over, and the mock/AI board is not an input.
 */
describe('computeAfAdp', () => {
  it('uses all three inputs when all are present', () => {
    const r = computeAfAdp({
      marketAdp: 20,
      split: { own: { adp: 30, sampleSize: 40 }, imported: { adp: 10, sampleSize: 40 } },
    })!
    expect(r.contributions.market).toBeGreaterThan(0)
    expect(r.contributions.imported).toBeGreaterThan(0)
    expect(r.contributions.af).toBeGreaterThan(0)
    expect(r.contributions.market + r.contributions.imported + r.contributions.af).toBeCloseTo(1, 10)
    expect(r.afAdp).toBeGreaterThan(10)
    expect(r.afAdp).toBeLessThan(30)
  })

  it('a two-draft sample barely moves the market number', () => {
    const r = computeAfAdp({ marketAdp: 20, split: { own: { adp: 80, sampleSize: 2 }, imported: null } })!
    expect(r.afAdp).toBeLessThan(30)
  })

  it('a deep imported corpus outweighs the market more than a thin one does', () => {
    const thin = computeAfAdp({ marketAdp: 20, split: { own: null, imported: { adp: 40, sampleSize: 3 } } })!
    const deep = computeAfAdp({ marketAdp: 20, split: { own: null, imported: { adp: 40, sampleSize: 400 } } })!
    expect(deep.contributions.imported).toBeGreaterThan(thin.contributions.imported)
    expect(deep.afAdp).toBeGreaterThan(thin.afAdp)
  })

  it('works with drafts only when the market has no number', () => {
    const r = computeAfAdp({ marketAdp: null, split: { own: { adp: 55, sampleSize: 12 }, imported: null } })!
    expect(r.afAdp).toBe(55)
    expect(r.contributions.af).toBe(1)
  })

  it('returns the market number unchanged when no drafts exist', () => {
    const r = computeAfAdp({ marketAdp: 33.3, split: undefined })!
    expect(r.afAdp).toBe(33.3)
    expect(r.contributions.market).toBe(1)
  })

  it('returns null when nothing is known', () => {
    expect(computeAfAdp({ marketAdp: null, split: null })).toBeNull()
    expect(computeAfAdp({ marketAdp: 0, split: { own: null, imported: null } })).toBeNull()
  })

  it('gives the mock/AI board no weight', () => {
    expect(AF_ADP_WEIGHTS.ai).toBe(0)
  })
})
