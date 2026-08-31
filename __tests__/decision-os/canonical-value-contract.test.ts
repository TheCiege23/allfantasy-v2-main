import { describe, it, expect } from 'vitest'

import {
  BASIS_UNIT,
  isCoherentValue,
  sumCanonicalValues,
  type CanonicalValue,
  type ValueBasis,
} from '@/lib/decision-os/value/contract'
import { DEVY_BRIDGE_CAVEAT, type DevyBridge } from '@/lib/devy/devyMarketBridge'

/**
 * The `unit` field is only worth having if something enforces it.
 *
 * `contract.ts` claims in its own header that the mixed-currency refusal is "enforced by a test,
 * not by discipline: a field nothing checks is a comment." This is that test. If it is deleted,
 * the claim in the header becomes false and CanonicalValue silently permits adding devy points to
 * market units — the invented conversion `lib/devy/devyMarketBridge.ts` was written to refuse.
 */

const base: Omit<CanonicalValue, 'value' | 'unit' | 'basis'> = {
  playerId: 'pid-1',
  idSpace: 'rollingInsightsId',
  sourceId: 'ri-1',
  sport: 'NFL',
  scope: 'global',
  asOf: '2026-08-31T00:00:00.000Z',
  sourceModule: 'test',
}

const market = (value: number, over: Partial<CanonicalValue> = {}): CanonicalValue => ({
  ...base, value, unit: 'market_units', basis: 'market', ...over,
})
const devy = (value: number, over: Partial<CanonicalValue> = {}): CanonicalValue => ({
  ...base, value, unit: 'devy_points', basis: 'devy_model', sport: 'NCAAF', ...over,
})

const BRIDGE: DevyBridge = {
  ok: true,
  marketUnitsPerDevyPoint: 2,
  source: 'league-setting',
  caveat: DEVY_BRIDGE_CAVEAT,
}

describe('CanonicalValue — unit coherence', () => {
  it('pins a unit for every basis, so a new basis cannot be added without choosing one', () => {
    const bases: ValueBasis[] = ['market', 'vorp', 'share_at_rank', 'devy_model']
    for (const b of bases) expect(BASIS_UNIT[b]).toBeTruthy()
    // The map must not grow silently past the union it is keyed on.
    expect(Object.keys(BASIS_UNIT).sort()).toEqual([...bases].sort())
  })

  it('rejects a value whose unit does not match its basis', () => {
    expect(isCoherentValue(devy(100))).toBe(true)
    // devy_model priced in market units is exactly the conversion this contract refuses.
    expect(isCoherentValue(devy(100, { unit: 'market_units' }))).toBe(false)
  })

  it('rejects a league-scoped value with no league', () => {
    expect(isCoherentValue(market(10, { scope: 'league' }))).toBe(false)
    expect(isCoherentValue(market(10, { scope: 'league', leagueId: 'lg1' }))).toBe(true)
  })

  it('rejects a confidence outside 0..1, because a wrong scale reads as certainty', () => {
    expect(isCoherentValue(market(10, { confidence: 1.5 }))).toBe(false)
    expect(isCoherentValue(market(10, { confidence: 0 }))).toBe(true)
  })
})

describe('sumCanonicalValues — the refusal that makes `unit` load-bearing', () => {
  it('sums one currency without a caveat', () => {
    const r = sumCanonicalValues([market(100), market(50)])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.total).toBe(150)
    expect(r.unit).toBe('market_units')
    expect(r.bridged).toBe(false)
    expect(r.caveats).toEqual([])
  })

  it('🛑 REFUSES to add devy points to market units when no bridge is set', () => {
    const r = sumCanonicalValues([market(100), devy(40)])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('mixed_units_no_bridge')
    expect(r.units).toEqual(expect.arrayContaining(['market_units', 'devy_points']))
    // The refusal must SAY why, since D8 requires naming the gap rather than going quiet.
    expect(r.detail).toMatch(/no exchange rate|never been measured/i)
  })

  it('converts through a league-set bridge, and always carries the caveat', () => {
    const r = sumCanonicalValues([market(100), devy(40)], BRIDGE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.total).toBe(180) // 100 + (40 * 2)
    expect(r.unit).toBe('market_units')
    expect(r.bridged).toBe(true)
    // A bridged total that loses its caveat is indistinguishable from a market-backed one.
    expect(r.caveats).toContain(DEVY_BRIDGE_CAVEAT)
  })

  it('refuses an empty set rather than reporting a total of 0', () => {
    const r = sumCanonicalValues([])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('empty')
  })

  it('refuses an incoherent value rather than summing a producer bug', () => {
    const r = sumCanonicalValues([market(10), devy(5, { unit: 'market_units' })])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('incoherent_value')
    // Name the producer, so the bug is attributable rather than anonymous.
    expect(r.detail).toContain('test')
  })

  it('never turns a failed conversion into zero', () => {
    const r = sumCanonicalValues([market(10), devy(Number.NaN)], BRIDGE)
    // NaN fails coherence first — either refusal is correct, silently counting it as 0 is not.
    expect(r.ok).toBe(false)
  })
})
