import { describe, expect, it } from 'vitest'
import {
  computeLeagueLocalValue,
  impliedValueFromTrade,
} from '@/lib/projections/leagueLocalValue'

const SEASON = 2026
const obs = (impliedValue: number, over: Partial<{ assetCount: number; crossState: boolean; season: number }> = {}) => ({
  impliedValue,
  assetCount: over.assetCount ?? 2,
  crossState: over.crossState,
  season: over.season ?? SEASON,
})

describe('league-local value', () => {
  it('returns the global value untouched when the league has never traded him', () => {
    // And says so — labelling an unadjusted number "league-adjusted" would claim
    // an adjustment that never happened.
    const r = computeLeagueLocalValue({ globalValue: 5000, observations: [], currentSeason: SEASON })
    expect(r.localValue).toBe(5000)
    expect(r.confidence).toBe('INSUFFICIENT')
    expect(r.detail).toContain('no trades in this league')
  })

  it('barely moves on a single trade — the corruption case', () => {
    // One manager overpaying 3x must not become the league price.
    const r = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(15000)],
      currentSeason: SEASON,
    })
    expect(r.shrinkageWeight).toBeLessThan(0.1)
    // Moves toward the observation, but stays anchored to the global prior.
    expect(r.localValue).toBeGreaterThan(5000)
    expect(r.localValue).toBeLessThan(6000)
  })

  it('lets a thick local market dominate', () => {
    const many = Array.from({ length: 20 }, () => obs(9000))
    const r = computeLeagueLocalValue({ globalValue: 5000, observations: many, currentSeason: SEASON })
    expect(r.shrinkageWeight).toBeGreaterThan(0.6)
    expect(r.localValue).toBeGreaterThan(7000)
    expect(r.confidence).toBe('HIGH')
  })

  it('weights a clean 1-for-1 above a messy 3-for-2', () => {
    const clean = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(9000, { assetCount: 2 })],
      currentSeason: SEASON,
    })
    const messy = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(9000, { assetCount: 5 })],
      currentSeason: SEASON,
    })
    // Same implied price; the cleaner signal should move the number further.
    expect(clean.localValue).toBeGreaterThan(messy.localValue)
  })

  it('discounts contender-vs-rebuilder trades as timeline arbitrage', () => {
    const sameState = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(9000, { crossState: false })],
      currentSeason: SEASON,
    })
    const crossState = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(9000, { crossState: true })],
      currentSeason: SEASON,
    })
    expect(crossState.localValue).toBeLessThan(sameState.localValue)
  })

  it('decays old trades', () => {
    const recent = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(9000, { season: SEASON })],
      currentSeason: SEASON,
    })
    const old = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(9000, { season: SEASON - 3 })],
      currentSeason: SEASON,
    })
    expect(old.localValue).toBeLessThan(recent.localValue)
  })

  it('always surfaces the observation count to the user', () => {
    const r = computeLeagueLocalValue({
      globalValue: 5000,
      observations: [obs(7000), obs(7500)],
      currentSeason: SEASON,
    })
    // "based on 2 trades" is honest; an unqualified number implies precision
    // this cannot have.
    expect(r.observations).toBe(2)
    expect(r.detail).toContain('2 trades')
  })

  it('refuses a player with no global value rather than inventing a prior', () => {
    const r = computeLeagueLocalValue({ globalValue: 0, observations: [obs(9000)], currentSeason: SEASON })
    expect(r.confidence).toBe('INSUFFICIENT')
    expect(r.localValue).toBe(0)
  })
})

describe('implied value from a trade', () => {
  it('solves a clean 1-for-1', () => {
    // He fetched 8000 and nothing came with him.
    expect(impliedValueFromTrade({ sameSideOthers: [], otherSide: [8000] })).toBe(8000)
  })

  it('nets out assets that travelled with him', () => {
    expect(impliedValueFromTrade({ sameSideOthers: [2000], otherSide: [8000] })).toBe(6000)
  })

  it('REFUSES when any counterparty asset is unpriced', () => {
    // The residual would silently absorb the unknown and present it as a price —
    // the same partial-coverage trap the trade grader refuses on.
    expect(impliedValueFromTrade({ sameSideOthers: [], otherSide: [8000, null] })).toBeNull()
    expect(impliedValueFromTrade({ sameSideOthers: [null], otherSide: [8000] })).toBeNull()
  })

  it('returns null rather than a negative price', () => {
    expect(impliedValueFromTrade({ sameSideOthers: [9000], otherSide: [1000] })).toBeNull()
  })
})
