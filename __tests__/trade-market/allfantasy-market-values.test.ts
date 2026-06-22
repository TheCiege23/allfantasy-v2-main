import { describe, it, expect } from 'vitest'
import { computeOfficialMarketValue, OFFICIAL_MAX_ADJUSTMENT, type OfficialObservation } from '@/lib/trade-market/allFantasyMarketValues'

const now = new Date().toISOString()
let pid = 0
function ob(terminal: OfficialObservation['terminal'], opts: { value?: number | null; pair?: string } = {}): OfficialObservation {
  return { proposalId: `p${pid++}`, terminal, observedValue: opts.value === undefined ? 4000 : opts.value, managerKey: opts.pair ?? `pair-${pid}`, createdAt: now }
}
const baseInput = (observations: OfficialObservation[], extra: Partial<Parameters<typeof computeOfficialMarketValue>[0]> = {}) =>
  computeOfficialMarketValue({ sport: 'NFL', leagueConcept: 'redraft', playerId: 'x', observations, ...extra })

describe('computeOfficialMarketValue — strict gates', () => {
  it('does not publish below the minimum sample (5)', () => {
    const r = baseInput([ob('accepted'), ob('accepted'), ob('accepted'), ob('accepted')]) // 4
    expect(r.sampleSize).toBe(4)
    expect(r.published).toBe(false)
    expect(r.adjustmentPercent).toBe(0)
    expect(r.direction).toBe('insufficient')
  })

  it('does not publish when confidence < 60 (veto-dragged)', () => {
    // 6 obs but heavy vetoes crush confidence below 60.
    const r = baseInput([ob('accepted'), ob('accepted'), ob('vetoed'), ob('vetoed'), ob('vetoed'), ob('rejected')])
    expect(r.sampleSize).toBe(6)
    expect(r.confidence).toBeLessThan(60)
    expect(r.published).toBe(false)
    expect(r.adjustmentPercent).toBe(0)
  })

  it('publishes a small positive adjustment for a healthy small sample, capped at ±3%', () => {
    const obs = Array.from({ length: 8 }, (_, i) => ob('accepted', { pair: `pair-${i}` }))
    const r = baseInput(obs)
    expect(r.sampleSize).toBe(8)
    expect(r.published).toBe(true)
    expect(r.direction).toBe('rising')
    expect(Math.abs(r.adjustmentPercent)).toBeLessThanOrEqual(3) // 5–14 tier cap
  })

  it('never exceeds the hard ±12% ceiling even with a huge diverse sample', () => {
    const obs = Array.from({ length: 80 }, (_, i) => ob('accepted', { pair: `pair-${i}` }))
    const r = baseInput(obs)
    expect(r.sampleSize).toBe(80)
    expect(Math.abs(r.adjustmentPercent)).toBeLessThanOrEqual(OFFICIAL_MAX_ADJUSTMENT)
  })

  it('dedupes by proposalId (a repeated proposalId counts once)', () => {
    const dup: OfficialObservation = { proposalId: 'same', terminal: 'accepted', observedValue: 4000, managerKey: 'a', createdAt: now }
    const r = baseInput([dup, { ...dup }, { ...dup }, { ...dup }, { ...dup }, { ...dup }])
    expect(r.sampleSize).toBe(1)
    expect(r.published).toBe(false)
  })

  it('caps same-manager-pair influence (5 accepted from one pair < 5 from distinct pairs)', () => {
    const onePair = Array.from({ length: 12 }, () => ob('accepted', { pair: 'same-pair' }))
    const manyPairs = Array.from({ length: 12 }, (_, i) => ob('accepted', { pair: `pair-${i}` }))
    const a = baseInput(onePair)
    const b = baseInput(manyPairs)
    expect(a.adjustmentPercent).toBeLessThan(b.adjustmentPercent)
  })

  it('returns insufficient (no base value) when observations carry no value', () => {
    const r = baseInput([ob('accepted', { value: null }), ob('accepted', { value: null }), ob('accepted', { value: null }), ob('accepted', { value: null }), ob('accepted', { value: null })])
    expect(r.baseValue).toBeNull()
    expect(r.published).toBe(false)
  })

  it('contains no PII', () => {
    const r = baseInput(Array.from({ length: 6 }, (_, i) => ob('accepted', { pair: `pair-${i}` })))
    const json = JSON.stringify(r).toLowerCase()
    for (const banned of ['email', 'token', 'session', 'password', '@', 'authorization']) expect(json.includes(banned)).toBe(false)
  })
})
