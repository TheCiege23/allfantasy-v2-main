import { describe, expect, it } from 'vitest'
import { tradeEvidence, tradePackageReview, tradeValueSensitivity } from '@/lib/decision-os/trade/tradeEvidence'
import type { TradeGradeLine } from '@/lib/decision-os/trade/tradeGrade'

const at = '2026-10-03T12:00:00Z'
const line = (extra: Partial<TradeGradeLine> = {}): TradeGradeLine => ({
  side: 'give', name: 'Player', assetKind: 'player', marketValue: 1000, leagueValue: 1000,
  valueSource: 'fantasycalc', valueAsOf: '2026-10-02T00:00:00Z', ...extra,
})

describe('observed trade evidence', () => {
  it('describes complete dated quotes without inventing an accuracy probability', () => {
    expect(tradeEvidence([line()], at)).toMatchObject({ status: 'dated', priced: 1, total: 1, dated: 1, issues: [] })
  })
  it('flags stale values, formula pricing, missing dates and external data gaps', () => {
    const e = tradeEvidence([
      line({ name: 'Old', valueAsOf: '2026-09-01T00:00:00Z' }),
      line({ name: 'Formula', valueSource: 'pick_curve', valueAsOf: null }),
    ], at, ['Roster could not be read.'])
    expect(e.status).toBe('mixed')
    expect(e.issues.join(' ')).toContain('more than 7 days old')
    expect(e.issues.join(' ')).toContain('estimate or formula')
    expect(e.issues.join(' ')).toContain('Roster could not be read.')
    expect(e.dated).toBe(1)
  })
  it('never calls undated, invalid or absent prices complete evidence', () => {
    for (const value of [null, NaN, Infinity, -1]) expect(tradeEvidence([line({ leagueValue: value })], at).status).toBe('limited')
    expect(tradeEvidence([line({ valueAsOf: 'bad' })], at).status).toBe('limited')
    expect(tradeEvidence([line({ valueAsOf: '2027-01-01' })], at).status).toBe('limited')
    expect(tradeEvidence([], at).status).toBe('limited')
    expect(tradeEvidence([line()], 'bad').issues.join(' ')).toContain('freshness cannot be checked')
  })
})

describe('player-slot package review', () => {
  it('reports the net player slots without counting picks or FAAB', () => {
    const review = tradePackageReview([line(), line({ side: 'get' }), line({ side: 'get', name: 'Depth' }), line({ side: 'get', assetKind: 'pick' })])
    expect(review).toMatchObject({ givePlayers: 1, getPlayers: 2, netPlayerSlots: 1 })
    expect(review?.note).toContain('may require drops')
  })
  it('does not guess the kind of an older receipt or invent a penalty for a balanced package', () => {
    expect(tradePackageReview([line(), line({ side: 'get' }), line({ assetKind: undefined })])).toBeNull()
    expect(tradePackageReview([line(), line(), line({ side: 'get' }), line({ side: 'get' })])).toBeNull()
  })
})

describe('explicit sensitivity scenarios', () => {
  it('mirrors the range exactly and keeps the baseline inside it', () => {
    const r = tradeValueSensitivity(1000, 1200)!
    const mirrored = tradeValueSensitivity(1200, 1000)!
    expect(r.low).toBeLessThan(17)
    expect(r.high).toBeGreaterThan(17)
    expect(mirrored).toEqual({ low: -r.high, high: -r.low })
  })
  it('rejects invalid values and impossible scenario sizes', () => {
    for (const value of [NaN, Infinity, 0, -1]) expect(tradeValueSensitivity(value, 1000)).toBeNull()
    expect(tradeValueSensitivity(1000, 1000, 100)).toBeNull()
    expect(tradeValueSensitivity(1000, 1000, 0)).toEqual({ low: 0, high: 0 })
  })
})
